import {
  hasPitch,
  isNoteEvent,
  isPanEvent,
  isVolumeEvent,
  type NotePitch,
  type Song,
  type SongStore,
  type TrackId,
} from "@signal-app/core"
import type { Player } from "@signal-app/player"
import type { GroupOutput } from "../services/GroupOutput"
import { TrackMute } from "../trackMute/TrackMute"
import { isDiscordActivity } from "./activity"
import { activityFetch, activityJson, type VocalChunkInfo } from "./activityApi"
import { getSongTempos } from "./songToUstx"
import { tickToSec } from "./time"
import {
  createTrackChain,
  disconnectTrackChain,
  scheduleCurves,
  type TrackChain,
  trackCurves,
} from "./trackMix"
import {
  autoTransposeOf,
  getVocalTrackIds,
  splitLangTag,
  splitTags,
  vocalGen,
  vocalLanguage,
  trackFx,
  vocalTrackFlags,
  vocalTrackStretch,
  vocalTrackTranspose,
} from "./vocalTrack"

const VOCAL_KEY = "arona_vocal_enabled_v2"
const MAX_CHUNK_WAIT_MS = 30 * 60 * 1000
// Wait for the user to stop editing before asking the server for a new plan.
const EDIT_DEBOUNCE_MS = 600
// The vocal is intentionally a hair behind the soundfont output (output latency).
const PLAY_LATENCY_SEC = 0.05
const MAX_CACHED_BUFFERS = 128

// What the progress bar under the piano roll shows.
export interface VocalProgress {
  phase: "idle" | "planning" | "generating" | "done" | "error"
  // phrases of the whole vocal / phrases that are ready (cached or generated)
  total: number
  done: number
  failed: number
  error?: string
}

const IDLE_PROGRESS: VocalProgress = {
  phase: "idle",
  total: 0,
  done: 0,
  failed: 0,
}

export interface VocalChunk {
  trackId: TrackId
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

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e)

const abortError = () => new DOMException("Aborted", "AbortError")

export const isAbortError = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError"

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })

export { tickToSec }

interface VocalNote {
  pos: number
  dur: number
  tone: number
  lyric: string
  pitch?: NotePitch
  // manual transpose of the track (absent = auto octave shared by the whole song)
  transpose?: number
  // singing language (absent = detected by the server)
  lang?: string
  // manual syllable nudge in ms (absent = 0), see splitNudge
  nudge?: number
  // temperature / seed of this note (overrides track and project), see splitTags
  temp?: number
  seed?: number
}

// Every vocal track is planned and synthesized on its own: its phrases are cached by their
// own content, so muting/unmuting a track or editing another one never makes this track
// sing again, and tracks that sing at the same time do not cut each other's notes.
export const buildVocalBodies = (song: Song, trackMute: TrackMute) => {
  const bodies: { trackId: TrackId; body: VocalBody }[] = []
  // The auto octave is worked out from the WHOLE song, not from the tracks that are sent:
  // muting a track must not change the octave (and the hash) of the others.
  const params = { transpose: autoTransposeOf(song) }
  const tempos = getSongTempos(song)
  for (const track of song.tracks) {
    if (track.isConductorTrack) {
      continue
    }
    // A muted track (or any track but the soloed ones) is not sung, so it is not generated.
    if (!TrackMute.shouldPlayTrack(track.id)(trackMute)) {
      continue
    }
    const notes: VocalNote[] = []
    // A track ticked as "Arona Vocal" sings all its notes ("a" where there is no lyric yet);
    // otherwise only the notes that carry a lyric are sung.
    const flagged = vocalTrackFlags.has(track)
    const manual = vocalTrackTranspose.get(track)
    const trackLang = vocalLanguage.ofTrack(track) ?? vocalLanguage.ofSong(song)
    for (const event of track.events) {
      if (!isNoteEvent(event)) {
        continue
      }
      const lyric = event.lyric?.trim() ?? ""
      if (lyric !== "" || flagged) {
        const { lang: noteLang, text: tagged } = splitLangTag(lyric)
        const { nudge, temp, seed, text } = splitTags(tagged)
        const lang = noteLang ?? trackLang
        notes.push({
          pos: event.tick,
          dur: event.duration,
          tone: event.noteNumber,
          lyric: text !== "" ? text : "a",
          ...(nudge !== 0 ? { nudge } : {}),
          ...(temp !== null ? { temp } : {}),
          ...(seed !== null ? { seed } : {}),
          ...(lang !== null ? { lang } : {}),
          ...(hasPitch(event.pitch) ? { pitch: event.pitch } : {}),
          ...(manual !== null ? { transpose: manual } : {}),
        })
      }
    }
    if (notes.length === 0) {
      continue
    }
    notes.sort((a, b) => a.pos - b.pos || a.tone - b.tone)
    bodies.push({
      trackId: track.id,
      // no track name: the phrase hash depends on the notes only, so it is shared
      body: {
        ppq: song.timebase,
        tempos,
        notes,
        params: {
          ...params,
          ...vocalGen.resolved(song, track),
          ...(vocalTrackStretch.has(track) ? { align: "stretch" } : {}),
        },
        track: "vocal",
      },
    })
  }
  return bodies
}

interface VocalBody {
  ppq: number
  tempos: [number, number][]
  notes: VocalNote[]
  params: {
    transpose: number
    align?: string
    temperature?: number
    seed?: number
  }
  track: string
}

const chunkKey = (chunk: VocalChunk) =>
  `${chunk.trackId}:${chunk.hash}@${chunk.start.toFixed(3)}`

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
  // One controller per phrase being generated, so a phrase of an old version of the song
  // can be aborted (see abortStale).
  private controllers = new Map<string, AbortController>()
  // One chain (velocity -> volume -> pan) per vocal track: the level of the track over time.
  private chains = new Map<TrackId, TrackChain>()
  private wanted = new Set<string>()
  // The plan of a track only depends on its body, so an unchanged track is not planned again.
  private plans = new Map<string, VocalChunkInfo[]>()
  private chunks: VocalChunk[] = []
  private job: { key: string; promise: Promise<VocalChunk[]> } | null = null
  private jobToken = 0
  private debounceTimer: number | null = null
  private anchor: { sec: number; ctxTime: number } | null = null
  private lastDriftCheck = 0
  private unwatchSong: (() => void) | null = null
  private progress: VocalProgress = IDLE_PROGRESS
  private progressListeners = new Set<() => void>()

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
    trackFx.subscribe(this.updateGains)
    this.synthGroup.onTrackMuteChanged.subscribe(this.onMuteChanged)
  }

  get isEnabled() {
    return this.enabled
  }

  subscribeProgress = (listener: () => void) => {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  getProgress = () => this.progress

  private setProgress(next: VocalProgress) {
    this.progress = next
    this.progressListeners.forEach((listener) => listener())
  }

  // Phrases that failed are asked for again; the ones already generated are cache hits.
  retry = () => {
    if (!this.enabled) {
      return
    }
    this.job = null
    this.refresh()
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
      this.setProgress(IDLE_PROGRESS)
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
      trackSubs = song.tracks.flatMap((t) => [
        t.onChanged.subscribe(this.onEdited),
        t.subscribeEventsChanged(isVolumeEvent, this.updateGains),
        t.subscribeEventsChanged(isPanEvent, this.updateGains),
      ])
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
      // velocities of the notes may have changed
      this.updateGains()
      this.refresh()
    }, EDIT_DEBOUNCE_MS)
  }

  // Mute/solo decides which tracks are sung, so the phrases to play change at once.
  private onMuteChanged = () => {
    if (this.enabled) {
      this.refresh()
    }
  }

  private chainFor(trackId: TrackId, ctx: AudioContext, out: GainNode) {
    let chain = this.chains.get(trackId)
    if (chain === undefined) {
      chain = createTrackChain(ctx, out)
      this.chains.set(trackId, chain)
      this.scheduleChain(trackId, chain)
    }
    return chain
  }

  // Volume / pan automation and note velocities of the track, as gain / pan automation of its
  // vocal from the playing position on. Done again when playback (re)starts and on any change.
  private scheduleChain(trackId: TrackId, chain: TrackChain) {
    const ctx = this.ctx
    const anchor = this.anchor
    const song = this.songStore.song
    const track = song.getTrack(trackId)
    if (ctx === null || anchor === null || track === undefined) {
      return
    }
    scheduleCurves(chain, trackCurves(song, track), {
      fromSec: anchor.sec + (ctx.currentTime - anchor.ctxTime),
      nowCtx: ctx.currentTime,
      toCtx: (sec) => anchor.ctxTime + (sec - anchor.sec) + PLAY_LATENCY_SEC,
    }, trackFx.get(track))
  }

  private updateGains = () => {
    for (const [trackId, chain] of this.chains) {
      this.scheduleChain(trackId, chain)
    }
  }

  private onSongReplaced = () => {
    for (const chain of this.chains.values()) {
      disconnectTrackChain(chain)
    }
    this.chains.clear()
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
    return tickToSec(this.player.position, song.timebase, getSongTempos(song))
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
    this.updateGains()
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
    source.connect(this.chainFor(chunk.trackId, this.ctx, this.gain).velocity)
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
    const bodies = buildVocalBodies(song, this.synthGroup.trackMute)
    const key = JSON.stringify(bodies)
    if (this.job?.key === key) {
      return this.job.promise
    }
    const token = ++this.jobToken
    if (bodies.length === 0) {
      this.chunks = []
      this.wanted = new Set()
      this.abortStale(this.wanted)
      this.setProgress(IDLE_PROGRESS)
      this.syncSources()
      const promise = Promise.resolve<VocalChunk[]>([])
      this.job = { key, promise }
      return promise
    }
    const promise = this.runJob(bodies, token)
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

  private async planTrack(body: VocalBody): Promise<VocalChunkInfo[]> {
    const key = JSON.stringify(body)
    const known = this.plans.get(key)
    if (known !== undefined) {
      return known
    }
    const plan = await activityJson<{ chunks: VocalChunkInfo[] }>(
      "/api/vocal/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
      },
    )
    this.plans.set(key, plan.chunks)
    if (this.plans.size > 64) {
      const oldest = this.plans.keys().next().value
      if (oldest !== undefined) {
        this.plans.delete(oldest)
      }
    }
    return plan.chunks
  }

  private async runJob(
    bodies: { trackId: TrackId; body: VocalBody }[],
    token: number,
  ): Promise<VocalChunk[]> {
    this.setProgress({ ...IDLE_PROGRESS, phase: "planning" })
    let items: { trackId: TrackId; body: VocalBody; info: VocalChunkInfo }[]
    try {
      const planned = await Promise.all(
        bodies.map(async ({ trackId, body }) => ({
          trackId,
          body,
          infos: await this.planTrack(body),
        })),
      )
      items = planned.flatMap(({ trackId, body, infos }) =>
        infos.map((info) => ({ trackId, body, info })),
      )
    } catch (e) {
      if (token === this.jobToken) {
        this.setProgress({
          ...IDLE_PROGRESS,
          phase: "error",
          error: errorMessage(e),
        })
      }
      throw e
    }
    if (token !== this.jobToken) {
      return this.chunks
    }
    this.wanted = new Set(items.map(({ info }) => info.hash))
    // Whatever is still being generated for an older version of the song is dropped now, so
    // the new phrases do not queue behind a result nobody is waiting for any more.
    this.abortStale(this.wanted)
    const ready = () =>
      items.flatMap(({ trackId, info }) => {
        const buffer = this.buffers.get(info.hash)
        return buffer
          ? [
              {
                trackId,
                hash: info.hash,
                start: info.start_sec,
                end: info.end_sec,
                buffer,
              },
            ]
          : []
      })
    const failures: string[] = []
    const publish = () => {
      if (token === this.jobToken) {
        this.chunks = ready()
        this.syncSources()
        this.setProgress({
          phase: this.chunks.length === items.length ? "done" : "generating",
          total: items.length,
          done: this.chunks.length,
          failed: failures.length,
          ...(failures.length > 0
            ? { error: failures[failures.length - 1] }
            : {}),
        })
      }
    }

    // Unchanged phrases are already decoded: they play right away, only new ones are generated.
    publish()
    for (const { body, info } of items) {
      if (token !== this.jobToken) {
        return this.chunks
      }
      if (!this.buffers.has(info.hash)) {
        // One phrase that cannot be generated (the synth rejects it) must not stop the
        // phrases after it: note the failure and carry on.
        try {
          await this.getBuffer(body, info)
        } catch (e) {
          if (token !== this.jobToken) {
            return this.chunks
          }
          failures.push(errorMessage(e))
        }
        publish()
      }
    }
    this.pruneBuffers()
    if (token === this.jobToken && failures.length > 0) {
      this.setProgress({
        phase: "error",
        total: items.length,
        done: this.chunks.length,
        failed: failures.length,
        error: failures[failures.length - 1],
      })
    }
    if (failures.length > 0) {
      // the exporter needs every phrase: let it (and the next refresh) see the failure
      throw new Error(
        `${failures.length} phrase(s) could not be generated: ${failures[0]}`,
      )
    }
    return ready()
  }

  private getBuffer(
    body: VocalBody,
    info: VocalChunkInfo,
  ): Promise<AudioBuffer> {
    const cached = this.buffers.get(info.hash)
    if (cached) {
      return Promise.resolve(cached)
    }
    const running = this.inflight.get(info.hash)
    if (running) {
      return running
    }
    const ctx = this.ensureContext()
    const controller = new AbortController()
    const promise = this.fetchChunk(body, info, controller.signal)
      .then((wav) => ctx.decodeAudioData(wav))
      .then((buffer) => {
        this.buffers.set(info.hash, buffer)
        return buffer
      })
      .finally(() => {
        this.inflight.delete(info.hash)
        if (this.controllers.get(info.hash) === controller) {
          this.controllers.delete(info.hash)
        }
      })
    this.inflight.set(info.hash, promise)
    this.controllers.set(info.hash, controller)
    return promise
  }

  // Aborts the phrases being generated that the song no longer contains (edited, muted,
  // deleted...). The fetch loop ends, and the bot is told to cancel the job: it stops
  // GPT-SoVITS, so the GPU is free for the new phrases at once.
  private abortStale(wanted: ReadonlySet<string>) {
    const stale: string[] = []
    for (const [hash, controller] of this.controllers) {
      if (!wanted.has(hash)) {
        controller.abort()
        this.controllers.delete(hash)
        stale.push(hash)
      }
    }
    if (stale.length === 0) {
      return
    }
    void activityFetch(
      "/api/vocal/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: stale }),
      },
      [200],
    ).catch(() => {
      // best effort: the job just runs to the end (and is cached) if this fails
    })
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
    signal: AbortSignal,
  ): Promise<ArrayBuffer> {
    const started = performance.now()
    for (;;) {
      const res = await activityFetch(
        "/api/vocal/chunk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, index: info.index, hash: info.hash }),
          signal,
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
      await sleep(Math.max(1, Number(retry?.retry_after) || 10) * 1000, signal)
      if (!this.wanted.has(info.hash)) {
        // the song moved on and nothing needs this phrase any more
        throw new Error("Vocal phrase no longer needed")
      }
    }
  }
}
