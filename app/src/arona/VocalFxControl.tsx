import styled from "@emotion/styled"
import type { TrackId } from "@signal-app/core"
import { type FC, useSyncExternalStore } from "react"
import { useSong } from "../hooks/useSong"
import { trackFx } from "./vocalTrack"

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: var(--color-text-secondary);
`

const Toggle = styled.div`
  height: 1.25rem;
  padding: 0 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-divider);
  cursor: pointer;
  user-select: none;
  color: var(--color-text);

  &:hover {
    background: var(--color-highlight);
  }

  &[data-on="true"] {
    background: var(--color-highlight);
  }
`

const Slider = styled.input`
  flex-grow: 1;
  min-width: 0;
  height: 1rem;
`

// Karaoke echo (reverb that also smooths the voice) with its intensity, and the volume lane mode:
// "Step" holds each volume point (columns), "Slope" ramps linearly from one point to the next.
export const VocalFxControl: FC<{ trackId: TrackId }> = ({ trackId }) => {
  const { getTrack } = useSong()
  const track = getTrack(trackId)
  const fx = useSyncExternalStore(trackFx.subscribe, () =>
    track ? trackFx.get(track) : { echo: 0, slope: false },
  )
  if (!track) {
    return null
  }
  const lastEcho = Math.max(fx.echo, 40)
  return (
    <>
      <Container title="Karaoke echo: a smooth reverb tail that also softens the voice. Click to turn it on / off, drag for the intensity.">
        Echo
        <Toggle
          data-on={fx.echo > 0}
          onMouseDown={(e) => {
            e.stopPropagation()
            trackFx.set(track, { echo: fx.echo > 0 ? 0 : lastEcho })
          }}
        >
          {fx.echo > 0 ? "On" : "Off"}
        </Toggle>
        <Slider
          type="range"
          min={0}
          max={100}
          value={fx.echo}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => trackFx.set(track, { echo: Number(e.target.value) })}
        />
      </Container>
      <Container title="Volume lane: Step holds each point (columns), Slope ramps linearly between points.">
        Volume
        <Toggle
          data-on={fx.slope}
          onMouseDown={(e) => {
            e.stopPropagation()
            trackFx.set(track, { slope: !fx.slope })
          }}
        >
          {fx.slope ? "Slope" : "Step"}
        </Toggle>
      </Container>
    </>
  )
}
