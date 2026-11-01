import { type TrackId, volumeMidiEvent } from "@signal-app/core"
import { type FC, useCallback } from "react"
import { useHistory } from "../hooks/useHistory"
import { usePlayer } from "../hooks/usePlayer"
import { useTrack } from "../hooks/useTrack"
import { DEFAULT_TRACK_VOLUME, MAX_TRACK_VOLUME } from "./trackVolume"
import { ValueSlider } from "./ValueSlider"

// Volume of one track (MIDI volume 0-127, 100 = default). It also scales the Arona vocal of
// the track, so it works for vocal and instrument tracks alike.
export const TrackVolumeControl: FC<{ trackId: TrackId }> = ({ trackId }) => {
  const { volume, setVolume, channel } = useTrack(trackId)
  const { sendEvent } = usePlayer()
  const { pushHistory } = useHistory()

  const apply = useCallback(
    (value: number) => {
      setVolume(value, 0)
      // heard at once while playing: the controller at the start of the song has already passed
      if (channel !== undefined) {
        sendEvent(volumeMidiEvent(0, channel, value))
      }
    },
    [setVolume, sendEvent, channel],
  )

  return (
    <ValueSlider
      label="Vol"
      min={0}
      max={MAX_TRACK_VOLUME}
      value={volume}
      defaultValue={DEFAULT_TRACK_VOLUME}
      onChange={apply}
      onStart={pushHistory}
      title="Track volume 0-127 (double-click the slider to reset, click the number to type one)"
    />
  )
}
