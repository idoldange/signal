import { type Song, songToMidi } from "@signal-app/core"

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

export const currentAuth = (): AronaAuth | null =>
  window.__arona?.auth ?? null

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

export const saveSongToChannel = async (song: Song) =>
  activityJson<{ ok: boolean; saved_at: number }>("/api/save", {
    method: "POST",
    headers: {
      "Content-Type": "audio/midi",
      "X-Save-Name": activitySaveName(song),
    },
    body: songToMidi(song) as unknown as BodyInit,
  })

// pagehide/beforeunload: fetch keepalive survives the iframe going away
export const saveSongOnExit = (song: Song) => {
  const auth = currentAuth()
  if (auth === null) {
    return
  }
  const data = songToMidi(song)
  void fetch(`${auth.baseUrl}/api/save`, {
    method: "POST",
    headers: withAuthHeaders(auth, {
      "Content-Type": "audio/midi",
      "X-Save-Name": activitySaveName(song),
    }),
    body: data as unknown as BodyInit,
    keepalive: true,
  }).catch(() => {
    // the page is going away; nothing useful can be reported
  })
}
