import { useEffect, useState } from "react"
import { getSongTempos } from "../../../arona/songToUstx"
import { useSong } from "../../../hooks/useSong"

// The song's tempo map ([tick, bpm][]), kept up to date when tempo events change.
export const useSongTempos = (): [number, number][] => {
  const { conductorTrack, getSong } = useSong()
  const [tempos, setTempos] = useState(() => getSongTempos(getSong()))

  useEffect(() => {
    const update = () => setTempos(getSongTempos(getSong()))
    update()
    return conductorTrack?.onEventsChanged.subscribe(update) ?? (() => {})
  }, [conductorTrack, getSong])

  return tempos
}
