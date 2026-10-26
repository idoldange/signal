import {
  hasPitch,
  isNoteEvent,
  type NotePitch,
  type Song,
  type SongStore,
} from "@signal-app/core"
import type { Player } from "@signal-app/player"
import type { GroupOutput } from "../services/GroupOutput"
import { isDiscordActivity } from "./activity"
import {
  activityFetch,
  activityJson,
  type VocalChunkInfo,
} from "./activityApi"
import { getSongTempos } from "./songToUstx"
import { getVocalTrackIds, vocalTrackFlags } from "./vocalTrack"

const VOCAL_KEY = "arona_vocal_enabled_v2"
const MAX_CHUNK_WAIT_MS = 30 * 60 * 1000
// Wait for the user to stop editing before asking the server for a new plan.
const EDIT_DEBOUNCE_MS = 600
// The vocal is intentionally a hair behind the soundfont output (output latency).
const PLAY_LATENCY_SEC = 0.05
const MAX_CACHED_BUFFERS = 128

export interface VocalChunk {
  hash: string
  start: number
  end: number
  buffer: AudioBuffer
}

// The vocal is on by default inside the Activity; the menu toggle stores an explicit "0".
const storedEnabled = () => {
  try {
    return localStorage.getItem(VOCAL_KEY) !== "0"
  } catch {
    return true
  }
}

export const isVocalEnabled = () => isDiscordActivity && storedEnabled()

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export const tickToSec = (
  tick: number,
  ppq: number,
  tempos: readonly [number, number][],
) => {
  let sec = 0
  let prevTick = 0
  let prevBpm = tempos[0]?.[1] ?? 120
  for (const [t, bpm] of tempos.slice(1)) {
    if (t >= tick) {
      break
    }
    sec += ((t - prevTick) * 60) / (prevBpm * ppq)
    prevTick = t
    prevBpm = bpm
  }
  return sec + ((tick - prevTick) * 60) / (prevBpm * ppq)
}

const buildVocalBody = (song: Song) => {
  const notes: {
    pos: number
    dur: number
    tone: number
    lyric: string
    pitch?: NotePitch
  }[] = []
  for (const track of song.tracks) {
    if (track.isConductorTrack) {
      continue
    }
    // A track ticked as "Arona Vocal" sings all its notes ("a" where there is no lyric yet);
    // otherwise only the notes that carry a lyric are sung.
    const flagged = vocalTrackFlags.has(track)
    for (const event of track.events) {
      if (!isNoteEvent(event)) {
        continue
      }
      const lyric = event.lyric?.trim() ?? ""
      if (lyric !== "" || flagged) {
        notes.push({
          pos: event.tick,
          dur: event.duration,
          tone: event.noteNumber,
          lyric: lyric !== "" ? event.lyric ?? lyric : "a",
          ...(hasPitch(event.pitch) ? { pitch: event.pitch } : {}),
        })
      }
    }
  }
  notes.sort((a, b) => a.pos - b.pos || a.tone - b.tone)
  return {
    ppq: song.timebase,
    tempos: getSongTempos(song),
    notes,
  }
}

type VocalBody = ReturnType<typeof buildVocalBody>

const chunkKey = (chunk: VocalChunk) => `${chunk.hash}@${chunk.start.toFixed(3)}`

// Generates and plays the Arona vocal track in the background, chunk by chunk.
// - The server splits the vocal into phrases and caches each one by content hash.
// - This service keeps the decoded audio of every phrase by that same hash, so after an edit
//   only the phrases whose hash changed are generated again; the rest are reused as they are.
// - Phrases are scheduled as soon as they are ready, so playback never waits for the whole song.
export class VocalService {
  private enabled = isVocalEnabled()
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private sources = new Map<string, AudioBufferSourceNode>()
  private buffers = new Map<string, AudioBuffer>()
  private inflight = new Map<string, Promise<AudioBuffer>>()
  private wanted = new Set<string>()
  private chunks: VocalChunk[] = []
  private job: { key: string; promise: Promise<VocalChunk[]> } | null = null
  private jobToken = 0
  private debounceTimer: number | null = null
  private anchor: { sec: number; ctxTime: number } | null = null
  private lastDriftCheck = 0
  private unwatchSong: (() => void) | null = null

  constructor(
    private readonly songStore: SongStore,
    private readonly player: Player,
    private readonly synthGroup: GroupOutput,
  ) {
    this.updateSilenced()
    this.watchSong()
    if (this.enabled) {
      this.refresh()
    }
    this.player.onIsPlayingChanged.subscribe(this.onPlayingChanged)
    this.player.onPositionChanged.subscribe(this.onPositionChanged)
    this.songStore.onSongChanged.subscribe(this.onSongReplaced)
    vocalTrackFlags.subscribe(this.onEdited)
  }

  get isEnabled() {
    return this.enabled
  }

  setEnabled(value: boolean) {
    this.enabled = value
    try {
      localStorage.setItem(VOCAL_KEY, value ? "1" : "0")
    } catch {
      // storage may be blocked in the iframe
    }
    this.updateSilenced()
    if (!value) {
      this.stop()
      return
    }
    this.refresh()
    if (this.player.isPlaying) {
      this.start()
    }
  }

  // Used by the exporter: resolves once every phrase is decoded and ready to mix.
  loadChunks = (song: Song): Promise<VocalChunk[]> => this.ensureJob(song)

  // While the vocal is on, the placeholder (choir) notes of lyric tracks stay silent.
  private updateSilenced() {
    this.synthGroup.silencedTrackIds = this.enabled
      ? getVocalTrackIds(this.songStore.song)
      : new Set()
  }

  private refresh() {
    void this.ensureJob(this.songStore.song).catch((e) => {
      // no session / server unavailable: vocals are simply silent
      console.warn("[arona] vocal generation failed", e)
    })
  }

  // Editing a note does not replace the Song object, so watch the tracks themselves.
  private watchSong() {
    this.unwatchSong?.()
    const song = this.songStore.song
    let trackSubs: (() => void)[] = []
    const watchTracks = () => {
      trackSubs.forEach((unsubscribe) => unsubscribe())
      trackSubs = song.tracks.map((t) => t.onChanged.subscribe(this.onEdited))
    }
    watchTracks()
    const offTracks = song.onTracksChanged.subscribe(() => {
      watchTracks()
      this.onEdited()
    })
    const offTimebase = song.onTimebaseChanged.subscribe(this.onEdited)
    this.unwatchSong = () => {
      trackSubs.forEach((unsubscribe) => unsubscribe())
      offTracks()
      offTimebase()
    }
  }

  private onEdited = () => {
    if (!this.enabled) {
      return
    }
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null
      this.updateSilenced()
      this.refresh()
    }, EDIT_DEBOUNCE_MS)
  }

  private onSongReplaced = () => {
    this.watchSong()
    this.chunks = []
    this.stop()
    this.updateSilenced()
    if (this.enabled) {
      this.refresh()
      if (this.player.isPlaying) {
        this.start()
      }
    }
  }

  private onPlayingChanged = () => {
    if (this.player.isPlaying) {
      this.start()
    } else {
      this.stop()
    }
  }

  private onPositionChanged = () => {
    if (!this.enabled || !this.player.isPlaying) {
      return
    }
    const now = performance.now()
    if (now - this.lastDriftCheck < 500) {
      return
    }
    this.lastDriftCheck = now
    if (this.anchor === null || this.ctx === null) {
      return
    }
    const actual = this.currentSec()
    const expected =
      this.anchor.sec + (this.ctx.currentTime - this.anchor.ctxTime)
    if (Math.abs(actual - expected) > 0.7) {
      this.resync(actual)
    }
  }

  private currentSec() {
    const song = this.songStore.song
    return tickToSec(
      this.player.position,
      song.timebase,
      getSongTempos(song),
    )
  }

  private ensureContext = () => {
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

  private start() {
    if (!this.enabled || !this.player.isPlaying) {
      return
    }
    this.resync(this.currentSec())
    // Pick up any edit made since the last plan; phrases that are unchanged are cache hits.
    this.refresh()
  }

  private stop() {
    this.anchor = null
    this.stopSources()
  }

  private resync(sec: number) {
    this.stopSources()
    const ctx = this.ensureContext()
    this.anchor = { sec, ctxTime: ctx.currentTime }
    this.syncSources()
  }

  private stopSources() {
    for (const source of this.sources.values()) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
      source.disconnect()
    }
    this.sources.clear()
  }

  // Makes the playing sources match the ready chunks without touching the ones that are
  // already sounding, so a phrase finishing in the background never cuts another one off.
  private syncSources() {
    if (
      !this.enabled ||
      !this.player.isPlaying ||
      this.ctx === null ||
      this.anchor === null
    ) {
      return
    }
    const desired = new Set(this.chunks.map(chunkKey))
    for (const [key, source] of this.sources) {
      if (!desired.has(key)) {
        try {
          source.stop()
        } catch {
          // already stopped
        }
        source.disconnect()
        this.sources.delete(key)
      }
    }
    for (const chunk of this.chunks) {
      this.addSource(chunk)
    }
  }

  private addSource(chunk: VocalChunk) {
    if (this.ctx === null || this.gain === null || this.anchor === null) {
      return
    }
    const key = chunkKey(chunk)
    if (this.sources.has(key) || chunk.end <= this.anchor.sec) {
      return
    }
    const now = this.ctx.currentTime
    const when =
      this.anchor.ctxTime + (chunk.start - this.anchor.sec) + PLAY_LATENCY_SEC
    const source = this.ctx.createBufferSource()
    source.buffer = chunk.buffer
    source.connect(this.gain)
    if (when >= now) {
      source.start(when)
    } else {
      const offset = now - when
      if (offset >= chunk.buffer.duration) {
        source.disconnect()
        return
      }
      source.start(now, offset)
    }
    source.onended = () => {
      if (this.sources.get(key) === source) {
        this.sources.delete(key)
      }
      source.disconnect()
    }
    this.sources.set(key, source)
  }

  private ensureJob(song: Song): Promise<VocalChunk[]> {
    const body = buildVocalBody(song)
    const key = JSON.stringify(body)
    if (this.job?.key === key) {
      return this.job.promise
    }
    const token = ++this.jobToken
    if (body.notes.length === 0) {
      this.chunks = []
      this.wanted = new Set()
      this.syncSources()
      const promise = Promise.resolve<VocalChunk[]>([])
      this.job = { key, promise }
      return promise
    }
    const promise = this.runJob(body, token)
    const job = { key, promise }
    this.job = job
    promise.catch(() => {
      // let the next call try again instead of replaying the failure forever
      if (this.job === job) {
        this.job = null
      }
    })
    return promise
  }

  private async runJob(body: VocalBody, token: number): Promise<VocalChunk[]> {
    const plan = await activityJson<{ chunks: VocalChunkInfo[] }>(
      "/api/vocal/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    const infos = plan.chunks
    if (token !== this.jobToken) {
      return this.chunks
    }
    this.wanted = new Set(infos.map((info) => info.hash))
    const ready = () =>
      infos.flatMap((info) => {
        const buffer = this.buffers.get(info.hash)
        return buffer
          ? [
              {
                hash: info.hash,
                start: info.start_sec,
                end: info.end_sec,
                buffer,
              },
            ]
          : []
      })
    const publish = () => {
      if (token === this.jobToken) {
        this.chunks = ready()
        this.syncSources()
      }
    }

    // Unchanged phrases are already decoded: they play right away, only new ones are generated.
    publish()
    for (const info of infos) {
      if (token !== this.jobToken) {
        return this.chunks
      }
      if (!this.buffers.has(info.hash)) {
        await this.getBuffer(body, info)
        publish()
      }
    }
    this.pruneBuffers()
    return ready()
  }

  private getBuffer(body: VocalBody, info: VocalChunkInfo): Promise<AudioBuffer> {
    const cached = this.buffers.get(info.hash)
    if (cached) {
      return Promise.resolve(cached)
    }
    const running = this.inflight.get(info.hash)
    if (running) {
      return running
    }
    const ctx = this.ensureContext()
    const promise = this.fetchChunk(body, info)
      .then((wav) => ctx.decodeAudioData(wav))
      .then((buffer) => {
        this.buffers.set(info.hash, buffer)
        return buffer
      })
      .finally(() => {
        this.inflight.delete(info.hash)
      })
    this.inflight.set(info.hash, promise)
    return promise
  }

  // Keep recently used phrases (undo/redo brings old hashes back) but not forever.
  private pruneBuffers() {
    for (const hash of this.buffers.keys()) {
      if (this.buffers.size <= MAX_CACHED_BUFFERS) {
        return
      }
      if (!this.wanted.has(hash)) {
        this.buffers.delete(hash)
      }
    }
  }

  private async fetchChunk(
    body: VocalBody,
    info: VocalChunkInfo,
  ): Promise<ArrayBuffer> {
    const started = performance.now()
    for (;;) {
      const res = await activityFetch(
        "/api/vocal/chunk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, index: info.index, hash: info.hash }),
        },
        [200, 202],
      )
      if (res.status === 200) {
        return await res.arrayBuffer()
      }
      const retry = (await res.json().catch(() => null)) as {
        retry_after?: number
      } | null
      if (performance.now() - started > MAX_CHUNK_WAIT_MS) {
        throw new Error("Vocal synthesis timed out")
      }
      await sleep(Math.max(1, Number(retry?.retry_after) || 10) * 1000)
      if (!this.wanted.has(info.hash)) {
        // the song moved on and nothing needs this phrase any more
        throw new Error("Vocal phrase no longer needed")
      }
    }
  }
}
