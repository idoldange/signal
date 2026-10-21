import { describe, expect, it } from "vitest"
import { emptySong, type NoteEvent, type Track } from "../entities"
import { decodeLyricText, encodeLyricText } from "./lyricCodec"
import { songFromMidi, songToMidi } from "./midiConversion"
import { assemble, deassemble } from "./noteAssembler"

const note = (tick: number, noteNumber: number, lyric?: string) => ({
  type: "channel" as const,
  subtype: "note" as const,
  noteNumber,
  tick,
  velocity: 100,
  duration: 240,
  channel: 0,
  ...(lyric === undefined ? {} : { lyric }),
})

describe("lyric text codec", () => {
  it("round trips Unicode through the one byte per character form", () => {
    for (const text of ["la", "こんにちは", "한국어", "русский", "ɑ̃", "😀"]) {
      const encoded = encodeLyricText(text)
      expect(Array.from(encoded).every((c) => c.charCodeAt(0) < 256)).toBe(true)
      expect(decodeLyricText(encoded)).toBe(text)
    }
  })
})

describe("lyrics in note events", () => {
  it("writes a Lyric meta event before the note and reads it back", () => {
    const raw = deassemble(note(480, 60, "あ"))
    expect(raw.map((e) => ("subtype" in e ? e.subtype : "?"))).toEqual([
      "lyrics",
      "noteOn",
      "noteOff",
    ])
    const assembled = assemble(raw as never)
    expect(assembled).toHaveLength(1)
    expect((assembled[0] as NoteEvent).lyric).toBe("あ")
  })

  it("does not write anything for notes without lyric", () => {
    expect(deassemble(note(0, 60))).toHaveLength(2)
    expect(deassemble(note(0, 60, ""))).toHaveLength(2)
  })

  it("matches lyrics to notes on the same tick only and keeps the others", () => {
    const events = [
      { type: "meta", subtype: "lyrics", text: "a", tick: 0 },
      { type: "meta", subtype: "lyrics", text: "stray", tick: 999 },
      { type: "channel", subtype: "noteOn", noteNumber: 60, velocity: 90, tick: 0 },
      { type: "channel", subtype: "noteOff", noteNumber: 60, velocity: 0, tick: 100 },
    ]
    const result = assemble(events as never) as unknown as Array<{
      subtype: string
      lyric?: string
      text?: string
    }>
    expect(result.map((e) => e.subtype)).toEqual(["lyrics", "note"])
    expect(result[0].text).toBe("stray")
    expect(result[1].lyric).toBe("a")
  })
})

describe("lyrics in a MIDI file", () => {
  it("survive writing and reading, including Japanese", () => {
    const song = emptySong()
    const track: Track = song.tracks[1]
    track.addEvent<NoteEvent>(note(0, 60, "こ") as never)
    track.addEvent<NoteEvent>(note(240, 62, "ん") as never)
    track.addEvent<NoteEvent>(note(480, 64) as never)
    const reread = songFromMidi(songToMidi(song))
    const notes = reread.tracks[1].events.filter(
      (e): e is NoteEvent => "subtype" in e && e.subtype === "note",
    )
    expect(notes.map((n) => n.lyric)).toEqual(["こ", "ん", undefined])
  })
})
