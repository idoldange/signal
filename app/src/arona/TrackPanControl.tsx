import { panMidiEvent, type TrackId } from "@signal-app/core"
import { type FC, useCallback } from "react"
import { useHistory } from "../hooks/useHistory"
import { usePlayer } from "../hooks/usePlayer"
import { useTrack } from "../hooks/useTrack"
import { ccFromPanPercent, panPercentFromCc } from "./trackVolume"
import { ValueSlider } from "./ValueSlider"

// Left / right balance of one track: -100 = all left, 0 = centre, 100 = all right (MIDI pan
// 0-127 underneath). It pans the Arona vocal of the track too.
export const TrackPanControl: FC<{ trackId: TrackId }> = ({ trackId }) => {
  const { pan, setPan, channel } = useTrack(trackId)
  const { sendEvent } = usePlayer()
  const { pushHistory } = useHistory()

  const apply = useCallback(
    (percent: number) => {
      const cc = ccFromPanPercent(percent)
      setPan(cc, 0)
      if (channel !== undefined) {
        sendEvent(panMidiEvent(0, channel, cc))
      }
    },
    [setPan, sendEvent, channel],
  )

  return (
    <ValueSlider
      label="Pan"
      min={-100}
      max={100}
      value={panPercentFromCc(pan)}
      defaultValue={0}
      onChange={apply}
      onStart={pushHistory}
      title="Left / right: -100 = left, 100 = right (double-click the slider to centre, click the number to type one)"
    />
  )
}
