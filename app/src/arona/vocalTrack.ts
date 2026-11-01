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
