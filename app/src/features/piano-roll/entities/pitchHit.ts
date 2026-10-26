import type { Point } from "@signal-app/geometry"
import type { PitchNoteEntry } from "../hooks/usePitchNotes"
import type { PitchGeometry } from "./PitchGeometry"

export const PITCH_HIT_RADIUS = 7

export interface PitchPointHit {
  entry: PitchNoteEntry
  index: number
}

// The control point closest to `pixel` (piano roll content coordinates), within `radius` pixels.
export const hitTestPitchPoint = (
  entries: readonly PitchNoteEntry[],
  geometry: PitchGeometry,
  pixel: Point,
  radius = PITCH_HIT_RADIUS,
): PitchPointHit | undefined => {
  let best: PitchPointHit | undefined
  let bestDistance = radius * radius
  for (const entry of entries) {
    entry.points.forEach((point, index) => {
      const p = geometry.pointToPixel(entry.note, entry.startMs, point)
      const distance = (p.x - pixel.x) ** 2 + (p.y - pixel.y) ** 2
      if (distance <= bestDistance) {
        best = { entry, index }
        bestDistance = distance
      }
    })
  }
  return best
}
