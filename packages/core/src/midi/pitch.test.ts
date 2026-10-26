import { describe, expect, it } from "vitest"
import { emptySong, type NoteEvent, type Track } from "../entities"
import {
  type NotePitch,
  normalizePitch,
  samplePitch,
} from "../entities/event/NotePitch"
import { songFromMidi, songToMidi } from "./midiConversion"
import { assemble, deassemble } from "./noteAssembler"
import { decodePitchData, encodePitchData } from "./pitchCodec"

const pitch: NotePitch = {
  snapFirst: true,
  points: [
    { x: -40, y: 0, shape: "io" },
    { x: 60, y: -15.5, shape: "l" },
    { x: 220, y: 12, shape: "o" },
  ],
}

const note = (tick: number, noteNumber: number, extra: object = {}) => ({
  type: "channel" as const,
  subtype: "note" as const,
  noteNumber,
  tick,
  velocity: 100,
  duration: 240,
  channel: 0,
  ...extra,
})

describe("note pitch", () => {
  it("normalizes points: sorted, rounded, defaults, junk dropped", () => {
    const result = normalizePitch({
      snapFirst: false,
      points: [
        { x: 50.04, y: 3.26, shape: "weird" },
        { x: -10, y: 0, shape: "l" },
        { x: "no", y: 1 },
        null,
      ],
    })
    expect(result).toEqual({
      snapFirst: false,
      points: [
        { x: -10, y: 0, shape: "l" },
        { x: 50, y: 3.3, shape: "io" },
      ],
    })
    expect(normalizePitch({ points: [] })).toBeUndefined()
    expect(normalizePitch("x")).toBeUndefined()
  })

  it("samples with each shape and holds the ends", () => {
    const linear: NotePitch = {
      snapFirst: true,
      points: [
        { x: 0, y: 0, shape: "l" },
        { x: 100, y: 10, shape: "io" },
      ],
    }
    expect(samplePitch(linear, -50)).toBe(0)
    expect(samplePitch(linear, 50)).toBeCloseTo(5)
    expect(samplePitch(linear, 500)).toBe(10)
    const sine = { ...linear, points: [{ ...linear.points[0], shape: "io" as const }, linear.points[1]] }
    expect(samplePitch(sine, 50)).toBeCloseTo(5)
    expect(samplePitch(sine, 25)).toBeLessThan(2.5)
  })

  it("round trips through the sequencer specific bytes", () => {
    const decoded = decodePitchData(encodePitchData(62, pitch))
    expect(decoded).toEqual({ noteNumber: 62, pitch })
    expect(decodePitchData([1, 2, 3])).toBeUndefined()
    expect(decodePitchData([...Array.from("ArNP", (c) => c.charCodeAt(0)), 123])).toBeUndefined()
  })

  it("writes the pitch event next to the note and reads it back", () => {
    const raw = deassemble(note(480, 60, { pitch }))
    const rest = raw.filter((e) => (e as { subtype?: string }).subtype !== "sequencerSpecific")
    expect(rest).toHaveLength(2)
    const assembled = assemble(raw as never[]) as NoteEvent[]
    expect(assembled).toHaveLength(1)
    expect(assembled[0].pitch).toEqual(pitch)
  })

  it("matches the pitch to the right note when two notes share a tick", () => {
    const other: NotePitch = { snapFirst: false, points: [{ x: 0, y: 5, shape: "i" }] }
    const raw = [
      ...deassemble(note(0, 60, { pitch })),
      ...deassemble(note(0, 64, { pitch: other })),
    ]
    const notes = (assemble(raw as never[]) as NoteEvent[]).filter((e) => e.subtype === "note")
    expect(notes.find((n) => n.noteNumber === 60)?.pitch).toEqual(pitch)
    expect(notes.find((n) => n.noteNumber === 64)?.pitch).toEqual(other)
  })

  it("survives a trip through a MIDI file", () => {
    const song = emptySong()
    const track = song.tracks.find((t) => !t.isConductorTrack) as Track
    track.addEvent({
      type: "channel",
      subtype: "note",
      tick: 0,
      duration: 480,
      noteNumber: 67,
      velocity: 90,
      lyric: "あ",
      pitch,
    } as never)
    const loaded = songFromMidi(songToMidi(song))
    const loadedNote = loaded.tracks
      .flatMap((t) => t.events)
      .find((e) => e.type === "channel" && e.subtype === "note") as NoteEvent
    expect(loadedNote.pitch).toEqual(pitch)
    expect(loadedNote.lyric).toBe("あ")
  })
})

describe("vibrato", () => {
  it("round-trips through the pitch event", () => {
    const pitch = normalizePitch({
      points: [{ x: 0, y: 5, shape: "l" }],
      snapFirst: false,
      vibrato: { length: 40, period: 150, depth: 30, in: 20, out: 10 },
    })
    const back = decodePitchData(encodePitchData(60, pitch as never))
    expect(back?.pitch.vibrato?.depth).toBe(30)
    expect(back?.pitch.vibrato?.length).toBe(40)
  })
  it("vibrato alone gives a flat default curve", () => {
    const p = normalizePitch({ vibrato: { length: 50, depth: 25 } })
    expect(p?.points.length).toBe(2)
    expect(p?.snapFirst).toBe(false)
  })
})
