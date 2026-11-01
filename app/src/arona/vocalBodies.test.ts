import { isNoteEvent } from "@signal-app/core"
import { describe, expect, it } from "vitest"
import { TrackMute } from "../trackMute/TrackMute"
import { projectToSong } from "./projectToSong"
import { buildVocalBodies } from "./vocal"

const vocalTrack = (name: string, tone: number) => ({
  name,
  role: "vocal",
  program: 0,
  drums: false,
  notes: [
    { pos: 0, dur: 480, tone, lyric: "la", vel: 100 },
    { pos: 960, dur: 480, tone: tone + 2, lyric: "li", vel: 100 },
  ],
})

const makeSong = () =>
  projectToSong(
    {
      name: "demo",
      ppq: 480,
      tempos: [[0, 120]],
      tracks: [vocalTrack("A", 60), vocalTrack("B", 67)],
    },
    new Map(),
  )

describe("vocal bodies are per track", () => {
  it("plans one body per vocal track, and tracks do not share notes", () => {
    const song = makeSong()
    const bodies = buildVocalBodies(song, TrackMute.empty)
    expect(bodies).toHaveLength(2)
    expect(bodies[0].body.notes.map((n) => n.tone)).toEqual([60, 62])
    expect(bodies[1].body.notes.map((n) => n.tone)).toEqual([67, 69])
  })

  it("muting a track leaves the body (and so the hashes) of the others untouched", () => {
    const song = makeSong()
    const all = buildVocalBodies(song, TrackMute.empty)
    const muted = buildVocalBodies(
      song,
      TrackMute.mute(all[0].trackId)(TrackMute.empty),
    )
    expect(muted).toHaveLength(1)
    expect(JSON.stringify(muted[0])).toBe(JSON.stringify(all[1]))
  })

  it("editing one track only changes the body of that track", () => {
    const song = makeSong()
    const before = buildVocalBodies(song, TrackMute.empty)
    const track = song.tracks.find((t) => t.id === before[0].trackId)
    const note = track?.events.filter(isNoteEvent)[0]
    track?.updateEvent(note?.id ?? -1, { lyric: "changed" })
    const after = buildVocalBodies(song, TrackMute.empty)
    expect(JSON.stringify(after[0])).not.toBe(JSON.stringify(before[0]))
    expect(JSON.stringify(after[1])).toBe(JSON.stringify(before[1]))
  })
})
