import { type Song, songToMidi } from "@signal-app/core"
import { type FC, useEffect } from "react"
import { useSong } from "../hooks/useSong"
import { isDiscordActivity } from "./activity"
import { saveSongOnExit, saveSongToChannel } from "./activityApi"
import { vocalLanguage, vocalSaveMeta } from "./vocalTrack"

// Cheap change detector: MIDI bytes + per-track vocal meta/languages.
const signature = (song: Song): string => {
  const data = songToMidi(song)
  let h = 5381
  for (let i = 0; i < data.length; i++) {
    h = ((h * 33) ^ (data[i] ?? 0)) | 0
  }
  return `${data.length}:${h}:${song.name}:${JSON.stringify(vocalSaveMeta.of(song))}:${JSON.stringify(vocalLanguage.tracksOf(song))}:${vocalLanguage.ofSong(song)}`
}

// Leaving the Activity (closing the Discord panel, switching channel) saves the take
// to the bot so the next launch of this voice channel opens it again.
export const ActivityAutoSave: FC = () => {
  const { getSong } = useSong()

  useEffect(() => {
    if (!isDiscordActivity) {
      return
    }
    let lastSave = 0
    const save = () => {
      const now = Date.now()
      if (now - lastSave < 3000) {
        return
      }
      lastSave = now
      const song = getSong()
      saveSongOnExit(song)
      song.isSaved = true
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        save()
      }
    }
    // Periodic autosave: exit saves are best effort (browsers drop big keepalive bodies), so
    // the take is also sent every 20 s while it keeps changing.
    let busy = false
    let lastSig = ""
    const periodic = async () => {
      if (busy || document.visibilityState === "hidden") {
        return
      }
      const song = getSong()
      const sig = signature(song)
      if (sig === lastSig) {
        return
      }
      busy = true
      try {
        await saveSongToChannel(song)
        lastSig = sig
        song.isSaved = true
      } catch {
        // retry on the next tick
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => void periodic(), 20000)
    window.addEventListener("pagehide", save)
    window.addEventListener("beforeunload", save)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("pagehide", save)
      window.removeEventListener("beforeunload", save)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [getSong])

  return null
}
