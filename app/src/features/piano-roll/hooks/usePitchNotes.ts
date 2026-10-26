import type { NoteEvent, NotePitch, PitchPoint } from "@signal-app/core"
import { hasPitch } from "@signal-app/core"
import { useMemo } from "react"
import { useSong } from "../../../hooks/useSong"
import {
  displayPoints,
  type NeighbourNote,
  pitchOrDefault,
} from "../entities/pitchCurve"
import { PitchGeometry } from "../entities/PitchGeometry"
import { useNoteEvents } from "./useEventView"
import { useIsRhythmTrack } from "./useIsRhythmTrack"
import { useNoteCoordTransform } from "./useNoteCoordTransform"
import { useSongTempos } from "./useSongTempos"

export interface PitchNoteEntry {
  note: NoteEvent
  startMs: number
  endMs: number
  // true when the note has its own pitch bend (otherwise `pitch` is the flat default)
  stored: boolean
  pitch: NotePitch
  // control points as they sound (snap first applied)
  points: readonly PitchPoint[]
  prev: NeighbourNote | undefined
}

// How far (ms) a note still owns a pitch drawn after its end / before its start.
const TAIL_MS = 400
const LEAD_MS = 150

export const findPitchOwner = (
  entries: readonly PitchNoteEntry[],
  absMs: number,
): PitchNoteEntry | undefined => {
  let last: PitchNoteEntry | undefined
  let next: PitchNoteEntry | undefined
  for (const entry of entries) {
    if (entry.startMs <= absMs) {
      last = entry
    } else {
      next = entry
      break
    }
  }
  if (last !== undefined && absMs <= last.endMs + TAIL_MS) {
    return last
  }
  if (next !== undefined && next.startMs - absMs <= LEAD_MS) {
    return next
  }
  return undefined
}

// Notes of the selected track (visible range) with their pitch bend and pixel geometry.
export const usePitchNotes = () => {
  const { transform } = useNoteCoordTransform()
  const { timebase } = useSong()
  const tempos = useSongTempos()
  const noteEvents = useNoteEvents()
  const isRhythmTrack = useIsRhythmTrack()

  const geometry = useMemo(
    () => new PitchGeometry(transform, timebase, tempos),
    [transform, timebase, tempos],
  )

  const entries = useMemo((): PitchNoteEntry[] => {
    if (isRhythmTrack) {
      return []
    }
    const sorted = [...noteEvents].sort(
      (a, b) => a.tick - b.tick || a.noteNumber - b.noteNumber,
    )
    const byEnd = new Map<number, NoteEvent>()
    for (const note of sorted) {
      byEnd.set(note.tick + note.duration, note)
    }
    return sorted.map((note) => {
      const pitch = pitchOrDefault(note.pitch)
      const prev = byEnd.get(note.tick)
      return {
        note,
        startMs: geometry.tickToMs(note.tick),
        endMs: geometry.tickToMs(note.tick + note.duration),
        stored: hasPitch(note.pitch),
        pitch,
        points: displayPoints(pitch, note, prev === note ? undefined : prev),
        prev,
      }
    })
  }, [noteEvents, isRhythmTrack, geometry])

  return { geometry, entries }
}
