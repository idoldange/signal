import {
  controllerMidiEvent,
  emptyTrack,
  setTempoMidiEvent,
  Song,
  tickedEventsToTrackEvents,
  timeSignatureMidiEvent,
  Track,
} from "@signal-app/core"
import type { ActivityProject } from "./activityApi"
import { vocalTrackFlags } from "./vocalTrack"

const RHYTHM_CHANNEL = 9

const pickChannel = (used: Set<number>) => {
  for (let ch = 0; ch < 16; ch++) {
    if (ch !== RHYTHM_CHANNEL && !used.has(ch)) {
      used.add(ch)
      return ch
    }
  }
  return 0
}

// A project sent by the bot (parsed USTX/MIDI) becomes a normal Signal song:
// lyrics stay on the notes, so saving it to the channel keeps them as MIDI Lyric events.
export function projectToSong(
  project: ActivityProject,
  fonts: ReadonlyMap<string, number> = new Map(),
): Song {
  const song = new Song()
  song.timebase = Math.max(1, project.ppq || 480)
  song.name = project.name

  // conductor track (no channel) with tempo and time signature
  const conductor = new Track()
  conductor.setName(project.name)
  const tempos =
    project.tempos.filter(([, bpm]) => bpm > 0).length > 0
      ? project.tempos.filter(([, bpm]) => bpm > 0)
      : [[0, 120] as [number, number]]
  conductor.addEvents(
    tickedEventsToTrackEvents([
      { ...timeSignatureMidiEvent(0, 4, 4), tick: 0 },
      ...tempos.map(([tick, bpm]) => ({
        ...setTempoMidiEvent(0, Math.round(60000000 / bpm)),
        tick: Math.max(0, Math.round(tick)),
      })),
    ]),
  )
  song.addTrack(conductor)

  const used = new Set<number>()
  for (const t of project.tracks) {
    if (t.role === "mute") {
      continue
    }
    const channel = t.drums ? RHYTHM_CHANNEL : pickChannel(used)
    const track = emptyTrack(channel)
    track.setName(t.name || "Track")
    const vocal = t.role === "vocal"
    // Vocal tracks get a choir patch instead of the piano fallback.
    const program = vocal ? 52 : Math.max(0, Math.min(127, t.program | 0))
    const bank =
      t.role === "vocal"
        ? 0
        : Math.max(0, Math.min(255, t.bank ?? (t.drums ? 128 : 0)))
    // Additional soundfonts are loaded as extra banks (bank MSB offset). 1 is the GM
    // drum bank, so the Activity assigns offsets from 2 upwards.
    const offset = (t.sf ? fonts.get(t.sf) : 0) ?? 0
    const msb = Math.min(127, (bank >> 7) + offset)
    const lsb = bank & 0x7f
    track.addEvents(
      tickedEventsToTrackEvents([
        { ...controllerMidiEvent(0, channel, 0, msb), tick: 0 },
        { ...controllerMidiEvent(0, channel, 32, lsb), tick: 0 },
      ]),
    )
    track.setProgramNumberAt(0, program)
    track.addEvents(
      t.notes.map((n) => ({
        tick: Math.max(0, Math.round(n.pos)),
        type: "channel" as const,
        subtype: "note" as const,
        duration: Math.max(1, Math.round(n.dur)),
        noteNumber: Math.max(0, Math.min(127, Math.round(n.tone))),
        velocity: Math.max(1, Math.min(127, Math.round(n.vel || 100))),
        // Instrument tracks from USTX often carry the placeholder lyric "a"; keeping it
        // would make the DAW treat the whole track as a vocal track.
        ...(vocal && n.lyric ? { lyric: n.lyric } : {}),
      })),
    )
    song.addTrack(track)
    if (vocal) {
      vocalTrackFlags.set(track, true)
    }
  }

  song.updateEndOfSong()
  song.isSaved = true
  return song
}
