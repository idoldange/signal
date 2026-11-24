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

export interface Phrase {
  startSec: number
  endSec: number
}

export interface TrackCurves {
  // sung phrases: runs of notes separated by a real pause (see PHRASE_GAP_SEC)
  phrases: Phrase[]
  // CC7 / 100: 1 = the default volume
  volume: CurvePoint[]
  // CC10 as -1 (left) .. 1 (right)
  pan: CurvePoint[]
  // velocity / 100 at the start of each note
  velocity: CurvePoint[]
}

const bySec = (a: CurvePoint, b: CurvePoint) => a.sec - b.sec

// a pause longer than this between two notes starts a new phrase
const PHRASE_GAP_SEC = 0.35

export const trackCurves = (song: Song, track: Track): TrackCurves => {
  const tempos = getSongTempos(song)
  const sec = (tick: number) => tickToSec(tick, song.timebase, tempos)
  const volume: CurvePoint[] = []
  const pan: CurvePoint[] = []
  const velocity: CurvePoint[] = []
  const spans: Phrase[] = []
  for (const event of track.events) {
    if (isNoteEvent(event)) {
      velocity.push({ sec: sec(event.tick), value: event.velocity / 100 })
      spans.push({
        startSec: sec(event.tick),
        endSec: sec(event.tick + event.duration),
      })
    }
    if (isVolumeEvent(event)) {
      volume.push({ sec: sec(event.tick), value: event.value / 100 })
    }
    if (isPanEvent(event)) {
      pan.push({ sec: sec(event.tick), value: panFromCc(event.value) })
    }
  }
  spans.sort((a, b) => a.startSec - b.startSec)
  const phrases: Phrase[] = []
  for (const span of spans) {
    const last = phrases[phrases.length - 1]
    if (last !== undefined && span.startSec - last.endSec <= PHRASE_GAP_SEC) {
      last.endSec = Math.max(last.endSec, span.endSec)
    } else {
      phrases.push({ ...span })
    }
  }
  return {
    phrases,
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

// velocity -> volume -> pan -> phrase -> smooth -> out, plus the echo send: pan -> pre-delay -> reverb -> wet -> out
export interface TrackChain {
  velocity: GainNode
  volume: GainNode
  pan: StereoPannerNode
  // "Smooth": fades each sung phrase in and out
  phrase: GainNode
  // "Smooth" big-room send: phrase -> pre-delay -> hall -> wet -> out
  hallPre: DelayNode
  hall: ConvolverNode
  hallWet: GainNode
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

// Big hall: a long, dark, diffuse tail that blooms in slowly (no discrete repeats), so notes blur into
// each other and a phrase dies away into the room. Cached per context.
const hallImpulses = new WeakMap<BaseAudioContext, AudioBuffer>()
const hallImpulse = (ctx: BaseAudioContext): AudioBuffer => {
  const cached = hallImpulses.get(ctx)
  if (cached !== undefined) {
    return cached
  }
  const seconds = 3.4
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < length; i++) {
      const sec = i / ctx.sampleRate
      const t = i / length
      const white = Math.random() * 2 - 1
      lp += (0.4 - 0.34 * t) * (white - lp)
      // slow bloom (about 60 ms) then a long smooth decay
      data[i] = lp * (1 - Math.exp(-sec / 0.06)) * (1 - t) ** 2.4 * 2.6
    }
  }
  hallImpulses.set(ctx, buffer)
  return buffer
}

export const createTrackChain = (
  ctx: BaseAudioContext,
  out: AudioNode,
): TrackChain => {
  const velocity = ctx.createGain()
  const volume = ctx.createGain()
  const pan = ctx.createStereoPanner()
  const phrase = ctx.createGain()
  const hallPre = ctx.createDelay(0.2)
  hallPre.delayTime.value = 0.045
  const hall = ctx.createConvolver()
  hall.buffer = hallImpulse(ctx)
  const hallWet = ctx.createGain()
  hallWet.gain.value = 0
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
  pan.connect(phrase)
  phrase.connect(smooth)
  phrase.connect(hallPre)
  hallPre.connect(hall)
  hall.connect(hallWet)
  hallWet.connect(out)
  smooth.connect(dry)
  dry.connect(out)
  smooth.connect(preDelay)
  preDelay.connect(reverb)
  reverb.connect(wet)
  wet.connect(out)
  return {
    velocity,
    volume,
    pan,
    phrase,
    hallPre,
    hall,
    hallWet,
    smooth,
    dry,
    preDelay,
    reverb,
    wet,
  }
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

export const applyHall = (chain: TrackChain, smooth: number) => {
  chain.hallWet.gain.value = (Math.max(0, Math.min(100, smooth)) / 100) * 0.75
}

// Smooth 1..100: each phrase rises gradually from a quiet start and falls gradually at its end.
// The more, the quieter the start / end and the longer the rise / fall.
const phraseShape = (smooth: number) => {
  const amount = Math.max(0, Math.min(100, smooth)) / 100
  return {
    floor: 1 - amount * 0.85,
    rise: 0.12 + amount * 0.28,
    fall: 0.15 + amount * 0.45,
  }
}

const schedulePhrases = (
  param: AudioParam,
  phrases: readonly Phrase[],
  smooth: number,
  time: ScheduleTime,
) => {
  param.cancelScheduledValues(time.nowCtx)
  if (smooth <= 0 || phrases.length === 0) {
    param.setValueAtTime(1, time.nowCtx)
    return
  }
  const { floor, rise, fall } = phraseShape(smooth)
  // [sec, gain] key frames: floor -> 1 over the rise, 1 -> floor over the fall; floor between phrases
  const frames: [number, number][] = []
  for (const p of phrases) {
    const len = p.endSec - p.startSec
    const r = Math.min(rise, len / 2)
    const f = Math.min(fall, len / 2)
    frames.push(
      [p.startSec, floor],
      [p.startSec + r, 1],
      [p.endSec - f, 1],
      [p.endSec, floor],
    )
  }
  // gain in force at fromSec: interpolate between the surrounding frames
  let start = floor
  for (let i = 0; i < frames.length; i++) {
    const [t, v] = frames[i]
    if (t > time.fromSec) {
      if (i > 0) {
        const [pt, pv] = frames[i - 1]
        start = t > pt ? pv + ((v - pv) * (time.fromSec - pt)) / (t - pt) : v
      }
      break
    }
    start = v
  }
  param.setValueAtTime(start, time.nowCtx)
  for (const [t, v] of frames) {
    if (t > time.fromSec) {
      param.linearRampToValueAtTime(v, Math.max(time.nowCtx, time.toCtx(t)))
    }
  }
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
  // a NaN / negative point would silence (or invert) the whole vocal
  points = points.filter((p) => Number.isFinite(p.sec) && Number.isFinite(p.value))
  let start = valueAt(points, time.fromSec, fallback)
  if (!Number.isFinite(start)) {
    start = fallback
  }
  if (slope) {
    // inside a ramp: start part way along it
    const next = points.findIndex((p) => p.sec > time.fromSec)
    if (next > 0) {
      const a = points[next - 1]
      const b = points[next]
      start =
        b.sec > a.sec
          ? a.value +
            ((b.value - a.value) * (time.fromSec - a.sec)) / (b.sec - a.sec)
          : b.value
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
  fx: { echo: number; slope: boolean; smooth: number } = {
    echo: 0,
    slope: false,
    smooth: 0,
  },
) => {
  applyEcho(chain, fx.echo)
  applyHall(chain, fx.smooth)
  schedulePhrases(chain.phrase.gain, curves.phrases, fx.smooth, time)
  scheduleParam(chain.volume.gain, curves.volume, 1, time, fx.slope)
  scheduleParam(chain.pan.pan, curves.pan, 0, time)
  scheduleParam(chain.velocity.gain, curves.velocity, 1, time)
}
