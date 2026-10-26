import {
  type NotePitch,
  normalizePitch,
  vibratoKeys,
} from "../entities/event/NotePitch"

// A note's pitch bend is stored in the MIDI file as a Sequencer Specific meta event placed on the
// same tick as the note (like its Lyric event). The data starts with the 4 characters "ArNP"
// ("Signal" itself uses the prefix "Sign"), followed by compact JSON:
//   {"n": noteNumber, "s": snapFirst ? 1 : 0, "p": [[x, y, shape], ...]}
// Other software ignores sequencer specific events it does not know.
const PREFIX = Array.from("ArNP", (c) => c.charCodeAt(0))

export const isPitchEventData = (data: readonly number[]): boolean =>
  data.length > PREFIX.length && PREFIX.every((byte, i) => data[i] === byte)

export const encodePitchData = (
  noteNumber: number,
  pitch: NotePitch,
): number[] => {
  const json = JSON.stringify({
    n: noteNumber,
    s: pitch.snapFirst ? 1 : 0,
    p: pitch.points.map((p) => [p.x, p.y, p.shape]),
    ...(pitch.pitd === undefined
      ? {}
      : { d: pitch.pitd.map((p) => [p.x, p.y]) }),
    ...(pitch.vibrato === undefined
      ? {}
      : { v: vibratoKeys.map((k) => pitch.vibrato?.[k] ?? 0) }),
  })
  return [...PREFIX, ...new TextEncoder().encode(json)]
}

export const decodePitchData = (
  data: readonly number[],
): { noteNumber: number; pitch: NotePitch } | undefined => {
  if (!isPitchEventData(data)) {
    return undefined
  }
  try {
    const text = new TextDecoder("utf-8").decode(
      Uint8Array.from(data.slice(PREFIX.length)),
    )
    const body = JSON.parse(text) as {
      n?: unknown
      s?: unknown
      p?: unknown
      v?: unknown
      d?: unknown
    }
    if (typeof body.n !== "number" || !Array.isArray(body.p)) {
      return undefined
    }
    const pitch = normalizePitch({
      snapFirst: body.s !== 0,
      pitd: Array.isArray(body.d)
        ? body.d.map((q: unknown) => {
            const [x, y] = Array.isArray(q) ? q : []
            return { x, y }
          })
        : undefined,
      vibrato: Array.isArray(body.v)
        ? Object.fromEntries(
            vibratoKeys.map((k, i) => [k, (body.v as unknown[])[i]]),
          )
        : undefined,
      points: body.p.map((item: unknown) => {
        const [x, y, shape] = Array.isArray(item) ? item : []
        return { x, y, shape }
      }),
    })
    return pitch === undefined ? undefined : { noteNumber: body.n, pitch }
  } catch {
    return undefined
  }
}
