import styled from "@emotion/styled"
import type { TrackId } from "@signal-app/core"
import { type FC, useSyncExternalStore } from "react"
import { useSong } from "../hooks/useSong"
import { vocalTrackFlags, vocalTrackStretch } from "./vocalTrack"

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: var(--color-text-secondary);
`

const Toggle = styled.div`
  flex-grow: 1;
  height: 1.25rem;
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

  &[data-stretch="true"] {
    background: var(--color-highlight);
  }
`

// How the voice of one track is fitted to its notes: "Auto" aligns every syllable to its note,
// "Even stretch" skips that and stretches each phrase evenly (safe fallback).
export const VocalAlignControl: FC<{ trackId: TrackId }> = ({ trackId }) => {
  const { getTrack } = useSong()
  const track = getTrack(trackId)
  const stretch = useSyncExternalStore(vocalTrackFlags.subscribe, () =>
    track ? vocalTrackStretch.has(track) : false,
  )
  if (!track) {
    return null
  }
  return (
    <Container title="Auto: each syllable is aligned to its note (nudge a note with right click > Align syllable). Even stretch: stretch the whole phrase evenly.">
      Align
      <Toggle
        data-stretch={stretch}
        onMouseDown={(e) => {
          e.stopPropagation()
          vocalTrackStretch.set(track, !stretch)
        }}
      >
        {stretch ? "Even stretch" : "Auto"}
      </Toggle>
    </Container>
  )
}
