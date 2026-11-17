import {
  isNoteEvent,
  type Song,
  type Track,
  type TrackEvent,
  type TrackId,
} from "@signal-app/core"

// A "vocal track" is any non-conductor track whose notes carry lyrics. This is the same
// criterion the vocal synth uses, and it survives saving/loading as MIDI (lyrics are stored
// as Lyric events), so no extra flag has to be stored on the track.
export const hasLyric = (event: TrackEvent): boolean =>
  isNoteEvent(event) &&
  typeof event.lyric === "string" &&
  event.lyric.trim() !== ""

// True when the notes themselves carry lyrics (scans the events).
export const hasLyricNotes = (track: Track): boolean =>
  !track.isConductorTrack && track.events.some(hasLyric)

// Tracks the user marked as "Arona Vocal" in the instrument picker (or that came from a
// vocal track of an imported project), so a track can be a vocal track before its first
// lyric is typed. Keyed by the Track object, so nothing has to be reset when a song is
// replaced and flags disappear together with their tracks.
const flagged = new WeakSet<Track>()
const flagListeners = new Set<() => void>()
const notifyListeners = () => flagListeners.forEach((listener) => listener())

export const vocalTrackFlags = {
  has: (track: Track) => flagged.has(track),
  set(track: Track, value: boolean) {
    if (flagged.has(track) === value) {
      return
    }
    if (value) {
      flagged.add(track)
    } else {
      flagged.delete(track)
    }
    notifyListeners()
  },
  subscribe(listener: () => void) {
    flagListeners.add(listener)
    return () => {
      flagListeners.delete(listener)
    }
  },
}

// Manual transpose (semitones) of one vocal track. A track without an entry is on "auto":
// the whole song shares ONE octave shift that is worked out from all the auto tracks
// together, so the phrases of different tracks never end up in different octaves.
// A manual value is absolute (relative to the notes as written) and ignores the auto shift.
// Shares the listeners of the flags, so the vocal is regenerated when a value changes.
const transposes = new WeakMap<Track, number>()

export const vocalTrackTranspose = {
  get: (track: Track): number | null => transposes.get(track) ?? null,
  set(track: Track, value: number | null) {
    const next = value === null ? null : Math.round(value)
    if ((transposes.get(track) ?? null) === next) {
      return
    }
    if (next === null) {
      transposes.delete(track)
    } else {
      transposes.set(track, next)
    }
    notifyListeners()
  },
}

// Same centre as the server (arona/activity/chunking.py auto_transpose, voice_center).
const VOICE_CENTER = 66

// The notes of a track that the vocal synth sings (same rule as buildVocalBody).
const singingTones = (track: Track): number[] => {
  const all = vocalTrackFlags.has(track)
  const tones: number[] = []
  for (const event of track.events) {
    if (!isNoteEvent(event)) {
      continue
    }
    const lyric = event.lyric?.trim() ?? ""
    if ((lyric !== "" || all) && lyric.toLowerCase() !== "r") {
      tones.push(event.noteNumber)
    }
  }
  return tones
}

// The octave shift every auto track of the song shares: a multiple of 12 that moves the
// median of all auto notes closest to the voice centre. Tracks with a manual transpose do
// not take part, so changing one track never moves the rest of the song.
export const autoTransposeOf = (song: Song): number => {
  const tones: number[] = []
  for (const track of song.tracks) {
    if (track.isConductorTrack || vocalTrackTranspose.get(track) !== null) {
      continue
    }
    tones.push(...singingTones(track))
  }
  if (tones.length === 0) {
    return 0
  }
  tones.sort((a, b) => a - b)
  const mid = tones.length >> 1
  const median =
    tones.length % 2 ? tones[mid] : (tones[mid - 1] + tones[mid]) / 2
  return 12 * Math.round((VOICE_CENTER - median) / 12)
}

export const isVocalTrack = (track: Track): boolean =>
  vocalTrackFlags.has(track) || hasLyricNotes(track)

export const getVocalTrackIds = (song: Song): Set<TrackId> =>
  new Set(song.tracks.filter(isVocalTrack).map((t) => t.id))

// Singing language. Resolved per note: the note's own {xx} tag at the start of its lyric, else
// the language of its track, else the one of the project (song), else "auto" (the server
// detects it from the text). The tag lives in the lyric, so it survives MIDI/USTX files.
export const VOCAL_LANGS = ["ja", "en", "zh", "ko", "yue"] as const
export type VocalLang = (typeof VOCAL_LANGS)[number]

export const VOCAL_LANG_LABELS: Record<VocalLang, string> = {
  ja: "Japanese",
  en: "English",
  zh: "Chinese",
  ko: "Korean",
  yue: "Cantonese",
}

export const isVocalLang = (value: unknown): value is VocalLang =>
  typeof value === "string" &&
  (VOCAL_LANGS as readonly string[]).includes(value)

const LANG_TAG = /^\{(ja|en|zh|ko|yue)\}/

export const splitLangTag = (
  lyric: string,
): { lang: VocalLang | null; text: string } => {
  const match = LANG_TAG.exec(lyric)
  return match === null
    ? { lang: null, text: lyric }
    : { lang: match[1] as VocalLang, text: lyric.slice(match[0].length) }
}

// The lyric with its language tag replaced (null = no tag, follow the track / project).
export const withLangTag = (lyric: string, lang: VocalLang | null): string => {
  const { text } = splitLangTag(lyric)
  return lang === null ? text : `{${lang}}${text}`
}

const songLangs = new WeakMap<Song, VocalLang>()
const trackLangs = new WeakMap<Track, VocalLang>()

const setLang = <K extends object>(
  map: WeakMap<K, VocalLang>,
  key: K,
  lang: VocalLang | null,
) => {
  if ((map.get(key) ?? null) === lang) {
    return
  }
  if (lang === null) {
    map.delete(key)
  } else {
    map.set(key, lang)
  }
  notifyListeners()
}

export const vocalLanguage = {
  ofSong: (song: Song): VocalLang | null => songLangs.get(song) ?? null,
  setSong: (song: Song, lang: VocalLang | null) =>
    setLang(songLangs, song, lang),
  ofTrack: (track: Track): VocalLang | null => trackLangs.get(track) ?? null,
  setTrack: (track: Track, lang: VocalLang | null) =>
    setLang(trackLangs, track, lang),
  // {trackIndex: lang} of the tracks that have their own language (saved with the project)
  tracksOf: (song: Song): Record<string, VocalLang> => {
    const out: Record<string, VocalLang> = {}
    song.tracks.forEach((track, index) => {
      const lang = trackLangs.get(track)
      if (lang !== undefined) {
        out[String(index)] = lang
      }
    })
    return out
  },
  restore: (
    song: Song,
    lang: unknown,
    tracks: Record<string, unknown> | null,
  ) => {
    if (isVocalLang(lang)) {
      songLangs.set(song, lang)
    }
    for (const [index, value] of Object.entries(tracks ?? {})) {
      const track = song.tracks[Number(index)]
      if (track !== undefined && isVocalLang(value)) {
        trackLangs.set(track, value)
      }
    }
    notifyListeners()
  },
}

// "Even stretch" mode of a vocal track: skip the syllable alignment and stretch each phrase evenly
// (fallback when the automatic alignment of a track keeps missing the beat).
const stretched = new WeakSet<Track>()
export const vocalTrackStretch = {
  has: (track: Track) => stretched.has(track),
  set(track: Track, value: boolean) {
    if (stretched.has(track) === value) {
      return
    }
    if (value) {
      stretched.add(track)
    } else {
      stretched.delete(track)
    }
    notifyListeners()
  },
}

// Manual syllable nudge of a note: a <+30> / <-20> tag (milliseconds) at the start of the lyric
// text (after the optional {xx} language tag). Positive = the syllable starts later in the
// generated voice, negative = earlier. It lives in the lyric so it survives MIDI/USTX files.
const LEADING_TAGS = /^(?:<[+-]?\d{1,4}>|<t\d*\.?\d+>|<s\d{1,10}>)+/
// How far a syllable boundary may be moved from the automatic one. The server applies the
// same limit; within a phrase the neighbours (20 ms apart) are the real constraint.
export const MAX_NUDGE_MS = 3000

// Tags at the start of the lyric text (after the optional {xx} language tag):
//   <+30> / <-20>  syllable nudge in ms        <t0.7>  temperature       <s123>  seed
// They live in the lyric so they survive MIDI/USTX files.
export interface LyricTags {
  nudge: number
  temp: number | null
  seed: number | null
  text: string
}

export const splitTags = (text: string): LyricTags => {
  const out: LyricTags = { nudge: 0, temp: null, seed: null, text }
  const match = LEADING_TAGS.exec(text)
  if (match === null) {
    return out
  }
  out.text = text.slice(match[0].length)
  for (const tag of match[0].match(/<[^>]+>/g) ?? []) {
    if (tag[1] === "t") {
      out.temp = Number(tag.slice(2, -1))
    } else if (tag[1] === "s") {
      out.seed = Number(tag.slice(2, -1))
    } else {
      out.nudge = Number(tag.slice(1, -1))
    }
  }
  return out
}

export const splitNudge = (text: string): { nudge: number; text: string } => {
  const { nudge, text: rest } = splitTags(text)
  return { nudge, text: rest }
}

// The lyric with some tags replaced (null = remove that tag, undefined = keep it).
export const withTags = (
  lyric: string,
  patch: { nudge?: number; temp?: number | null; seed?: number | null },
): string => {
  const { lang, text } = splitLangTag(lyric)
  const cur = splitTags(text)
  const ms = Math.max(
    -MAX_NUDGE_MS,
    Math.min(MAX_NUDGE_MS, Math.round(patch.nudge ?? cur.nudge)),
  )
  const temp = patch.temp === undefined ? cur.temp : patch.temp
  const seed = patch.seed === undefined ? cur.seed : patch.seed
  const tags =
    (ms === 0 ? "" : `<${ms > 0 ? "+" : ""}${ms}>`) +
    (temp === null ? "" : `<t${Math.round(temp * 100) / 100}>`) +
    (seed === null ? "" : `<s${Math.round(seed)}>`)
  return `${lang === null ? "" : `{${lang}}`}${tags}${cur.text}`
}

export const withNudge = (lyric: string, nudge: number): string =>
  withTags(lyric, { nudge })

export const nudgeOf = (lyric: string): number =>
  splitTags(splitLangTag(lyric).text).nudge

// Generation settings (temperature / seed) of a project and of each vocal track. A note can
// override them with its own <t..>/<s..> tags; precedence: note > track > project.
export interface VocalGen {
  temperature?: number
  seed?: number
}
export type VocalGenChange = {
  temperature?: number | null
  seed?: number | null
}

const songGen = new WeakMap<Song, VocalGen>()
const trackGen = new WeakMap<Track, VocalGen>()

const changeGen = <K extends object>(
  map: WeakMap<K, VocalGen>,
  key: K,
  change: VocalGenChange,
) => {
  const next: VocalGen = { ...(map.get(key) ?? {}) }
  if (change.temperature !== undefined) {
    if (change.temperature === null) {
      delete next.temperature
    } else {
      next.temperature = change.temperature
    }
  }
  if (change.seed !== undefined) {
    if (change.seed === null) {
      delete next.seed
    } else {
      next.seed = change.seed
    }
  }
  if (Object.keys(next).length === 0) {
    map.delete(key)
  } else {
    map.set(key, next)
  }
  notifyListeners()
}

export const vocalGen = {
  ofSong: (song: Song): VocalGen => songGen.get(song) ?? {},
  ofTrack: (track: Track): VocalGen => trackGen.get(track) ?? {},
  setSong: (song: Song, change: VocalGenChange) =>
    changeGen(songGen, song, change),
  setTrack: (track: Track, change: VocalGenChange) =>
    changeGen(trackGen, track, change),
  resolved: (song: Song, track: Track): VocalGen => ({
    ...songGen.get(song),
    ...trackGen.get(track),
  }),
}

export const MAX_SEED = 2147483646
export const randomSeed = () => Math.floor(Math.random() * MAX_SEED) + 1

// Playback-only effects of one track: "echo" is a karaoke-style reverb that also smooths the voice
// (0 = off, 1..100 = intensity); "slope" makes the volume lane ramp between its points instead of
// stepping (columns). They never change the generated voice, so they have their own listeners.
export interface TrackFx {
  echo: number
  slope: boolean
  // "smooth": each sung phrase fades in at its start and out at its end (0 = off, 1..100 = intensity)
  smooth: number
}
const fxMap = new WeakMap<Track, TrackFx>()
const fxListeners = new Set<() => void>()
const NO_FX: TrackFx = { echo: 0, slope: false, smooth: 0 }
export const trackFx = {
  get: (track: Track): TrackFx => fxMap.get(track) ?? NO_FX,
  set(track: Track, change: Partial<TrackFx>) {
    const prev = trackFx.get(track)
    const next: TrackFx = {
      echo: Math.max(0, Math.min(100, Math.round(change.echo ?? prev.echo))),
      slope: change.slope ?? prev.slope,
      smooth: Math.max(
        0,
        Math.min(100, Math.round(change.smooth ?? prev.smooth)),
      ),
    }
    if (
      next.echo === prev.echo &&
      next.slope === prev.slope &&
      next.smooth === prev.smooth
    ) {
      return
    }
    if (next.echo === 0 && !next.slope && next.smooth === 0) {
      fxMap.delete(track)
    } else {
      fxMap.set(track, next)
    }
    fxListeners.forEach((l) => l())
  },
  subscribe(listener: () => void) {
    fxListeners.add(listener)
    return () => {
      fxListeners.delete(listener)
    }
  },
}

// Per-track state that is not stored in the MIDI itself (flag "Arona Vocal", manual transpose):
// {vocal: [trackIndex], transpose: {trackIndex: semitones}} travels with every save.
export interface VocalSaveMeta {
  vocal: number[]
  transpose: Record<string, number>
  stretch?: number[]
  gen?: VocalGen
  trackGen?: Record<string, VocalGen>
  fx?: Record<string, TrackFx>
}

export const vocalSaveMeta = {
  of: (song: Song): VocalSaveMeta => {
    const meta: VocalSaveMeta = { vocal: [], transpose: {}, stretch: [] }
    if (Object.keys(vocalGen.ofSong(song)).length > 0) {
      meta.gen = vocalGen.ofSong(song)
    }
    song.tracks.forEach((track, index) => {
      if (Object.keys(vocalGen.ofTrack(track)).length > 0) {
        meta.trackGen ??= {}
        meta.trackGen[String(index)] = vocalGen.ofTrack(track)
      }
      const fx = trackFx.get(track)
      if (fx.echo > 0 || fx.slope || fx.smooth > 0) {
        meta.fx ??= {}
        meta.fx[String(index)] = { ...fx }
      }
      if (vocalTrackStretch.has(track)) {
        meta.stretch?.push(index)
      }
      if (vocalTrackFlags.has(track)) {
        meta.vocal.push(index)
      }
      const t = vocalTrackTranspose.get(track)
      if (t !== null) {
        meta.transpose[String(index)] = t
      }
    })
    return meta
  },
  restore: (song: Song, raw: unknown) => {
    if (typeof raw !== "object" || raw === null) {
      return
    }
    const meta = raw as Partial<VocalSaveMeta>
    for (const index of Array.isArray(meta.vocal) ? meta.vocal : []) {
      const track = song.tracks[Number(index)]
      if (track !== undefined) {
        vocalTrackFlags.set(track, true)
      }
    }
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined
    const restoreGen = (g: unknown): VocalGenChange => {
      const o = (typeof g === "object" && g !== null ? g : {}) as VocalGen
      const out: VocalGenChange = {}
      const temperature = num(o.temperature)
      if (temperature !== undefined) {
        out.temperature = temperature
      }
      const seed = num(o.seed)
      if (seed !== undefined) {
        out.seed = seed
      }
      return out
    }
    if (meta.gen !== undefined) {
      vocalGen.setSong(song, restoreGen(meta.gen))
    }
    for (const [index, g] of Object.entries(meta.trackGen ?? {})) {
      const track = song.tracks[Number(index)]
      if (track !== undefined) {
        vocalGen.setTrack(track, restoreGen(g))
      }
    }
    for (const [index, f] of Object.entries(meta.fx ?? {})) {
      const track = song.tracks[Number(index)]
      if (track !== undefined && typeof f === "object" && f !== null) {
        trackFx.set(track, {
          echo: num((f as TrackFx).echo) ?? 0,
          slope: (f as TrackFx).slope === true,
          smooth: num((f as TrackFx).smooth) ?? 0,
        })
      }
    }
    for (const index of Array.isArray(meta.stretch) ? meta.stretch : []) {
      const track = song.tracks[Number(index)]
      if (track !== undefined) {
        vocalTrackStretch.set(track, true)
      }
    }
    for (const [index, value] of Object.entries(meta.transpose ?? {})) {
      const track = song.tracks[Number(index)]
      if (track !== undefined && typeof value === "number") {
        vocalTrackTranspose.set(track, value)
      }
    }
  },
}

// Everything vocal that lives next to the song (not in it): languages, vocal flags, transposes,
// align mode, temperature / seed, echo. Undo / redo rebuild the whole Song (new Track objects), so
// the history snapshots this and puts it back, otherwise Ctrl+Z would reset all of it.
export interface VocalSnapshot {
  lang: VocalLang | null
  tracks: Record<string, VocalLang>
  meta: VocalSaveMeta
}

export const vocalSnapshot = {
  of: (song: Song): VocalSnapshot => ({
    lang: vocalLanguage.ofSong(song),
    tracks: vocalLanguage.tracksOf(song),
    meta: vocalSaveMeta.of(song),
  }),
  restore: (song: Song, snap: VocalSnapshot) => {
    vocalLanguage.restore(song, snap.lang, snap.tracks)
    vocalSaveMeta.restore(song, snap.meta)
  },
}
