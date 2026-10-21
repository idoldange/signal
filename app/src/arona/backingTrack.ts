import type { SongStore } from "@signal-app/core"
import type { Player } from "@signal-app/player"
import { getSongTempos } from "./songToUstx"
import { tickToSec } from "./vocal"

const DRIFT_CHECK_MS = 500
const MAX_DRIFT_SEC = 0.5
// Same output latency offset as the vocal tracks.
const PLAY_LATENCY_SEC = 0.05

export interface BackingTrack {
  id: number
  name: string
  buffer: AudioBuffer
}

// WAV/audio files imported from the computer. Signal projects are MIDI-only, so audio tracks
// live here as an overlay: they start at project time 0, follow play/pause/seek, and are mixed
// into the exported WAV. Nothing is uploaded to the bot.
export class BackingTrackService {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private tracks: BackingTrack[] = []
  private sources = new Map<number, AudioBufferSourceNode>()
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

  importFile = async (file: File): Promise<BackingTrack> => {
    const ctx = this.ensureContext()
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    const track: BackingTrack = { id: this.nextId++, name: file.name, buffer }
    this.tracks = [...this.tracks, track]
    this.emit()
    if (this.player.isPlaying) {
      this.resync(this.currentSec())
    }
    return track
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
    return tickToSec(
      this.player.position,
      song.timebase,
      getSongTempos(song),
    )
  }

  private onSongReplaced = () => {
    this.anchor = null
    this.stopAllSources()
    this.clear()
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
    const when =
      this.anchor.ctxTime - this.anchor.sec + PLAY_LATENCY_SEC
    const source = this.ctx.createBufferSource()
    source.buffer = track.buffer
    source.connect(this.gain)
    if (when >= now) {
      source.start(when)
    } else {
      const offset = now - when
      if (offset >= track.buffer.duration) {
        source.disconnect()
        return
      }
      source.start(now, offset)
    }
    source.onended = () => {
      if (this.sources.get(track.id) === source) {
        this.sources.delete(track.id)
      }
      source.disconnect()
    }
    this.sources.set(track.id, source)
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
  }

  private stopAllSources() {
    for (const id of [...this.sources.keys()]) {
      this.stopSource(id)
    }
  }
}
