import styled from "@emotion/styled"
import Close from "mdi-react/CloseIcon"
import VolumeUp from "mdi-react/VolumeHighIcon"
import VolumeOff from "mdi-react/VolumeOffIcon"
import { type FC, useSyncExternalStore } from "react"
import { useStores } from "../hooks/useStores"
import { ValueSlider } from "./ValueSlider"

const Row = styled.div`
  display: flex;
  align-items: center;
  padding: 0.5rem 0.5rem;
  margin: 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;

  &:hover {
    background: var(--color-highlight);
  }
`

const Icon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 1.3rem;
  margin-right: 0.5rem;
  flex-shrink: 0;
  box-sizing: border-box;
  background: var(--color-background-secondary);
  border: 2px solid var(--color-divider);
`

const Info = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const Name = styled.div`
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

const Sub = styled.div`
  font-size: 0.75rem;
  color: var(--color-text-secondary);
`

const Remove = styled.div`
  width: 1.9rem;
  height: 1.9rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--color-text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--color-highlight);
    color: var(--color-text);
  }

  svg {
    width: 1.1rem;
    height: 1.1rem;
  }
`

const formatDuration = (sec: number) => {
  const total = Math.max(0, Math.round(sec))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

// Imported WAV/audio files are not MIDI tracks (they live in BackingTrackService), so the
// track list shows them in their own rows below the song's tracks.
export const BackingTrackList: FC = () => {
  const { backingTracks } = useStores()
  const tracks = useSyncExternalStore(
    backingTracks.subscribe,
    backingTracks.getSnapshot,
  )

  return (
    <>
      {tracks.map((track) => (
        <Row key={track.id}>
          <Icon>🎵</Icon>
          <Info>
            <Name title={track.name}>{track.name}</Name>
            <Sub>Audio · {formatDuration(track.buffer.duration)}</Sub>
            <ValueSlider
              label="Vol"
              min={0}
              max={100}
              value={Math.round(track.volume * 100)}
              defaultValue={100}
              dim={track.muted}
              onChange={(v) => backingTracks.setVolume(track.id, v / 100)}
            />
            <ValueSlider
              label="Pan"
              min={-100}
              max={100}
              value={Math.round(track.pan * 100)}
              defaultValue={0}
              onChange={(v) => backingTracks.setPan(track.id, v / 100)}
            />
          </Info>
          <Remove
            title={track.muted ? "Unmute" : "Mute"}
            onMouseDown={() => backingTracks.setMuted(track.id, !track.muted)}
          >
            {track.muted ? <VolumeOff /> : <VolumeUp />}
          </Remove>
          <Remove
            title="Remove audio track"
            onMouseDown={() => backingTracks.remove(track.id)}
          >
            <Close />
          </Remove>
        </Row>
      ))}
    </>
  )
}
