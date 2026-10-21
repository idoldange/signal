import { type Song, songToMidi } from "@signal-app/core"
import { renderAudio } from "@signal-app/player"
import { encodeWAV } from "../features/export/lib/encodeAudio"
import { activityJson } from "./activityApi"
import { songToUstx } from "./songToUstx"
import type { BackingTrack } from "./backingTrack"
import { getVocalTrackIds } from "./vocalTrack"
import type { VocalChunk, VocalService } from "./vocal"

export type ActivityExportMode = "audio" | "audio+ustx" | "ustx"

export interface ActivityExportResult {
  ok: boolean
  message_url: string
  files: string[]
  converted_to_mp3: boolean
}

const mixVocals = async (
  audio: AudioBuffer,
  chunks: readonly VocalChunk[],
): Promise<AudioBuffer> => {
  if (chunks.length === 0) {
    return audio
  }
  const sampleRate = audio.sampleRate
  const end = Math.max(audio.duration, ...chunks.map((c) => c.end)) + 0.5
  const offline = new OfflineAudioContext(
    2,
    Math.ceil(end * sampleRate),
    sampleRate,
  )
  const music = offline.createBufferSource()
  music.buffer = audio
  music.connect(offline.destination)
  music.start(0)
  for (const chunk of chunks) {
    const source = offline.createBufferSource()
    source.buffer = chunk.buffer
    source.connect(offline.destination)
    source.start(chunk.start)
  }
  return await offline.startRendering()
}

// Imported WAV files start at project time 0.
const mixBacking = async (
  audio: AudioBuffer,
  tracks: readonly BackingTrack[],
): Promise<AudioBuffer> => {
  if (tracks.length === 0) {
    return audio
  }
  const sampleRate = audio.sampleRate
  const end =
    Math.max(audio.duration, ...tracks.map((t) => t.buffer.duration)) + 0.5
  const offline = new OfflineAudioContext(
    2,
    Math.ceil(end * sampleRate),
    sampleRate,
  )
  const music = offline.createBufferSource()
  music.buffer = audio
  music.connect(offline.destination)
  music.start(0)
  for (const track of tracks) {
    const source = offline.createBufferSource()
    source.buffer = track.buffer
    source.connect(offline.destination)
    source.start(0)
  }
  return await offline.startRendering()
}

export const exportActivitySong = async (
  mode: ActivityExportMode,
  song: Song,
  options: {
    soundFontData: ArrayBuffer | undefined
    vocalService: VocalService
    withVocals: boolean
    backingTracks: readonly BackingTrack[]
  },
): Promise<ActivityExportResult> => {
  let audio: Uint8Array | null = null
  if (mode !== "ustx") {
    if (options.soundFontData === undefined) {
      throw new Error("The SoundFont is still loading; try again in a moment.")
    }
    song.updateEndOfSong()
    // With vocals on, the lyric tracks are sung by the voice, so their placeholder
    // soundfont notes (choir) must not end up in the mix.
    const silenced = options.withVocals
      ? getVocalTrackIds(song)
      : new Set<number>()
    const events =
      silenced.size === 0
        ? song.allEvents
        : song.allEvents.filter(
            (e) => e.trackId === null || !silenced.has(e.trackId),
          )
    let buffer = await renderAudio(
      options.soundFontData,
      events,
      song.timebase,
      44100,
      {},
    )
    if (options.withVocals) {
      const chunks = await options.vocalService.loadChunks(song)
      buffer = await mixVocals(buffer, chunks)
    }
    buffer = await mixBacking(buffer, options.backingTracks)
    audio = await encodeWAV(buffer)
  }

  const name = song.name.trim() || "arona"
  const hasVocal = getVocalTrackIds(song).size > 0
  const form = new FormData()
  form.append("mode", mode)
  form.append("name", name)
  if (audio !== null) {
    form.append(
      "audio",
      new Blob([audio as BlobPart], { type: "audio/wav" }),
      `${name}.wav`,
    )
  }
  if (mode !== "audio") {
    // Project co loi hat -> USTX (OpenUtau). Nhac cu khong -> MIDI de mo lai bang
    // bat ky DAW nao ma khong can singer/lyric.
    if (hasVocal) {
      form.append(
        "project",
        new Blob([songToUstx(song)], { type: "text/plain;charset=utf-8" }),
        `${name}.ustx`,
      )
    } else {
      form.append(
        "project",
        new Blob([songToMidi(song) as unknown as BlobPart], {
          type: "audio/midi",
        }),
        `${name}.mid`,
      )
    }
  }

  return await activityJson<ActivityExportResult>("/api/export", {
    method: "POST",
    body: form,
  })
}
