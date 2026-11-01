import {
  isNoteEvent,
  isPanEvent,
  isProgramChangeEvent,
  isVolumeEvent,
  type Track,
  type TrackColor,
  type TrackEvent,
  type TrackId,
} from "@signal-app/core"
import { useCallback, useSyncExternalStore } from "react"
import { trackPan, trackVolume } from "../arona/trackVolume"
import {
  hasLyricNotes,
  vocalTrackFlags,
  vocalTrackTranspose,
} from "../arona/vocalTrack"
import { TrackMute } from "../trackMute/TrackMute"
import { usePlayer } from "./usePlayer"
import { useSong } from "./useSong"
import { useTrackMute } from "./useTrackMute"

const noop = () => () => {}

// Scanning every note on each render is wasteful; the result is cached per track and
// dropped whenever the track's notes change (or the last subscriber goes away).
const vocalTrackCache = new WeakMap<Track, boolean>()

export function useTrack(id: TrackId) {
  const { getTrack } = useSong()
  const track = getTrack(id)

  return {
    get isRhythmTrack() {
      return useSyncExternalStore(
        track?.onIsRhythmTrackChanged.subscribe ?? noop,
        useCallback(() => track?.isRhythmTrack ?? false, [track]),
      )
    },
    get isConductorTrack() {
      return useSyncExternalStore(
        track?.onIsConductorTrackChanged.subscribe ?? noop,
        useCallback(() => track?.isConductorTrack ?? false, [track]),
      )
    },
    get isVocalTrack() {
      const subscribe = useCallback(
        (listener: () => void) => {
          if (!track) {
            return () => {}
          }
          const unsubscribe = track.subscribeEventsChanged(isNoteEvent, () => {
            vocalTrackCache.delete(track)
            listener()
          })
          const unsubscribeFlags = vocalTrackFlags.subscribe(listener)
          return () => {
            unsubscribe()
            unsubscribeFlags()
            vocalTrackCache.delete(track)
          }
        },
        [track],
      )
      const getSnapshot = useCallback(() => {
        if (!track) {
          return false
        }
        if (vocalTrackFlags.has(track)) {
          return true
        }
        let value = vocalTrackCache.get(track)
        if (value === undefined) {
          value = hasLyricNotes(track)
          vocalTrackCache.set(track, value)
        }
        return value
      }, [track])
      return useSyncExternalStore(subscribe, getSnapshot)
    },
    // Manual transpose of a vocal track in semitones, null = auto octave.
    get vocalTranspose() {
      return useSyncExternalStore(
        vocalTrackFlags.subscribe,
        useCallback(
          () => (track ? vocalTrackTranspose.get(track) : null),
          [track],
        ),
      )
    },
    // Pan of the track (MIDI pan at the start of the song, 64 = centre).
    get pan() {
      return useSyncExternalStore(
        useCallback(
          (listener: () => void) =>
            track?.subscribeEventsChanged(isPanEvent, listener) ?? noop,
          [track],
        ),
        useCallback(() => (track ? trackPan(track) : 64), [track]),
      )
    },
    // Volume of the track (MIDI volume at the start of the song), default 100.
    get volume() {
      return useSyncExternalStore(
        useCallback(
          (listener: () => void) =>
            track?.subscribeEventsChanged(isVolumeEvent, listener) ?? noop,
          [track],
        ),
        useCallback(() => (track ? trackVolume(track) : 100), [track]),
      )
    },
    get programNumber() {
      const { position } = usePlayer()
      const subscribe = useCallback(
        (listener: () => void) =>
          track?.subscribeEventsChanged(isProgramChangeEvent, listener) ?? noop,
        [track],
      )
      const getSnapshot = useCallback(
        () => track?.getProgramChangeEvent(position)?.value ?? 0,
        [position, track],
      )
      return useSyncExternalStore(subscribe, getSnapshot)
    },
    get name() {
      return useSyncExternalStore(
        track?.onNameChanged.subscribe ?? noop,
        useCallback(() => track?.name, [track]),
      )
    },
    get channel() {
      return useSyncExternalStore(
        track?.onChannelChanged.subscribe ?? noop,
        useCallback(() => track?.channel, [track]),
      )
    },
    get color() {
      return useSyncExternalStore(
        track?.onColorChanged.subscribe ?? noop,
        useCallback(() => track?.color, [track]),
      )
    },
    get isMuted() {
      const { trackMute } = useTrackMute()
      const isMuted = TrackMute.isMuted(id)(trackMute)
      return isMuted
    },
    get isSolo() {
      const { trackMute } = useTrackMute()
      const isSolo = TrackMute.isSolo(id)(trackMute)
      return isSolo
    },
    updateEvent: useCallback(
      <T extends TrackEvent>(id: number, obj: Partial<T>) => {
        track?.updateEvent(id, obj)
      },
      [track],
    ),
    removeEvent: useCallback(
      (id: number) => {
        track?.removeEvent(id)
      },
      [track],
    ),
    removeEvents: useCallback(
      (ids: readonly number[]) => {
        track?.removeEvents(ids)
      },
      [track],
    ),
    setColor: useCallback(
      (color: TrackColor | null) => {
        track?.setColor(color)
      },
      [track],
    ),
    setName: useCallback(
      (name: string) => {
        track?.setName(name)
      },
      [track],
    ),
    setChannel: useCallback(
      (channel: number | undefined) => {
        if (track) {
          track.channel = channel
        }
      },
      [track],
    ),
    setProgramNumberAt: useCallback(
      (tick: number, programNumber: number) => {
        return track?.setProgramNumberAt(tick, programNumber)
      },
      [track],
    ),
    insertProgramChangeAt: useCallback(
      (tick: number, programNumber: number) => {
        return track?.insertProgramChangeAt(tick, programNumber)
      },
      [track],
    ),
    setProgramNumberById: useCallback(
      (eventId: number, programNumber: number) => {
        return track?.setProgramNumberById(eventId, programNumber)
      },
      [track],
    ),
    hasProgramChangeEventAfter: useCallback(
      (tick: number) => {
        return track?.hasProgramChangeEventAfter(tick) ?? false
      },
      [track],
    ),
    setPan: useCallback(
      (pan: number, tick: number) => {
        track?.setPan(pan, tick)
      },
      [track],
    ),
    setVolume: useCallback(
      (volume: number, tick: number) => {
        track?.setVolume(volume, tick)
      },
      [track],
    ),
  }
}
