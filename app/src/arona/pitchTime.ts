// Pitch bend points are positioned in milliseconds (like OpenUtau), the piano roll in ticks.
// These convert between the two along the song's tempo map ([tick, bpm][], first entry at 0).
export type TempoMap = readonly (readonly [number, number])[]

export const tickToMs = (
  tick: number,
  ppq: number,
  tempos: TempoMap,
): number => {
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
  return (sec + ((tick - prevTick) * 60) / (prevBpm * ppq)) * 1000
}

export const msToTick = (
  ms: number,
  ppq: number,
  tempos: TempoMap,
): number => {
  const target = ms / 1000
  let sec = 0
  let prevTick = 0
  let prevBpm = tempos[0]?.[1] ?? 120
  for (const [t, bpm] of tempos.slice(1)) {
    const segment = ((t - prevTick) * 60) / (prevBpm * ppq)
    if (sec + segment >= target) {
      break
    }
    sec += segment
    prevTick = t
    prevBpm = bpm
  }
  return prevTick + ((target - sec) * prevBpm * ppq) / 60
}
