import styled from "@emotion/styled"
import { isNoteEvent } from "@signal-app/core"
import type { NoteEvent } from "@signal-app/pianoroll-editor"
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  PrimaryButton,
} from "@signal-app/ui"
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { joinLyrics, splitLyrics } from "../../../../arona/lyrics/splitLyrics"
import { useHistory } from "../../../../hooks/useHistory"
import { useSong } from "../../../../hooks/useSong"
import { usePianoRoll } from "../../hooks/usePianoRoll"
import { usePianoRollEditor } from "../../hooks/usePianoRollEditor"
import { usePianoRollLyricsDialog } from "../../hooks/usePianoRollLyricsDialog"

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`

const Area = styled.textarea`
  width: 28rem;
  max-width: 100%;
  min-height: 7rem;
  resize: vertical;
  padding: 0.5rem;
  font: inherit;
  color: inherit;
  background: var(--color-background);
  border: 1px solid var(--color-divider);
  border-radius: 0.25rem;
`

const Counter = styled.span`
  color: var(--color-text-secondary);
  font-size: 0.8rem;
`

const inTimeOrder = (notes: readonly NoteEvent[]) =>
  [...notes].sort((a, b) => a.tick - b.tick || a.noteNumber - b.noteNumber)

// Modelled on the lyrics dialog of OpenUtau: one text for many notes, a live preview,
// "apply to selected notes only" and a counter of syllables against notes.
export const PianoRollLyricsDialog: FC = () => {
  const { isOpen, setOpen } = usePianoRollLyricsDialog()
  const song = useSong()
  const { selectedTrackId, selectedNoteIds } = usePianoRoll()
  const editor = usePianoRollEditor()
  const { pushHistory } = useHistory()

  const [text, setText] = useState("")
  const [applySelection, setApplySelection] = useState(false)
  const [livePreview, setLivePreview] = useState(true)
  const [originals, setOriginals] = useState<readonly NoteEvent[]>([])
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([])

  // Snapshot of the track when the dialog opens, so a preview can always be taken back
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens
  useEffect(() => {
    if (!isOpen) {
      return
    }
    const track = song.getTrack(selectedTrackId)
    const all = inTimeOrder(track?.events.filter(isNoteEvent) ?? [])
    const useSelection = selectedNoteIds.length > 0
    const initial = useSelection
      ? all.filter((n) => selectedNoteIds.includes(n.id))
      : all
    setOriginals(all)
    setSelectedIds(selectedNoteIds)
    setApplySelection(useSelection)
    setText(joinLyrics(initial.map((n) => n.lyric ?? "")))
  }, [isOpen])

  const targets = useMemo(
    () =>
      applySelection
        ? originals.filter((n) => selectedIds.includes(n.id))
        : originals,
    [applySelection, originals, selectedIds],
  )
  const lyrics = useMemo(() => splitLyrics(text), [text])

  const withLyrics = useCallback(() => {
    const assigned = new Map<number, string>()
    targets.forEach((note, i) => {
      if (i < lyrics.length) {
        assigned.set(note.id, lyrics[i])
      }
    })
    return originals.map((n) => {
      const lyric = assigned.get(n.id)
      return lyric === undefined ? n : { ...n, lyric }
    })
  }, [targets, lyrics, originals])

  // Live preview: shows the result in the piano roll without touching the undo history
  // biome-ignore lint/correctness/useExhaustiveDependencies: the preview follows text and options
  useEffect(() => {
    if (!isOpen || originals.length === 0) {
      return
    }
    editor.updateNotes(livePreview ? withLyrics() : originals)
  }, [isOpen, livePreview, withLyrics, originals])

  const onCancel = useCallback(() => {
    editor.updateNotes(originals)
    setOpen(false)
  }, [editor, originals, setOpen])

  const onApply = useCallback(() => {
    const result = withLyrics()
    editor.updateNotes(originals) // history must record the state before the lyrics
    pushHistory()
    editor.updateNotes(result)
    setOpen(false)
  }, [editor, originals, pushHistory, setOpen, withLyrics])

  const onReset = useCallback(() => {
    setText(joinLyrics(targets.map((n) => n.lyric ?? "")))
  }, [targets])

  return (
    <Dialog
      open={isOpen}
      style={{ minWidth: "20rem" }}
      aria-describedby={undefined}
    >
      <DialogTitle>Lyrics</DialogTitle>
      <DialogContent>
        <Column>
          <Area
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                onApply()
              }
            }}
            placeholder={
              'la la la, or こ ん に ち は. Quotes keep spaces: "two words". Ctrl+Enter applies.'
            }
            // biome-ignore lint/a11y/noAutofocus: the text is what the dialog is for
            autoFocus
          />
          <Counter>
            {lyrics.length} / {targets.length}
          </Counter>
          <Checkbox
            label="Apply to selected notes only"
            checked={applySelection}
            disabled={selectedIds.length === 0}
            onCheckedChange={(v) => setApplySelection(v === true)}
          />
          <Checkbox
            label="Live preview"
            checked={livePreview}
            onCheckedChange={(v) => setLivePreview(v === true)}
          />
        </Column>
      </DialogContent>
      <DialogActions>
        <Button onClick={onReset}>Reset</Button>
        <Button onClick={onCancel}>Cancel</Button>
        <PrimaryButton onClick={onApply}>Apply</PrimaryButton>
      </DialogActions>
    </Dialog>
  )
}
