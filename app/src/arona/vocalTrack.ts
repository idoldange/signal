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
    flagListeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void) {
    flagListeners.add(listener)
    return () => {
      flagListeners.delete(listener)
    }
  },
}

export const isVocalTrack = (track: Track): boolean =>
  vocalTrackFlags.has(track) || hasLyricNotes(track)

export const getVocalTrackIds = (song: Song): Set<TrackId> =>
  new Set(song.tracks.filter(isVocalTrack).map((t) => t.id))
