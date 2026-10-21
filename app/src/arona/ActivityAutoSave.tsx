import { type FC, useEffect } from "react"
import { useSong } from "../hooks/useSong"
import { isDiscordActivity } from "./activity"
import { saveSongOnExit } from "./activityApi"

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
    window.addEventListener("pagehide", save)
    window.addEventListener("beforeunload", save)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("pagehide", save)
      window.removeEventListener("beforeunload", save)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [getSong])

  return null
}
