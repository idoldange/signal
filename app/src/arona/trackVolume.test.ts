import { describe, expect, it } from "vitest"
import { projectToSong } from "./projectToSong"
import { songToUstx } from "./songToUstx"
import { trackVolume, trackVolumeDb, vocalGainOf } from "./trackVolume"

const makeSong = () =>
  projectToSong(
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

describe("track volume", () => {
  it("defaults to 100 (unchanged level) and follows the MIDI volume of the track", () => {
    const song = makeSong()
    const track = song.tracks.find((t) => !t.isConductorTrack)
    expect(track).toBeDefined()
    if (!track) {
      return
    }
    expect(trackVolume(track)).toBe(100)
    expect(vocalGainOf(track)).toBe(1)
    expect(trackVolumeDb(track)).toBe(0)

    track.setVolume(50, 0)
    expect(trackVolume(track)).toBe(50)
    expect(vocalGainOf(track)).toBe(0.5)
    expect(songToUstx(song)).toContain("volume: -6")

    track.setVolume(0, 0)
    expect(trackVolumeDb(track)).toBe(-24)
  })
})
