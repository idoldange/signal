import { type NotePitch, type NoteVibrato, samplePitch } from "@signal-app/core"

// Vibrato maths (same as the synth engine) and the drag handles drawn in the pitch tool.
// x = ms from the note start, y = tenths of a semitone, like the pitch points.

export type VibratoHandleKind = "length" | "in" | "out" | "depth" | "period" | "shift" | "drift" | "volLink"

export interface VibratoHandle {
  kind: VibratoHandleKind
  x: number
  y: number
}

export const vibratoSpan = (v: NoteVibrato, noteMs: number) => {
  const lenMs = (noteMs * v.length) / 100
  return { startMs: noteMs - lenMs, lenMs }
}

// vibrato offset in cents at x ms from the note start
export const vibratoCents = (v: NoteVibrato, noteMs: number, x: number) => {
  const { startMs, lenMs } = vibratoSpan(v, noteMs)
  const u = (x - startMs) / Math.max(lenMs, 1e-6)
  if (u < 0 || u > 1) {
    return 0
  }
  const env = Math.max(
    0,
    Math.min(
      1,
      Math.min(u / Math.max(v.in / 100, 1e-3), (1 - u) / Math.max(v.out / 100, 1e-3)),
    ),
  )
  return (
    Math.min(v.depth, 80) *
    env *
    (Math.sin(2 * Math.PI * ((x - startMs) / v.period + v.shift / 100)) +
      v.drift / 100)
  )
}

export const vibratoHandles = (
  pitch: NotePitch,
  noteMs: number,
): VibratoHandle[] => {
  const v = pitch.vibrato
  if (v === undefined) {
    return []
  }
  const { startMs, lenMs } = vibratoSpan(v, noteMs)
  const base = (x: number) => samplePitch(pitch, x)
  const top = v.depth / 10
  const px = startMs + v.period
  return [
    { kind: "length", x: startMs, y: base(startMs) },
    { kind: "in", x: startMs + (lenMs * v.in) / 100, y: base(startMs) + top },
    {
      kind: "out",
      x: noteMs - (lenMs * v.out) / 100,
      y: base(noteMs) + top,
    },
    { kind: "depth", x: startMs + lenMs / 2, y: base(startMs + lenMs / 2) + top },
    { kind: "period", x: px, y: base(px) - top },
    {
      kind: "shift",
      x: startMs + (v.period * v.shift) / 100,
      y: base(startMs) - top * 1.6,
    },
    {
      kind: "drift",
      x: startMs + lenMs * 0.75,
      y: base(startMs + lenMs * 0.75) + (top * v.drift) / 100,
    },
    {
      kind: "volLink",
      x: startMs + lenMs * 0.25,
      y: base(startMs + lenMs * 0.25) - top * 1.6 + (top * v.volLink) / 100,
    },
  ]
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
const r1 = (v: number) => Math.round(v * 10) / 10

// New vibrato after dragging a handle to (x ms, y tenths-of-semitone) of the note.
export const dragVibrato = (
  pitch: NotePitch,
  noteMs: number,
  kind: VibratoHandleKind,
  x: number,
  y: number,
): NoteVibrato => {
  const v = pitch.vibrato as NoteVibrato
  const { startMs, lenMs } = vibratoSpan(v, noteMs)
  switch (kind) {
    case "length":
      return { ...v, length: r1(clamp(((noteMs - x) / noteMs) * 100, 5, 100)) }
    case "in":
      return { ...v, in: r1(clamp(((x - startMs) / lenMs) * 100, 0, 100)) }
    case "out":
      return { ...v, out: r1(clamp(((noteMs - x) / lenMs) * 100, 0, 100)) }
    case "depth":
      return {
        ...v,
        depth: r1(clamp((y - samplePitch(pitch, x)) * 10, 5, 200)),
      }
    case "shift":
      return { ...v, shift: r1(clamp(((x - startMs) / v.period) * 100, 0, 100)) }
    case "drift":
      return {
        ...v,
        drift: r1(clamp(((y - samplePitch(pitch, x)) / (v.depth / 10)) * 100, -100, 100)),
      }
    case "volLink":
      return {
        ...v,
        volLink: r1(
          clamp(
            ((y - samplePitch(pitch, x) + (v.depth / 10) * 1.6) / (v.depth / 10)) * 100,
            -100,
            100,
          ),
        ),
      }
    case "period":
      return { ...v, period: r1(clamp(x - startMs, 20, 500)) }
  }
}
