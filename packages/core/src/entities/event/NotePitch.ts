// Pitch bend of a single note, in the same units as OpenUtau (USTX) and UTAU (UST):
// - x: milliseconds from the start of the note (may be negative to start the glide early)
// - y: tenths of a semitone (10 cents) relative to the note's own pitch
// - shape: how the curve travels from this point to the next one
//     io = sine in-out (default), l = linear, i = sine in, o = sine out, sp = spline (cubic through
//     the neighbouring points)
export type PitchShape = "io" | "l" | "i" | "o" | "sp"

export const pitchShapes: readonly PitchShape[] = ["io", "l", "i", "o", "sp"]

export interface PitchPoint {
  x: number
  y: number
  shape: PitchShape
}

// Vibrato of a note (OpenUtau units): sits at the END of the note.
//   length  % of the note it covers      period  ms of one wave        depth  cents (amplitude)
//   in/out  % of the vibrato that fades  shift   % phase offset        drift  % pitch drift
//   volLink % link to volume
export interface NoteVibrato {
  length: number
  period: number
  depth: number
  in: number
  out: number
  shift: number
  drift: number
  volLink: number
}

export const vibratoLimits: Record<keyof NoteVibrato, [number, number, number]> = {
  length: [0, 100, 0],
  period: [5, 500, 175],
  depth: [0, 200, 25],
  in: [0, 100, 10],
  out: [0, 100, 10],
  shift: [0, 100, 0],
  drift: [-100, 100, 0],
  volLink: [-100, 100, 0],
}

export const vibratoKeys = Object.keys(vibratoLimits) as (keyof NoteVibrato)[]

export const normalizeVibrato = (value: unknown): NoteVibrato | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined
  }
  const raw = value as Record<string, unknown>
  const out = {} as NoteVibrato
  for (const key of vibratoKeys) {
    const [lo, hi, def] = vibratoLimits[key]
    const v = key === "volLink" ? (raw["volLink"] ?? raw["vol_link"]) : raw[key]
    out[key] =
      typeof v === "number" && Number.isFinite(v)
        ? Math.round(Math.max(lo, Math.min(hi, v)) * 10) / 10
        : def
  }
  return out.length > 0 && out.depth > 0 ? out : undefined
}

// Overwrite layer: pitch deviation added on top of the curve (x ms from the note start, y 0.1
// semitone). It is 0 outside the drawn range.
export interface PitchOffsetPoint {
  x: number
  y: number
}

export const MAX_OFFSET_POINTS = 512

export const normalizeOffset = (
  value: unknown,
): PitchOffsetPoint[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }
  const out: PitchOffsetPoint[] = []
  for (const item of value.slice(0, MAX_OFFSET_POINTS)) {
    const { x, y } = (item ?? {}) as { x?: unknown; y?: unknown }
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      out.push({
        x: Math.round(Math.max(PITCH_X_MIN, Math.min(PITCH_X_MAX, x)) * 10) / 10,
        y:
          Math.round(Math.max(-PITCH_Y_LIMIT, Math.min(PITCH_Y_LIMIT, y)) * 10) /
          10,
      })
    }
  }
  out.sort((a, b) => a.x - b.x)
  return out.length === 0 ? undefined : out
}

export const sampleOffset = (
  offset: readonly PitchOffsetPoint[] | undefined,
  x: number,
): number => {
  if (offset === undefined || offset.length === 0) {
    return 0
  }
  if (x < offset[0].x || x > offset[offset.length - 1].x) {
    return 0
  }
  for (let i = 0; i < offset.length - 1; i++) {
    const a = offset[i]
    const b = offset[i + 1]
    if (x >= a.x && x <= b.x) {
      return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
    }
  }
  return offset[offset.length - 1].y
}

export interface NotePitch {
  pitd?: readonly PitchOffsetPoint[] | undefined
  vibrato?: NoteVibrato | undefined
  points: readonly PitchPoint[]
  // The first point follows the previous note when the two touch (OpenUtau "snap first")
  snapFirst: boolean
}

export const PITCH_X_MIN = -2000
export const PITCH_X_MAX = 120000
export const PITCH_Y_LIMIT = 1200

const round1 = (value: number) => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const isShape = (value: unknown): value is PitchShape =>
  typeof value === "string" && (pitchShapes as readonly string[]).includes(value)

// Accepts anything (parsed JSON, a file, ...) and returns a clean pitch or undefined when
// there is nothing worth keeping. Points are sorted by x and rounded to 0.1.
export const normalizePitch = (value: unknown): NotePitch | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined
  }
  const vibrato = normalizeVibrato((value as { vibrato?: unknown }).vibrato)
  const pitd = normalizeOffset((value as { pitd?: unknown }).pitd)
  const rawPoints = (value as { points?: unknown }).points
  if (!Array.isArray(rawPoints) && vibrato === undefined && pitd === undefined) {
    return undefined
  }
  const raw: unknown[] = Array.isArray(rawPoints) ? rawPoints : []
  const points: PitchPoint[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue
    }
    const { x, y, shape } = item as { x?: unknown; y?: unknown; shape?: unknown }
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue
    }
    points.push({
      x: round1(clamp(x, PITCH_X_MIN, PITCH_X_MAX)),
      y: round1(clamp(y, -PITCH_Y_LIMIT, PITCH_Y_LIMIT)),
      shape: isShape(shape) ? shape : "io",
    })
  }
  if (points.length === 0) {
    // vibrato only: flat curve that does not glide from the previous note
    return vibrato === undefined && pitd === undefined
      ? undefined
      : {
          points: [
            { x: -25, y: 0, shape: "io" },
            { x: 25, y: 0, shape: "io" },
          ],
          snapFirst: false,
          ...(vibrato === undefined ? {} : { vibrato }),
          ...(pitd === undefined ? {} : { pitd }),
        }
  }
  points.sort((a, b) => a.x - b.x)
  const snapFirst = (value as { snapFirst?: unknown }).snapFirst
  return {
    points,
    snapFirst: snapFirst !== false,
    ...(vibrato === undefined ? {} : { vibrato }),
    ...(pitd === undefined ? {} : { pitd }),
  }
}

export const hasPitch = (pitch: NotePitch | undefined): pitch is NotePitch =>
  pitch !== undefined && pitch.points.length > 0

// Value of the curve (tenths of a semitone) at `x` ms from the note start. The curve holds its
// first/last value outside its points, like OpenUtau.
export const samplePitch = (pitch: NotePitch, x: number): number => {
  const { points } = pitch
  if (points.length === 0) {
    return 0
  }
  if (x <= points[0].x) {
    return points[0].y
  }
  const last = points[points.length - 1]
  if (x >= last.x) {
    return last.y
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (x >= a.x && x <= b.x) {
      const u = b.x === a.x ? 1 : (x - a.x) / (b.x - a.x)
      return segmentY(points, i, u)
    }
  }
  return last.y
}

// Value of segment i (from points[i] to points[i + 1]) at u in 0..1. Spline segments are cubic
// Hermite curves whose tangents come from the neighbouring points (Catmull-Rom).
export const segmentY = (
  points: readonly { x: number; y: number; shape: PitchShape }[],
  i: number,
  u: number,
): number => {
  const a = points[i]
  const b = points[i + 1]
  if (a.shape !== "sp") {
    return a.y + (b.y - a.y) * easePitch(a.shape, u)
  }
  const dx = b.x - a.x
  const slope = dx === 0 ? 0 : (b.y - a.y) / dx
  const p = points[i - 1]
  const n = points[i + 2]
  const m0 = p === undefined || b.x === p.x ? slope : (b.y - p.y) / (b.x - p.x)
  const m1 = n === undefined || n.x === a.x ? slope : (n.y - a.y) / (n.x - a.x)
  const u2 = u * u
  const u3 = u2 * u
  return (
    (2 * u3 - 3 * u2 + 1) * a.y +
    (u3 - 2 * u2 + u) * dx * m0 +
    (-2 * u3 + 3 * u2) * b.y +
    (u3 - u2) * dx * m1
  )
}

// Curve points with the overwrite layer baked in (used where the target has no such layer).
export const bakePitchOffset = (
  pitch: NotePitch,
  points: readonly PitchPoint[] = pitch.points,
): PitchPoint[] => {
  const off = pitch.pitd
  if (off === undefined || off.length === 0) {
    return [...points]
  }
  const x0 = off[0].x
  const x1 = off[off.length - 1].x
  const curve = { ...pitch, points }
  const xs = [
    ...new Set([
      ...off.map((p) => p.x),
      ...points.map((p) => p.x).filter((x) => x > x0 && x < x1),
    ]),
  ].sort((a, b) => a - b)
  return [
    ...points.filter((p) => p.x < x0),
    ...xs.map(
      (x): PitchPoint => ({
        x,
        y: Math.round((samplePitch(curve, x) + sampleOffset(off, x)) * 10) / 10,
        shape: "l",
      }),
    ),
    ...points.filter((p) => p.x > x1),
  ]
}

export const easePitch = (shape: PitchShape, u: number): number => {
  switch (shape) {
    case "l":
      return u
    case "i":
      return 1 - Math.cos((u * Math.PI) / 2)
    case "o":
      return Math.sin((u * Math.PI) / 2)
    default:
      return 0.5 - 0.5 * Math.cos(u * Math.PI)
  }
}
