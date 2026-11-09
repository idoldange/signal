import { type Song, songFromMidi } from "@signal-app/core"
import type { SoundFontSynth } from "@signal-app/player"
import {
  ActivityApiError,
  type ActivityProject,
  activityFetch,
  activityJson,
} from "./activityApi"
import { loadProjectFonts } from "./activityFonts"
import { projectToSong } from "./projectToSong"
import { vocalLanguage, vocalSaveMeta } from "./vocalTrack"

export const fetchActivityProjects = async (): Promise<ActivityProject[]> => {
  const body = await activityJson<{ projects?: ActivityProject[] }>(
    "/api/session/imports",
  )
  return body.projects ?? []
}

export interface LatestSave {
  song: Song
  name: string
  savedAt: number
}

// One entry of Recents: the newest save of a project of this voice channel.
export interface SaveEntry {
  id: string
  name: string
  saved_at: number
  user: number | string
  lang: string
}

// A save (autosave or Save to channel) -> song, with its singing languages restored.
const songFromSave = async (res: Response): Promise<LatestSave> => {
  const data = await res.arrayBuffer()
  const song = songFromMidi(new Uint8Array(data))
  const headerName = res.headers.get("X-Save-Name")
  if (headerName) {
    try {
      song.name = decodeURIComponent(headerName)
    } catch {
      song.name = headerName
    }
  }
  let tracks: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(res.headers.get("X-Save-Tracks") ?? "{}")
    tracks =
      typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    tracks = null
  }
  vocalLanguage.restore(song, res.headers.get("X-Save-Lang"), tracks)
  try {
    vocalSaveMeta.restore(
      song,
      JSON.parse(res.headers.get("X-Save-Meta") ?? "null"),
    )
  } catch {
    // old save without meta
  }
  song.isSaved = true
  return {
    song,
    name: song.name,
    savedAt: Number(res.headers.get("X-Saved-At")) || Date.now(),
  }
}

export const fetchLatestSave = async (): Promise<LatestSave | null> => {
  try {
    return await songFromSave(await activityFetch("/api/save/latest"))
  } catch (e) {
    if (e instanceof ActivityApiError && e.status === 404) {
      return null
    }
    throw e
  }
}

export const fetchSaveList = async (): Promise<SaveEntry[]> =>
  (await activityJson<{ saves?: SaveEntry[] }>("/api/save/list")).saves ?? []

export const fetchSave = async (id: string): Promise<LatestSave> =>
  await songFromSave(await activityFetch(`/api/save/${encodeURIComponent(id)}`))

// .mid/.ust/.ustx opened from the computer: the bot parses and classifies it (same code as
// the `!arona synth` panel), so instruments, soundfonts and vocal tracks stay correct.
// Any audio/video file -> WAV bytes, converted by the bot with ffmpeg.
export const convertAudioToWav = async (file: File): Promise<ArrayBuffer> => {
  const res = await activityFetch("/api/audio/convert", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: (await file.arrayBuffer()) as BodyInit,
  })
  return await res.arrayBuffer()
}

export const importActivityProject = async (
  file: File,
): Promise<ActivityProject> => {
  const res = await activityFetch("/api/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: (await file.arrayBuffer()) as BodyInit,
  })
  const body = (await res.json()) as { projects?: ActivityProject[] }
  const project = body.projects?.[0]
  if (project === undefined) {
    throw new Error(`${file.name} has no tracks with notes`)
  }
  return project
}

export const openActivityFile = async (
  file: File,
  setSong: (song: Song) => void,
  synth: SoundFontSynth,
): Promise<string> => {
  const project = await importActivityProject(file)
  await synth.setup()
  const fonts = await loadProjectFonts(synth, project)
  setSong(projectToSong(project, fonts))
  return project.name
}

// Opening the Activity: continue the latest take of this voice channel, otherwise
// open the file that was uploaded to the `!arona synth` panel before pressing Open DAW.
export const openActivitySong = async (
  setSong: (song: Song) => void,
  synth: SoundFontSynth,
): Promise<"save" | "panel" | null> => {
  const latest = await fetchLatestSave()
  if (latest !== null) {
    setSong(latest.song)
    return "save"
  }
  const projects = await fetchActivityProjects()
  const first = projects[0]
  if (first !== undefined) {
    let fonts = new Map<string, number>()
    try {
      await synth.setup()
      fonts = await loadProjectFonts(synth, first)
    } catch (e) {
      console.warn("[arona] could not load the project soundfonts", e)
    }
    setSong(projectToSong(first, fonts))
    return "panel"
  }
  return null
}
