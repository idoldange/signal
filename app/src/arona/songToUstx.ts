import {
  isNoteEvent,
  isProgramChangeEvent,
  type Song,
  type Track,
} from "@signal-app/core"
import { isVocalTrack } from "./vocalTrack"

export const getSongTempos = (song: Song): [number, number][] => {
  const events = song.conductorTrack?.events ?? []
  const tempos = events
    .filter(
      (e) =>
        e.type === "meta" &&
        "subtype" in e &&
        e.subtype === "setTempo" &&
        "microsecondsPerBeat" in e,
    )
    .map(
      (e) =>
        [e.tick, 60000000 / (e as { microsecondsPerBeat: number }).microsecondsPerBeat] as [
          number,
          number,
        ],
    )
    .sort((a, b) => a[0] - b[0])
  if (tempos.length === 0) {
    return [[0, 120] as [number, number]]
  }
  if (tempos[0][0] !== 0) {
    tempos.unshift([0, tempos[0][1]])
  }
  return tempos
}

const round = (value: number) => Math.round(value * 1000) / 1000

const programAtStart = (track: Track) => {
  let program = 0
  for (const event of track.events) {
    if (isProgramChangeEvent(event) && event.tick <= 0) {
      program = event.value
    }
  }
  return program
}

// The bot classifies an exported track by its name tags, so instrument tracks keep their
// GM program and are not mistaken for vocal tracks just because they have notes.
const instrumentName = (track: Track) => {
  const name = track.name || "Track"
  const drums = track.channel === 9
  const program = programAtStart(track)
  if (drums) {
    return `${name} [drums]`
  }
  return program === 0 ? name : `${name} [gm=${program}]`
}

// Minimal but valid USTX (OpenUtau) project. The bot accepts this with parse_ustx,
// and OpenUtau reads tracks, tempos and notes with their lyrics.
export function songToUstx(song: Song): string {
  const tempos = getSongTempos(song)
  const bpm = round(tempos[0][1])
  const tracks = song.tracks.filter((t) => !t.isConductorTrack)
  const lines: string[] = [
    'ustx_version: "0.6"',
    `name: ${JSON.stringify(song.name || "Arona")}`,
    `comment: "Made in the Arona DAW"`,
    `resolution: ${song.timebase}`,
    `bpm: ${bpm}`,
    "tempos:",
    ...tempos.map(
      ([tick, bpm]) =>
        `  - position: ${tick}\n    bpm: ${round(bpm)}`,
    ),
    "tracks:",
  ]

  for (const track of tracks) {
    const vocal = isVocalTrack(track)
    lines.push(
      `  - track_name: ${JSON.stringify(vocal ? track.name ?? "Vocal" : instrumentName(track))}`,
      `    singer: ${vocal ? '"Arona"' : '""'}`,
      '    phonemizer: "OpenUtau.Core.DefaultPhonemizer"',
      '    renderer: "CLASSIC"',
      "    mute: false",
      "    solo: false",
      "    volume: 0",
      "    pan: 0",
    )
  }

  lines.push("voice_parts:")
  tracks.forEach((track, index) => {
    const notes = track.events.filter(isNoteEvent)
    if (notes.length === 0) {
      return
    }
    const vocal = isVocalTrack(track)
    lines.push(
      `  - track_no: ${index}`,
      "    position: 0",
      "    notes:",
      ...notes.map(
        (n) =>
          `      - {position: ${n.tick}, duration: ${n.duration}, tone: ${n.noteNumber}, pitch: 0, lyric: ${JSON.stringify(vocal ? n.lyric || "a" : "")}}`,
      ),
    )
  })

  return `${lines.join("\n")}\n`
}
