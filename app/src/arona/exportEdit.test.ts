import { isNoteEvent, songFromMidi, songToMidi } from "@signal-app/core"
import { describe, expect, it } from "vitest"
import { projectToSong } from "./projectToSong"
import { songToUstx } from "./songToUstx"

// A song opened from a project and then edited must export the EDITED notes.
describe("export after an edit", () => {
  it("songToUstx writes the edited note, not the imported one", () => {
    const song = projectToSong(
      {
        name: "demo",
        ppq: 480,
        tempos: [[0, 120]],
        tracks: [
          {
            name: "Vocal",
            role: "vocal",
            program: 0,
            drums: false,
            notes: [
              { pos: 0, dur: 480, tone: 60, lyric: "la", vel: 100 },
              { pos: 480, dur: 480, tone: 62, lyric: "li", vel: 100 },
            ],
          },
        ],
      },
      new Map(),
    )
    const track = song.tracks.find((t) => !t.isConductorTrack)
    expect(track).toBeDefined()
    const first = track?.events.filter(isNoteEvent)[0]
    track?.updateEvent(first?.id ?? -1, { noteNumber: 71, lyric: "EDITED" })
    const ustx = songToUstx(song)
    expect(ustx).toContain("tone: 71")
    expect(ustx).toContain('lyric: "EDITED"')
    expect(ustx).not.toContain("tone: 60")
  })

  // "Save to channel" also stores a MIDI autosave (saveSongToChannel -> songToMidi): reading it
  // back (Open latest autosave) must give the edited song.
  it("the MIDI autosave contains the edit too", () => {
    const song = projectToSong(
      {
        name: "demo",
        ppq: 480,
        tempos: [[0, 120]],
        tracks: [
          {
            name: "Vocal",
            role: "vocal",
            program: 0,
            drums: false,
            notes: [{ pos: 0, dur: 480, tone: 60, lyric: "la", vel: 100 }],
          },
        ],
      },
      new Map(),
    )
    const track = song.tracks.find((t) => !t.isConductorTrack)
    const first = track?.events.filter(isNoteEvent)[0]
    track?.updateEvent(first?.id ?? -1, { noteNumber: 71, lyric: "EDITED" })
    const reread = songFromMidi(songToMidi(song))
    const notes = reread.tracks
      .filter((t) => !t.isConductorTrack)
      .flatMap((t) => t.events.filter(isNoteEvent))
    expect(notes.map((n) => n.noteNumber)).toEqual([71])
    expect(notes.map((n) => n.lyric)).toEqual(["EDITED"])
  })
})
