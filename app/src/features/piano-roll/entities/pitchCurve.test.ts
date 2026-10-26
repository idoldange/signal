import type { NotePitch } from "@signal-app/core"
import { describe, expect, it } from "vitest"
import {
  addPoint,
  DEFAULT_PITCH_POINTS,
  displayPoints,
  drawPitch,
  erasePitch,
  linePitch,
  overwritePitch,
  sinePitch,
  smoothPitch,
  MAX_PITCH_POINTS,
  movePoint,
  pitchOrDefault,
  removePoint,
  setPointShape,
  toggleSnapFirst,
} from "./pitchCurve"

const pitch = (snapFirst = false): NotePitch => ({
  snapFirst,
  points: [
    { x: 0, y: 0, shape: "io" },
    { x: 100, y: 10, shape: "io" },
    { x: 200, y: -5, shape: "io" },
  ],
})

describe("pitchCurve", () => {
  it("shows a flat default without glide when a note has no pitch", () => {
    const shown = pitchOrDefault(undefined)
    expect(shown.points).toEqual(DEFAULT_PITCH_POINTS)
    expect(shown.snapFirst).toBe(false)
    expect(pitchOrDefault({ points: [], snapFirst: true }).points).toEqual(
      DEFAULT_PITCH_POINTS,
    )
  })

  it("snaps the first point to the previous note only when they touch", () => {
    const note = { tick: 480, noteNumber: 62 }
    const touching = { tick: 0, duration: 480, noteNumber: 60 }
    const apart = { tick: 0, duration: 400, noteNumber: 60 }
    expect(displayPoints(pitch(true), note, touching)[0].y).toBe(-20)
    expect(displayPoints(pitch(true), note, apart)[0].y).toBe(0)
    expect(displayPoints(pitch(true), note, undefined)[0].y).toBe(0)
    expect(displayPoints(pitch(false), note, touching)[0].y).toBe(0)
  })

  it("moves a point between its neighbours and rounds to 0.1", () => {
    const moved = movePoint(pitch(), 1, 150.04, 7.26)
    expect(moved.points[1]).toEqual({ x: 150, y: 7.3, shape: "io" })
    expect(movePoint(pitch(), 1, 999, 0).points[1].x).toBe(199)
    expect(movePoint(pitch(), 1, -999, 0).points[1].x).toBe(1)
    expect(movePoint(pitch(), 9, 0, 0)).toEqual(pitch())
  })

  it("keeps the y of the first point when it snaps to the previous note", () => {
    expect(movePoint(pitch(true), 0, -30, 50).points[0]).toMatchObject({ x: -30, y: 0 })
    expect(movePoint(pitch(false), 0, -30, 50).points[0]).toMatchObject({ x: -30, y: 50 })
  })

  it("adds points in order and ignores duplicates", () => {
    const added = addPoint(pitch(), { x: 50, y: 3 })
    expect(added.points.map((p) => p.x)).toEqual([0, 50, 100, 200])
    expect(addPoint(pitch(), { x: 100.2, y: 3 })).toEqual(pitch())
  })

  it("never grows beyond the point limit", () => {
    const full: NotePitch = {
      snapFirst: false,
      points: Array.from({ length: MAX_PITCH_POINTS }, (_, i) => ({
        x: i * 2,
        y: 0,
        shape: "io" as const,
      })),
    }
    expect(addPoint(full, { x: 1000, y: 0 }).points).toHaveLength(MAX_PITCH_POINTS)
  })

  it("removes points and drops the pitch when the last one goes", () => {
    expect(removePoint(pitch(), 1)?.points.map((p) => p.x)).toEqual([0, 200])
    expect(removePoint({ snapFirst: false, points: [pitch().points[0]] }, 0)).toBeUndefined()
  })

  it("changes the shape of one point and toggles snap first", () => {
    expect(setPointShape(pitch(), 1, "l").points.map((p) => p.shape)).toEqual(["io", "l", "io"])
    expect(toggleSnapFirst(pitch(false)).snapFirst).toBe(true)
  })

  it("replaces the points inside a drawn range and keeps the others", () => {
    const samples = [
      { x: 90, y: 1 },
      { x: 100, y: 2 },
      { x: 120, y: 4 },
      { x: 140, y: 6 },
    ]
    const result = drawPitch(pitch(), samples, 90, 140)
    expect(result.points.map((p) => p.x)).toEqual([0, 90, 100, 120, 140, 200])
    expect(result.points.find((p) => p.x === 100)).toEqual({ x: 100, y: 2, shape: "l" })
    expect(result.points[0]).toEqual(pitch().points[0])
    expect(result.points[5]).toEqual(pitch().points[2])
  })

  it("thins very dense drawings and stays within the limit", () => {
    const samples = Array.from({ length: 3000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 10 }))
    const result = drawPitch(undefined, samples, 0, 3000)
    expect(result.points.length).toBeLessThanOrEqual(MAX_PITCH_POINTS)
    expect(result.points[result.points.length - 1].x).toBe(2999)
    expect(drawPitch(pitch(), [], 0, 1)).toEqual(pitch())
  })
})

describe("pitch tools", () => {
  it("linePitch makes a straight segment", () => {
    const p = linePitch(undefined, { x: 0, y: 0 }, { x: 100, y: 50 }, "l")
    expect(p.points.some((q) => q.x === 100 && q.y === 50)).toBe(true)
  })
  it("sinePitch oscillates around the start y", () => {
    const p = sinePitch(undefined, { x: 0, y: 0 }, { x: 400, y: 30 }, 200)
    const ys = p.points.map((q) => q.y)
    expect(Math.max(...ys)).toBeGreaterThan(25)
    expect(Math.min(...ys)).toBeLessThan(-25)
  })
  it("smoothPitch reduces peaks", () => {
    const base = sinePitch(undefined, { x: 0, y: 0 }, { x: 400, y: 40 }, 100)
    const s = smoothPitch(base, 0, 400)
    expect(Math.max(...s!.points.map((q) => q.y))).toBeLessThan(40)
  })
  it("erasePitch removes points in range", () => {
    const base = linePitch(undefined, { x: 0, y: 0 }, { x: 100, y: 50 }, "l")
    expect(erasePitch(base, -1000, 1000)).toBeUndefined()
  })
  it("movePoint keeps the last point at y=0", () => {
    const m = movePoint(pitchOrDefault(undefined), 1, 10, 80)
    expect(m.points[m.points.length - 1].y).toBe(0)
  })
})

describe("overwrite layer", () => {
  it("stores the deviation from the curve", () => {
    const curve = pitchOrDefault(undefined)
    const p = overwritePitch(undefined, curve, [{ x: 0, y: 7 }, { x: 10, y: 9 }], 0, 10)
    expect(p.pitd?.[0].y).toBe(7)
    expect(erasePitch(p, -100, 100)?.pitd).toBeUndefined()
  })
})
