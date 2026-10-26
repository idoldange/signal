import type { NoteOffEvent, NoteOnEvent } from "midifile-ts"
import type { NoteEvent, TickProvider } from "../entities"
import { noteOffMidiEvent, noteOnMidiEvent } from "../midi/MidiEvent"
import { decodeLyricText, encodeLyricText } from "./lyricCodec"
import { decodePitchData, encodePitchData } from "./pitchCodec"

/**

  assemble noteOn and noteOff to single note event to append duration

 */
export function assemble<T extends object>(
  events: (T | TickNoteOffEvent | TickNoteOnEvent)[],
): (T | NoteEvent)[] {
  const noteOnEvents: TickNoteOnEvent[] = []

  function findNoteOn(noteOff: TickNoteOffEvent): TickNoteOnEvent | null {
    const i = noteOnEvents.findIndex((e) => {
      return e.noteNumber === noteOff.noteNumber
    })
    if (i < 0) {
      return null
    }
    const e = noteOnEvents[i]
    noteOnEvents.splice(i, 1)
    return e
  }

  const result: (T | NoteEvent)[] = []
  events.forEach((e) => {
    if ("subtype" in e) {
      switch (e.subtype) {
        case "noteOn":
          noteOnEvents.push(e)
          break
        case "noteOff": {
          const noteOn = findNoteOn(e)
          if (noteOn != null) {
            const note: NoteEvent = {
              ...noteOn,
              subtype: "note",
              id: -1,
              tick: noteOn.tick,
              duration: e.tick - noteOn.tick,
            }
            result.push(note)
          }
          break
        }
        default:
          result.push(e)
          break
      }
    } else {
      result.push(e)
    }
  })

  return attachPitch(attachLyrics(result))
}

type TickedLyricEvent = { type: "meta"; subtype: "lyrics"; text: string; tick: number }

const isLyricEvent = (e: object): e is TickedLyricEvent =>
  "type" in e &&
  e.type === "meta" &&
  "subtype" in e &&
  e.subtype === "lyrics" &&
  "tick" in e

// A Lyric meta event on the same tick as a note belongs to that note. Lyrics that match no note stay as events.
function attachLyrics<T extends object>(events: (T | NoteEvent)[]): (T | NoteEvent)[] {
  const noteByTick = new Map<number, NoteEvent[]>()
  for (const e of events) {
    if ("subtype" in e && e.subtype === "note") {
      noteByTick.set(e.tick, [...(noteByTick.get(e.tick) ?? []), e as NoteEvent])
    }
  }
  const consumed = new Set<object>()
  for (const e of events) {
    if (!isLyricEvent(e)) {
      continue
    }
    const target = noteByTick.get(e.tick)?.find((note) => note.lyric === undefined)
    if (target !== undefined) {
      target.lyric = decodeLyricText(e.text)
      consumed.add(e)
    }
  }
  return events.filter((e) => !consumed.has(e))
}

type TickedSequencerSpecificEvent = {
  type: "meta"
  subtype: "sequencerSpecific"
  data: number[]
  tick: number
}

const isSequencerSpecific = (e: object): e is TickedSequencerSpecificEvent =>
  "type" in e &&
  e.type === "meta" &&
  "subtype" in e &&
  e.subtype === "sequencerSpecific" &&
  "data" in e &&
  Array.isArray(e.data) &&
  "tick" in e

// A pitch bend event on the same tick and note number as a note belongs to that note.
// Events that match no note stay as they are.
function attachPitch<T extends object>(events: (T | NoteEvent)[]): (T | NoteEvent)[] {
  const consumed = new Set<object>()
  for (const e of events) {
    if (!isSequencerSpecific(e)) {
      continue
    }
    const decoded = decodePitchData(e.data)
    if (decoded === undefined) {
      continue
    }
    const target = events.find(
      (n): n is NoteEvent =>
        "subtype" in n &&
        n.subtype === "note" &&
        (n as NoteEvent).tick === e.tick &&
        (n as NoteEvent).noteNumber === decoded.noteNumber &&
        (n as NoteEvent).pitch === undefined,
    )
    if (target !== undefined) {
      target.pitch = decoded.pitch
      consumed.add(e)
    }
  }
  return consumed.size === 0 ? events : events.filter((e) => !consumed.has(e))
}

export type TickNoteOnEvent = Omit<NoteOnEvent, "channel" | "deltaTime"> &
  TickProvider
export type TickNoteOffEvent = Omit<NoteOffEvent, "channel" | "deltaTime"> &
  TickProvider

// separate note to noteOn + noteOff
export function deassemble<T extends object>(
  e: T | NoteEvent,
): (T | TickNoteOnEvent | TickNoteOffEvent)[] {
  if ("subtype" in e && e.subtype === "note") {
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    const channel = (e as any)["channel"] ?? -1
    const noteOn = noteOnMidiEvent(0, channel, e.noteNumber, e.velocity)
    const noteOff = noteOffMidiEvent(0, channel, e.noteNumber)
    const lyric =
      e.lyric !== undefined && e.lyric.length > 0
        ? [
            {
              type: "meta",
              subtype: "lyrics",
              text: encodeLyricText(e.lyric),
              deltaTime: 0,
              tick: e.tick,
            } as unknown as T,
          ]
        : []
    const pitch =
      e.pitch !== undefined && e.pitch.points.length > 0
        ? [
            {
              type: "meta",
              subtype: "sequencerSpecific",
              data: encodePitchData(e.noteNumber, e.pitch),
              deltaTime: 0,
              tick: e.tick,
            } as unknown as T,
          ]
        : []
    return [
      ...lyric,
      ...pitch,
      { ...noteOn, tick: e.tick },
      { ...noteOff, tick: e.tick + e.duration },
    ]
  } else {
    return [e as T]
  }
}
