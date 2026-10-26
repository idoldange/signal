import {
  hasPitch,
  type NotePitch,
  type NoteVibrato,
  PITCH_X_MAX,
  PITCH_X_MIN,
  PITCH_Y_LIMIT,
  type PitchPoint,
  type PitchShape,
  samplePitch,
} from "@signal-app/core"

// Pure edits of a note's pitch bend. Every function returns a new NotePitch (never mutates), so
// the result can be written straight to the note with updateNote.
// x = ms from the note start, y = tenths of a semitone (see NotePitch in @signal-app/core).

export const MAX_PITCH_POINTS = 256
const MIN_GAP_MS = 1

const round1 = (value: number) => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

// OpenUtau's default control points of a note: flat, around the note start.
export const DEFAULT_PITCH_POINTS: readonly PitchPoint[] = [
  { x: -25, y: 0, shape: "io" },
  { x: 25, y: 0, shape: "io" },
]

// What the editor shows for a note: its pitch bend, or the flat default when it has none. The
// default does not glide from the previous note (snapFirst off), so notes that were never edited
// keep sounding as before.
export const pitchOrDefault = (pitch: NotePitch | undefined): NotePitch =>
  hasPitch(pitch)
    ? pitch
    : { points: DEFAULT_PITCH_POINTS, snapFirst: false }

export interface NeighbourNote {
  tick: number
  duration: number
  noteNumber: number
}

// The points as they sound: with "snap first" the first point starts at the pitch of the
// previous note when the two touch, like OpenUtau.
export const displayPoints = (
  pitch: NotePitch,
  note: { tick: number; noteNumber: number },
  prev: NeighbourNote | undefined,
): readonly PitchPoint[] => {
  if (!pitch.snapFirst || pitch.points.length === 0) {
    return pitch.points
  }
  const touching = prev !== undefined && prev.tick + prev.duration === note.tick
  const y = touching ? (prev.noteNumber - note.noteNumber) * 10 : 0
  return [{ ...pitch.points[0], y }, ...pitch.points.slice(1)]
}

export const movePoint = (
  pitch: NotePitch,
  index: number,
  x: number,
  y: number,
): NotePitch => {
  const { points } = pitch
  if (index < 0 || index >= points.length) {
    return pitch
  }
  const low = index > 0 ? points[index - 1].x + MIN_GAP_MS : PITCH_X_MIN
  const high =
    index < points.length - 1 ? points[index + 1].x - MIN_GAP_MS : PITCH_X_MAX
  // the first point of a "snap first" note follows the previous note, and the last point always
  // ends on the note's own pitch (y = 0), like OpenUtau: only x can change for those
  const lockY = index === 0 && pitch.snapFirst
  const isLast = points.length > 1 && index === points.length - 1
  const moved: PitchPoint = {
    ...points[index],
    x: round1(clamp(x, low, Math.max(low, high))),
    y: isLast
      ? 0
      : lockY
        ? points[index].y
        : round1(clamp(y, -PITCH_Y_LIMIT, PITCH_Y_LIMIT)),
  }
  return { ...pitch, points: points.map((p, i) => (i === index ? moved : p)) }
}

export const addPoint = (
  pitch: NotePitch,
  point: { x: number; y: number },
): NotePitch => {
  if (pitch.points.length >= MAX_PITCH_POINTS) {
    return pitch
  }
  const x = round1(clamp(point.x, PITCH_X_MIN, PITCH_X_MAX))
  if (pitch.points.some((p) => Math.abs(p.x - x) < MIN_GAP_MS)) {
    return pitch
  }
  const added: PitchPoint = {
    x,
    y: round1(clamp(point.y, -PITCH_Y_LIMIT, PITCH_Y_LIMIT)),
    shape: "io",
  }
  return {
    ...pitch,
    points: [...pitch.points, added].sort((a, b) => a.x - b.x),
  }
}

// Removing the last point removes the pitch bend altogether (undefined).
export const removePoint = (
  pitch: NotePitch,
  index: number,
): NotePitch | undefined =>
  pitch.points.length <= 1
    ? undefined
    : { ...pitch, points: pitch.points.filter((_, i) => i !== index) }

export const setPointShape = (
  pitch: NotePitch,
  index: number,
  shape: PitchShape,
): NotePitch => ({
  ...pitch,
  points: pitch.points.map((p, i) => (i === index ? { ...p, shape } : p)),
})

export const toggleSnapFirst = (pitch: NotePitch): NotePitch => ({
  ...pitch,
  snapFirst: !pitch.snapFirst,
})

export interface PitchSample {
  x: number
  y: number
}

// Keeps samples at least `minDx` ms apart (and always the last one).
const thin = (samples: readonly PitchSample[], minDx: number): PitchSample[] => {
  const sorted = [...samples].sort((a, b) => a.x - b.x)
  const out: PitchSample[] = []
  for (const sample of sorted) {
    if (out.length === 0 || sample.x - out[out.length - 1].x >= minDx) {
      out.push(sample)
    }
  }
  const last = sorted[sorted.length - 1]
  if (last !== undefined && out[out.length - 1] !== last) {
    if (last.x - out[out.length - 1].x >= MIN_GAP_MS) {
      out.push(last)
    } else {
      out[out.length - 1] = last
    }
  }
  return out
}

// Freehand drawing: the points that fall inside [from, to] are replaced by the drawn samples
// (linear between them); everything outside is kept.
export const drawPitch = (
  base: NotePitch | undefined,
  samples: readonly PitchSample[],
  from: number,
  to: number,
): NotePitch => {
  const start = pitchOrDefault(base)
  if (samples.length === 0) {
    return start
  }
  const kept = start.points.filter((p) => p.x < from - 0.5 || p.x > to + 0.5)
  let spacing = 8
  let drawn = thin(samples, spacing)
  while (kept.length + drawn.length > MAX_PITCH_POINTS && spacing < 400) {
    spacing *= 1.5
    drawn = thin(samples, spacing)
  }
  const points: PitchPoint[] = [
    ...kept,
    ...drawn.map(
      (s): PitchPoint => ({
        x: round1(clamp(s.x, PITCH_X_MIN, PITCH_X_MAX)),
        y: round1(clamp(s.y, -PITCH_Y_LIMIT, PITCH_Y_LIMIT)),
        shape: "l",
      }),
    ),
  ].sort((a, b) => a.x - b.x)
  const spaced = points.filter(
    (p, i) => i === 0 || p.x - points[i - 1].x >= MIN_GAP_MS,
  )
  return { ...start, points: spaced.slice(0, MAX_PITCH_POINTS) }
}

// Replaces the points inside [from, to] by `fresh` and keeps the others.
const replaceRange = (
  base: NotePitch | undefined,
  from: number,
  to: number,
  fresh: readonly PitchPoint[],
): NotePitch => {
  const start = pitchOrDefault(base)
  const kept = start.points.filter((p) => p.x < from - 0.5 || p.x > to + 0.5)
  const all = [
    ...kept,
    ...fresh.map((p) => ({
      x: round1(clamp(p.x, PITCH_X_MIN, PITCH_X_MAX)),
      y: round1(clamp(p.y, -PITCH_Y_LIMIT, PITCH_Y_LIMIT)),
      shape: p.shape,
    })),
  ].sort((a, b) => a.x - b.x)
  const spaced = all.filter(
    (p, i) => i === 0 || p.x - all[i - 1].x >= MIN_GAP_MS,
  )
  return { ...start, points: spaced.slice(0, MAX_PITCH_POINTS) }
}

// Straight line ("l") or smooth transition ("io") from a to b (either order).
export const linePitch = (
  base: NotePitch | undefined,
  a: PitchSample,
  b: PitchSample,
  shape: PitchShape,
): NotePitch => {
  const [p, q] = a.x <= b.x ? [a, b] : [b, a]
  if (q.x - p.x < MIN_GAP_MS) {
    return pitchOrDefault(base)
  }
  return replaceRange(base, p.x, q.x, [
    { ...p, shape },
    { ...q, shape: "io" },
  ])
}

export const SINE_PERIOD_MS = 200

// Sine wave centred on a.y from a.x to b.x; the amplitude is the vertical distance of b.
export const sinePitch = (
  base: NotePitch | undefined,
  a: PitchSample,
  b: PitchSample,
  period = SINE_PERIOD_MS,
): NotePitch => {
  const [p, q] = a.x <= b.x ? [a, b] : [b, a]
  const length = q.x - p.x
  if (length < MIN_GAP_MS) {
    return pitchOrDefault(base)
  }
  const amplitude = Math.abs(b.y - a.y)
  const step = Math.max(period / 8, length / (MAX_PITCH_POINTS / 2))
  const fresh: PitchPoint[] = []
  for (let dx = 0; dx <= length + 1e-6; dx += step) {
    fresh.push({
      x: p.x + dx,
      y: a.y + amplitude * Math.sin((2 * Math.PI * dx) / period),
      shape: "l",
    })
  }
  return replaceRange(base, p.x, q.x, fresh)
}

// Moving average of the curve inside [from, to] (a brush stroke); notes without pitch are kept.
export const smoothPitch = (
  base: NotePitch | undefined,
  from: number,
  to: number,
  radius = 3,
): NotePitch | undefined => {
  if (!hasPitch(base)) {
    return base
  }
  const STEP = 10
  const xs: number[] = []
  for (let x = from; x <= to; x += STEP) {
    xs.push(x)
  }
  if (xs.length < 3) {
    return base
  }
  const ys = xs.map((x) => samplePitch(base, x))
  const fresh = xs.map((x, i) => {
    let sum = 0
    let count = 0
    for (let k = -radius; k <= radius; k++) {
      if (i + k >= 0 && i + k < ys.length) {
        sum += ys[i + k]
        count++
      }
    }
    return { x, y: sum / count, shape: "l" as const }
  })
  return replaceRange(base, xs[0], xs[xs.length - 1], fresh)
}

// Deletes the points inside [from, to]; the pitch is removed when none is left.
export const erasePitch = (
  base: NotePitch | undefined,
  from: number,
  to: number,
): NotePitch | undefined => {
  if (!hasPitch(base)) {
    return base
  }
  const kept = base.points.filter((p) => p.x < from || p.x > to)
  const pitd = base.pitd?.filter((p) => p.x < from || p.x > to)
  const rest = {
    ...(base.vibrato === undefined ? {} : { vibrato: base.vibrato }),
    ...(pitd === undefined || pitd.length === 0 ? {} : { pitd }),
  }
  if (kept.length > 0) {
    const { pitd: _drop, ...others } = base
    return { ...others, ...rest, points: kept }
  }
  return Object.keys(rest).length === 0
    ? undefined
    : { ...pitchOrDefault(undefined), ...rest }
}

// Overwrite layer: `samples` are the drawn heights (absolute); what is stored is how far they are
// from `curve` (the curve as it sounds), so the layer follows later edits of the curve.
export const overwritePitch = (
  base: NotePitch | undefined,
  curve: NotePitch,
  samples: readonly PitchSample[],
  from: number,
  to: number,
): NotePitch => {
  const start = pitchOrDefault(base)
  const fresh = thin(samples, 4).map((s) => ({
    x: s.x,
    y: round1(s.y - samplePitch(curve, s.x)),
  }))
  const kept = (start.pitd ?? []).filter((p) => p.x < from || p.x > to)
  const pitd = [...kept, ...fresh].sort((a, b) => a.x - b.x).slice(0, 512)
  return { ...start, pitd }
}

export const DEFAULT_VIBRATO: NoteVibrato = {
  length: 50,
  period: 175,
  depth: 25,
  in: 10,
  out: 10,
  shift: 0,
  drift: 0,
  volLink: 0,
}

// Sets (or removes) the vibrato; a note left with nothing but the flat default loses its pitch.
export const setVibrato = (
  base: NotePitch | undefined,
  vibrato: NoteVibrato | undefined,
): NotePitch | undefined => {
  const { vibrato: _old, ...rest } = pitchOrDefault(base)
  if (vibrato !== undefined) {
    return { ...rest, vibrato }
  }
  const flat =
    !hasPitch(base) ||
    (!rest.snapFirst &&
      rest.points.length === 2 &&
      rest.points.every(
        (p, i) =>
          p.x === DEFAULT_PITCH_POINTS[i].x &&
          p.y === 0 &&
          p.shape === "io",
      ))
  return flat ? undefined : rest
}
