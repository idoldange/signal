import { type Song, songToMidi } from "@signal-app/core"
import { vocalLanguage, vocalSaveMeta } from "./vocalTrack"

// Filled by arona-boot.js after the Discord Embedded App SDK login
export interface AronaAuth {
  baseUrl: string
  token: string
  channelId: string
}

interface AronaState {
  auth?: AronaAuth | null
  ready?: Promise<AronaAuth | null>
}

declare global {
  interface Window {
    __arona?: AronaState
  }
}

export class ActivityApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const currentAuth = (): AronaAuth | null => window.__arona?.auth ?? null

export const getActivityAuth = async (): Promise<AronaAuth | null> => {
  const state = window.__arona
  if (state === undefined) {
    return null
  }
  try {
    await state.ready
  } catch {
    // the boot script dispatches arona-auth-error; auth stays null
  }
  return state.auth ?? null
}

const withAuthHeaders = (auth: AronaAuth, headers?: HeadersInit) => {
  const h = new Headers(headers)
  h.set("Authorization", `Bearer ${auth.token}`)
  h.set("X-Channel-Id", auth.channelId)
  return h
}

export const activityFetch = async (
  path: string,
  init: RequestInit = {},
  okStatuses: readonly number[] = [200],
): Promise<Response> => {
  const auth = await getActivityAuth()
  if (auth === null) {
    throw new Error("Not running inside the Arona Discord Activity")
  }
  const res = await fetch(`${auth.baseUrl}${path}`, {
    ...init,
    headers: withAuthHeaders(auth, init.headers),
  })
  if (!okStatuses.includes(res.status)) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string }
      message = body.error ?? message
    } catch {
      // not a JSON error body
    }
    throw new ActivityApiError(res.status, message)
  }
  return res
}

export const activityJson = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => (await activityFetch(path, init)).json() as Promise<T>

export interface ActivityProjectNote {
  pos: number
  dur: number
  tone: number
  lyric: string
  vel: number
  // Pitch bend read from the UST/USTX (OpenUtau units), see NotePitch in @signal-app/core
  pitch?: unknown
}

export interface ActivityProjectTrack {
  idx?: number
  name: string
  role?: string
  program: number
  bank?: number
  sf?: string
  preset?: string
  drums: boolean
  notes: ActivityProjectNote[]
}

export interface ActivityProject {
  name: string
  ppq: number
  tempos: [number, number][]
  tracks: ActivityProjectTrack[]
}

export interface VocalChunkInfo {
  index: number
  hash: string
  start_sec: number
  end_sec: number
  notes: number
  cached: boolean
}

export const activitySaveName = (song: Song) =>
  encodeURIComponent(song.name.trim() || "arona")

// name + singing languages of the project, stored next to the save so Recents reopens them
export const activitySaveHeaders = (song: Song): Record<string, string> => ({
  "X-Save-Name": activitySaveName(song),
  "X-Save-Lang": vocalLanguage.ofSong(song) ?? "auto",
  "X-Save-Tracks": JSON.stringify(vocalLanguage.tracksOf(song)),
  "X-Save-Meta": JSON.stringify(vocalSaveMeta.of(song)),
})

export const saveSongToChannel = async (song: Song) =>
  activityJson<{ ok: boolean; saved_at: number }>("/api/save", {
    method: "POST",
    headers: {
      "Content-Type": "audio/midi",
      ...activitySaveHeaders(song),
    },
    body: songToMidi(song) as unknown as BodyInit,
  })

// keepalive requests are capped at 64 KiB by browsers: a bigger body would be rejected and the
// save silently lost, so those rely on the periodic autosave instead (ActivityAutoSave).
const KEEPALIVE_MAX = 60 * 1024

// pagehide/beforeunload: fetch keepalive survives the iframe going away
export const saveSongOnExit = (song: Song) => {
  const auth = currentAuth()
  if (auth === null) {
    return
  }
  const data = songToMidi(song)
  if (data.byteLength > KEEPALIVE_MAX) {
    return
  }
  void fetch(`${auth.baseUrl}/api/save`, {
    method: "POST",
    headers: withAuthHeaders(auth, {
      "Content-Type": "audio/midi",
      ...activitySaveHeaders(song),
    }),
    body: data as unknown as BodyInit,
    keepalive: true,
  }).catch(() => {
    // the page is going away; nothing useful can be reported
  })
}

// "Edit on waveform": the raw voice of the chunk that holds a note + where each syllable starts.
export interface AlignGroup {
  pos: number | null
  text: string
  start_ms: number
  nudge: number
}

export interface AlignPhrase {
  aligned: boolean
  // false = the automatic align failed (syllable count != note count) or the phrase is in
  // "Even stretch" mode; the groups are still there so the client can align them by hand
  auto?: boolean
  // true = the phrase was generated in "Even stretch" mode (syllable_align off)
  stretched?: boolean
  sr: number
  dur_ms: number
  end_ms?: number
  wav: string
  groups: AlignGroup[]
}

export const fetchAlignView = async (body: unknown) =>
  activityJson<{ phrases: AlignPhrase[] }>("/api/vocal/alignview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
