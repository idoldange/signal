import type { SongStore } from "@signal-app/core"
import type { Player } from "@signal-app/player"
import { convertAudioToWav } from "./activityImport"
import { getSongTempos } from "./songToUstx"
import { tickToSec } from "./vocal"

const DRIFT_CHECK_MS = 500
const MAX_DRIFT_SEC = 0.5
// Same output latency offset as the vocal tracks.
const PLAY_LATENCY_SEC = 0.05

export const effectiveGain = (track: Pick<BackingTrack, "volume" | "muted">) =>
  track.muted ? 0 : track.volume

export interface BackingTrack {
  // identity of the picked file (name, size, last modified): the same file is not added twice
  key: string
  id: number
  name: string
  buffer: AudioBuffer
  // the file as it was picked, kept so Save can send / store it with the project
  file: File
  // 0..1, applied on top of the shared output gain
  volume: number
  // -1 (left) .. 1 (right)
  pan: number
  muted: boolean
}

// WAV/audio files imported from the computer. Signal projects are MIDI-only, so audio tracks
// live here as an overlay: they start at project time 0, follow play/pause/seek, and are mixed
// into the exported WAV. Nothing is uploaded to the bot.
export class BackingTrackService {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private tracks: BackingTrack[] = []
  private sources = new Map<number, AudioBufferSourceNode>()
  // One gain per playing track, so volume/mute follow the slider while it plays.
  private trackGains = new Map<number, GainNode>()
  private trackPanners = new Map<number, StereoPannerNode>()
  private anchor: { sec: number; ctxTime: number } | null = null
  private nextId = 1
  private listeners = new Set<() => void>()
  private lastDriftCheck = 0

  constructor(
    private readonly songStore: SongStore,
    private readonly player: Player,
  ) {
    player.onIsPlayingChanged.subscribe(this.onPlayingChanged)
    player.onPositionChanged.subscribe(this.onPositionChanged)
    songStore.onSongChanged.subscribe(this.onSongReplaced)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): readonly BackingTrack[] => this.tracks

  // The same file picked twice (the picker can fire twice inside the Discord iframe) is added
  // once: imports of one file share a single promise.
  private pending = new Map<string, Promise<BackingTrack>>()

  importFile = (file: File): Promise<BackingTrack> => {
    const key = `${file.name}|${file.size}|${file.lastModified}`
    const known = this.tracks.find((t) => t.key === key)
    if (known !== undefined) {
      return Promise.resolve(known)
    }
    let job = this.pending.get(key)
    if (job === undefined) {
      job = this.load(file, key).finally(() => this.pending.delete(key))
      this.pending.set(key, job)
    }
    return job
  }

  // The browser decodes wav/mp3/ogg/flac/m4a itself; anything else (or a file it cannot read)
  // is converted to WAV by the bot with ffmpeg.
  private decode = async (file: File): Promise<AudioBuffer> => {
    const ctx = this.ensureContext()
    try {
      return await ctx.decodeAudioData(await file.arrayBuffer())
    } catch {
      return await ctx.decodeAudioData(await convertAudioToWav(file))
    }
  }

  private load = async (file: File, key: string): Promise<BackingTrack> => {
    const buffer = await this.decode(file)
    const track: BackingTrack = {
      id: this.nextId++,
      name: file.name,
      buffer,
      key,
      file,
      volume: 1,
      pan: 0,
      muted: false,
    }
    this.tracks = [...this.tracks, track]
    this.emit()
    if (this.player.isPlaying) {
      this.resync(this.currentSec())
    }
    return track
  }

  setVolume = (id: number, volume: number) => {
    this.update(id, { volume: Math.max(0, Math.min(1, volume)) })
  }

  setPan = (id: number, pan: number) => {
    this.update(id, { pan: Math.max(-1, Math.min(1, pan)) })
  }

  setMuted = (id: number, muted: boolean) => {
    this.update(id, { muted })
  }

  private update(
    id: number,
    patch: Partial<Pick<BackingTrack, "volume" | "pan" | "muted">>,
  ) {
    const track = this.tracks.find((t) => t.id === id)
    if (track === undefined) {
      return
    }
    const next = { ...track, ...patch }
    this.tracks = this.tracks.map((t) => (t.id === id ? next : t))
    const gain = this.trackGains.get(id)
    if (gain !== undefined) {
      gain.gain.value = effectiveGain(next)
    }
    const panner = this.trackPanners.get(id)
    if (panner !== undefined) {
      panner.pan.value = next.pan
    }
    this.emit()
  }

  remove = (id: number) => {
    this.stopSource(id)
    this.tracks = this.tracks.filter((track) => track.id !== id)
    this.emit()
  }

  clear = () => {
    if (this.tracks.length === 0) {
      return
    }
    this.stopAllSources()
    this.tracks = []
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }

  private ensureContext() {
    if (this.ctx === null) {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = 0.9
      this.gain.connect(this.ctx.destination)
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume()
    }
    return this.ctx
  }

  private currentSec() {
    const song = this.songStore.song
    return tickToSec(this.player.position, song.timebase, getSongTempos(song))
  }

  // Audio tracks are not part of the song, so opening/importing a MIDI or starting a new
  // project does not throw them away (they are easy to lose, and slow to import again).
  // Only the user removes them. Playback is just restarted for the new song.
  private onSongReplaced = () => {
    this.anchor = null
    this.stopAllSources()
    if (this.player.isPlaying) {
      this.resync(this.currentSec())
    }
  }

  private onPlayingChanged = () => {
    if (this.player.isPlaying) {
      this.resync(this.currentSec())
    } else {
      this.anchor = null
      this.stopAllSources()
    }
  }

  private onPositionChanged = () => {
    if (!this.player.isPlaying || this.anchor === null || this.ctx === null) {
      return
    }
    const now = performance.now()
    if (now - this.lastDriftCheck < DRIFT_CHECK_MS) {
      return
    }
    this.lastDriftCheck = now
    const expected =
      this.anchor.sec + (this.ctx.currentTime - this.anchor.ctxTime)
    if (Math.abs(this.currentSec() - expected) > MAX_DRIFT_SEC) {
      this.resync(this.currentSec())
    }
  }

  private resync(sec: number) {
    this.stopAllSources()
    const ctx = this.ensureContext()
    this.anchor = { sec, ctxTime: ctx.currentTime }
    for (const track of this.tracks) {
      this.addSource(track)
    }
  }

  private addSource(track: BackingTrack) {
    if (this.ctx === null || this.gain === null || this.anchor === null) {
      return
    }
    const now = this.ctx.currentTime
    const when = this.anchor.ctxTime - this.anchor.sec + PLAY_LATENCY_SEC
    const source = this.ctx.createBufferSource()
    source.buffer = track.buffer
    const trackGain = this.ctx.createGain()
    trackGain.gain.value = effectiveGain(track)
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = track.pan
    source.connect(trackGain)
    trackGain.connect(panner)
    panner.connect(this.gain)
    if (when >= now) {
      source.start(when)
    } else {
      const offset = now - when
      if (offset >= track.buffer.duration) {
        source.disconnect()
        trackGain.disconnect()
        panner.disconnect()
        return
      }
      source.start(now, offset)
    }
    source.onended = () => {
      if (this.sources.get(track.id) === source) {
        this.sources.delete(track.id)
        this.trackGains.delete(track.id)
        this.trackPanners.delete(track.id)
      }
      source.disconnect()
      trackGain.disconnect()
      panner.disconnect()
    }
    this.sources.set(track.id, source)
    this.trackGains.set(track.id, trackGain)
    this.trackPanners.set(track.id, panner)
  }

  private stopSource(id: number) {
    const source = this.sources.get(id)
    if (source === undefined) {
      return
    }
    try {
      source.stop()
    } catch {
      // already stopped
    }
    source.disconnect()
    this.sources.delete(id)
    this.trackGains.get(id)?.disconnect()
    this.trackGains.delete(id)
    this.trackPanners.get(id)?.disconnect()
    this.trackPanners.delete(id)
  }

  private stopAllSources() {
    for (const id of [...this.sources.keys()]) {
      this.stopSource(id)
    }
  }
}
