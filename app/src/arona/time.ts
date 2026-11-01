export const tickToSec = (
  tick: number,
  ppq: number,
  tempos: readonly [number, number][],
) => {
  let sec = 0
  let prevTick = 0
  let prevBpm = tempos[0]?.[1] ?? 120
  for (const [t, bpm] of tempos.slice(1)) {
    if (t >= tick) {
      break
    }
    sec += ((t - prevTick) * 60) / (prevBpm * ppq)
    prevTick = t
    prevBpm = bpm
  }
  return sec + ((tick - prevTick) * 60) / (prevBpm * ppq)
}
