import styled from "@emotion/styled"
import type { TrackId } from "@signal-app/core"
import { type FC, useEffect, useReducer } from "react"
import { useSong } from "../hooks/useSong"
import { useStores } from "../hooks/useStores"
import { useTrack } from "../hooks/useTrack"
import { autoTransposeOf, vocalTrackTranspose } from "./vocalTrack"

const MAX_TRANSPOSE = 48

const Container = styled.div`
  display: flex;
  align-items: center;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: var(--color-text-secondary);
`

const Label = styled.div`
  min-width: 4.2rem;
  text-align: center;
  white-space: nowrap;
  color: var(--color-text);

  &[data-auto="true"] {
    color: var(--color-text-secondary);
  }
`

const Step = styled.div`
  flex-shrink: 0;
  min-width: 1.6rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-divider);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--color-highlight);
  }
`

const Reset = styled(Step)`
  margin-left: 0.25rem;
  padding: 0 0.3rem;
`

const format = (value: number) => (value > 0 ? `+${value}` : `${value}`)

// Transpose of one vocal track. "Auto" is a single octave shift shared by the whole song;
// pressing a step turns the track into a manual one (starting from what auto would give),
// and "Auto" goes back to following the song.
export const VocalTransposeControl: FC<{ trackId: TrackId }> = ({
  trackId,
}) => {
  const { songStore } = useStores()
  const { getTrack } = useSong()
  const { vocalTranspose } = useTrack(trackId)
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  const song = songStore.song

  // The auto value depends on the notes of every track, so follow their edits.
  useEffect(() => {
    const subs = song.tracks.map((t) => t.onChanged.subscribe(refresh))
    const offTracks = song.onTracksChanged.subscribe(refresh)
    return () => {
      subs.forEach((unsubscribe) => unsubscribe())
      offTracks()
    }
  }, [song])

  const track = getTrack(trackId)
  if (!track) {
    return null
  }

  const auto = autoTransposeOf(song)
  const current = vocalTranspose ?? auto
  const isAuto = vocalTranspose === null

  const step = (delta: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = Math.max(
      -MAX_TRANSPOSE,
      Math.min(MAX_TRANSPOSE, current + delta),
    )
    vocalTrackTranspose.set(track, next)
  }

  const onAuto = (e: React.MouseEvent) => {
    e.stopPropagation()
    vocalTrackTranspose.set(track, null)
  }

  return (
    <Container title="Transpose of this vocal track (semitones). Auto = one octave shift shared by the whole song.">
      <Step onMouseDown={step(-12)}>-12</Step>
      <Step onMouseDown={step(-1)}>-1</Step>
      <Label data-auto={isAuto}>
        {isAuto ? `Auto (${format(auto)})` : `${format(current)} st`}
      </Label>
      <Step onMouseDown={step(1)}>+1</Step>
      <Step onMouseDown={step(12)}>+12</Step>
      {!isAuto && <Reset onMouseDown={onAuto}>Auto</Reset>}
    </Container>
  )
}
