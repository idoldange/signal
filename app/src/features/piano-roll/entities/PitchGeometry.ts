import type { Point } from "@signal-app/geometry"
import { msToTick, type TempoMap, tickToMs } from "../../../arona/pitchTime"
import type { NoteCoordTransform } from "./NoteCoordTransform"

// Converts between a note's pitch points (ms from the note start, tenths of a semitone) and
// pixels of the piano roll content (before scrolling).
export class PitchGeometry {
  constructor(
    private readonly transform: NoteCoordTransform,
    private readonly ppq: number,
    private readonly tempos: TempoMap,
  ) {}

  get pixelsPerKey() {
    return this.transform.pixelsPerKey
  }

  tickToMs = (tick: number) => tickToMs(tick, this.ppq, this.tempos)

  pixelToMs = (x: number) => this.tickToMs(this.transform.getTick(x))

  // vertical center of the row of a note number
  centerY = (noteNumber: number) =>
    this.transform.getY(noteNumber) + this.transform.pixelsPerKey / 2

  pointToPixel(
    note: { noteNumber: number },
    startMs: number,
    point: { x: number; y: number },
  ): Point {
    const tick = msToTick(startMs + point.x, this.ppq, this.tempos)
    return {
      x: this.transform.getX(tick),
      y:
        this.centerY(note.noteNumber) -
        (point.y / 10) * this.transform.pixelsPerKey,
    }
  }

  pixelToPoint(
    note: { noteNumber: number },
    startMs: number,
    pixel: Point,
  ): { x: number; y: number } {
    return {
      x: this.pixelToMs(pixel.x) - startMs,
      y:
        ((this.centerY(note.noteNumber) - pixel.y) /
          this.transform.pixelsPerKey) *
        10,
    }
  }
}
