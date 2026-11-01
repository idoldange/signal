import {
  isNoteEvent,
  isPanEvent,
  isVolumeEvent,
  type Song,
  type Track,
} from "@signal-app/core"
import { getSongTempos } from "./songToUstx"
import { tickToSec } from "./time"
import { panFromCc } from "./trackVolume"

// The level of a vocal track changes over the song: its volume and pan automation (the
// controller lanes under the piano roll) and the velocity of each note. The synthesized
// vocal is plain audio, so these are applied to it here, as gain / pan automation.

export interface CurvePoint {
  sec: number
  value: number
}

export interface TrackCurves {
  // CC7 / 100: 1 = the default volume
  volume: CurvePoint[]
  // CC10 as -1 (left) .. 1 (right)
  pan: CurvePoint[]
  // velocity / 100 at the start of each note
  velocity: CurvePoint[]
}

const bySec = (a: CurvePoint, b: CurvePoint) => a.sec - b.sec

export const trackCurves = (song: Song, track: Track): TrackCurves => {
  const tempos = getSongTempos(song)
  const sec = (tick: number) => tickToSec(tick, song.timebase, tempos)
  const volume: CurvePoint[] = []
  const pan: CurvePoint[] = []
  const velocity: CurvePoint[] = []
  for (const event of track.events) {
    if (isNoteEvent(event)) {
      velocity.push({ sec: sec(event.tick), value: event.velocity / 100 })
    }
    if (isVolumeEvent(event)) {
      volume.push({ sec: sec(event.tick), value: event.value / 100 })
    }
    if (isPanEvent(event)) {
      pan.push({ sec: sec(event.tick), value: panFromCc(event.value) })
    }
  }
  return {
    volume: volume.sort(bySec),
    pan: pan.sort(bySec),
    velocity: velocity.sort(bySec),
  }
}

// value in force at `sec`: the last point at or before it, else `fallback`
export const valueAt = (
  points: readonly CurvePoint[],
  sec: number,
  fallback: number,
): number => {
  let value = fallback
  for (const point of points) {
    if (point.sec > sec) {
      break
    }
    value = point.value
  }
  return value
}

// velocity -> volume -> pan -> out
export interface TrackChain {
  velocity: GainNode
  volume: GainNode
  pan: StereoPannerNode
}

export const createTrackChain = (
  ctx: BaseAudioContext,
  out: AudioNode,
): TrackChain => {
  const velocity = ctx.createGain()
  const volume = ctx.createGain()
  const pan = ctx.createStereoPanner()
  velocity.connect(volume)
  volume.connect(pan)
  pan.connect(out)
  return { velocity, volume, pan }
}

export const disconnectTrackChain = (chain: TrackChain) => {
  chain.velocity.disconnect()
  chain.volume.disconnect()
  chain.pan.disconnect()
}

export interface ScheduleTime {
  // song time that is playing now
  fromSec: number
  // audio context time of "now"
  nowCtx: number
  // song time -> audio context time
  toCtx: (sec: number) => number
}

const scheduleParam = (
  param: AudioParam,
  points: readonly CurvePoint[],
  fallback: number,
  time: ScheduleTime,
) => {
  param.cancelScheduledValues(time.nowCtx)
  param.setValueAtTime(valueAt(points, time.fromSec, fallback), time.nowCtx)
  for (const point of points) {
    if (point.sec > time.fromSec) {
      param.setValueAtTime(
        point.value,
        Math.max(time.nowCtx, time.toCtx(point.sec)),
      )
    }
  }
}

export const scheduleCurves = (
  chain: TrackChain,
  curves: TrackCurves,
  time: ScheduleTime,
) => {
  scheduleParam(chain.volume.gain, curves.volume, 1, time)
  scheduleParam(chain.pan.pan, curves.pan, 0, time)
  scheduleParam(chain.velocity.gain, curves.velocity, 1, time)
}
