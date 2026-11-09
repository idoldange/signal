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

// velocity -> volume -> pan -> smooth -> out, plus the echo send: pan -> pre-delay -> reverb -> wet -> out
export interface TrackChain {
  velocity: GainNode
  volume: GainNode
  pan: StereoPannerNode
  smooth: BiquadFilterNode
  dry: GainNode
  preDelay: DelayNode
  reverb: ConvolverNode
  wet: GainNode
}

// Karaoke-style room: dense, dark, smooth tail (no discrete repeats). Cached per context.
const impulses = new WeakMap<BaseAudioContext, AudioBuffer>()
const karaokeImpulse = (ctx: BaseAudioContext): AudioBuffer => {
  const cached = impulses.get(ctx)
  if (cached !== undefined) {
    return cached
  }
  const seconds = 1.6
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < length; i++) {
      const t = i / length
      const white = Math.random() * 2 - 1
      // the tail gets darker as it decays
      const k = 0.55 - 0.45 * t
      lp += k * (white - lp)
      data[i] = lp * (1 - t) ** 2.6 * 2.2
    }
  }
  impulses.set(ctx, buffer)
  return buffer
}

export const createTrackChain = (
  ctx: BaseAudioContext,
  out: AudioNode,
): TrackChain => {
  const velocity = ctx.createGain()
  const volume = ctx.createGain()
  const pan = ctx.createStereoPanner()
  const smooth = ctx.createBiquadFilter()
  smooth.type = "lowpass"
  smooth.frequency.value = 20000
  smooth.Q.value = 0.5
  const dry = ctx.createGain()
  const preDelay = ctx.createDelay(0.2)
  preDelay.delayTime.value = 0.03
  const reverb = ctx.createConvolver()
  reverb.buffer = karaokeImpulse(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0
  velocity.connect(volume)
  volume.connect(pan)
  pan.connect(smooth)
  smooth.connect(dry)
  dry.connect(out)
  smooth.connect(preDelay)
  preDelay.connect(reverb)
  reverb.connect(wet)
  wet.connect(out)
  return { velocity, volume, pan, smooth, dry, preDelay, reverb, wet }
}

export const disconnectTrackChain = (chain: TrackChain) => {
  for (const node of Object.values(chain)) {
    node.disconnect()
  }
}

// echo 0 = off. 1..100: wet level and how much the voice is smoothed (the top is rolled off).
export const applyEcho = (chain: TrackChain, echo: number) => {
  const amount = Math.max(0, Math.min(100, echo)) / 100
  chain.wet.gain.value = amount * 0.7
  chain.dry.gain.value = 1 - amount * 0.12
  chain.smooth.frequency.value = amount > 0 ? 16000 - amount * 8000 : 20000
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
  slope = false,
) => {
  param.cancelScheduledValues(time.nowCtx)
  let start = valueAt(points, time.fromSec, fallback)
  if (slope) {
    // inside a ramp: start part way along it
    const next = points.findIndex((p) => p.sec > time.fromSec)
    if (next > 0) {
      const a = points[next - 1]
      const b = points[next]
      start =
        a.value + ((b.value - a.value) * (time.fromSec - a.sec)) / (b.sec - a.sec)
    }
  }
  param.setValueAtTime(start, time.nowCtx)
  for (const point of points) {
    if (point.sec > time.fromSec) {
      const at = Math.max(time.nowCtx, time.toCtx(point.sec))
      if (slope) {
        param.linearRampToValueAtTime(point.value, at)
      } else {
        param.setValueAtTime(point.value, at)
      }
    }
  }
}

export const scheduleCurves = (
  chain: TrackChain,
  curves: TrackCurves,
  time: ScheduleTime,
  fx: { echo: number; slope: boolean } = { echo: 0, slope: false },
) => {
  applyEcho(chain, fx.echo)
  scheduleParam(chain.volume.gain, curves.volume, 1, time, fx.slope)
  scheduleParam(chain.pan.pan, curves.pan, 0, time)
  scheduleParam(chain.velocity.gain, curves.velocity, 1, time)
}
