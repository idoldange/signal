import styled from "@emotion/styled"
import type { TrackId } from "@signal-app/core"
import { type FC, useSyncExternalStore } from "react"
import { useSong } from "../hooks/useSong"
import { useStores } from "../hooks/useStores"
import {
  isVocalLang,
  VOCAL_LANG_LABELS,
  VOCAL_LANGS,
  vocalLanguage,
  vocalTrackFlags,
} from "./vocalTrack"

const Container = styled.label`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: var(--color-text-secondary);
`

const Select = styled.select`
  flex-grow: 1;
  min-width: 0;
  font-size: 0.7rem;
  color: var(--color-text);
  background: var(--color-background);
  border: 1px solid var(--color-divider);
  border-radius: 0.25rem;
  padding: 0.1rem 0.2rem;
`

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

// Singing language of one vocal track. "Auto" follows the language of the project.
export const VocalLanguageControl: FC<{ trackId: TrackId }> = ({ trackId }) => {
  const { songStore } = useStores()
  const { getTrack } = useSong()
  const track = getTrack(trackId)
  const own = useSyncExternalStore(vocalTrackFlags.subscribe, () =>
    track ? vocalLanguage.ofTrack(track) : null,
  )
  const projectLang = useSyncExternalStore(vocalTrackFlags.subscribe, () =>
    vocalLanguage.ofSong(songStore.song),
  )
  if (!track) {
    return null
  }
  return (
    <Container title="Singing language of this track. A {xx} tag at the start of a note's lyric overrides it.">
      Lang
      <Select
        value={own ?? ""}
        onPointerDown={stop}
        onMouseDown={stop}
        onKeyDown={stop}
        onChange={(e) => {
          const value = e.target.value
          vocalLanguage.setTrack(track, isVocalLang(value) ? value : null)
        }}
      >
        <option value="">
          {projectLang === null
            ? "Auto (project)"
            : `Project (${VOCAL_LANG_LABELS[projectLang]})`}
        </option>
        {VOCAL_LANGS.map((lang) => (
          <option key={lang} value={lang}>
            {VOCAL_LANG_LABELS[lang]}
          </option>
        ))}
      </Select>
    </Container>
  )
}
