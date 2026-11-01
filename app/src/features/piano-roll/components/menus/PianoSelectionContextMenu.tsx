import { isNoteEvent } from "@signal-app/core"
import type { NoteEvent } from "@signal-app/pianoroll-editor"
import {
  ContextMenu,
  type ContextMenuProps,
  ContextMenuHotKey as HotKey,
  MenuDivider,
  MenuItem,
  SubMenu,
} from "@signal-app/ui"
import React, { type FC, useCallback } from "react"
import {
  VOCAL_LANG_LABELS,
  VOCAL_LANGS,
  type VocalLang,
  withLangTag,
} from "../../../../arona/vocalTrack"
import { useHistory } from "../../../../hooks/useHistory"
import { useSong } from "../../../../hooks/useSong"
import { envString } from "../../../../localize/envString"
import { Localized } from "../../../../localize/useLocalization"
import {
  useCopySelection,
  useDeleteSelection,
  useDuplicateSelection,
  usePasteSelection,
  useQuantizeSelectedNotes,
  useTransposeSelection,
} from "../../hooks/selection"
import { usePianoRoll } from "../../hooks/usePianoRoll"
import { usePianoRollEditor } from "../../hooks/usePianoRollEditor"
import { usePianoRollLyricsDialog } from "../../hooks/usePianoRollLyricsDialog"
import { usePianoRollVelocityDialog } from "../../hooks/usePianoRollVelocityDialog"

export const PianoSelectionContextMenu: FC<ContextMenuProps> = React.memo(
  (props) => {
    const { selectedNoteIds, selectedTrackId, setOpenTransposeDialog } =
      usePianoRoll()
    const editor = usePianoRollEditor()
    const { pushHistory } = useHistory()
    const { getTrack } = useSong()
    const { setOpen: setOpenVelocityDialog } = usePianoRollVelocityDialog()
    const { setOpen: setOpenLyricsDialog } = usePianoRollLyricsDialog()
    const isNoteSelected = selectedNoteIds.length > 0

    const copySelection = useCopySelection()
    const deleteSelection = useDeleteSelection()
    const pasteSelection = usePasteSelection()
    const duplicateSelection = useDuplicateSelection()
    const quantizeSelectedNotes = useQuantizeSelectedNotes()
    const transposeSelection = useTransposeSelection()

    const onClickCut = useCallback(() => {
      copySelection()
      deleteSelection()
    }, [copySelection, deleteSelection])

    const onClickCopy = useCallback(() => {
      copySelection()
    }, [copySelection])

    const onClickPaste = useCallback(() => {
      pasteSelection()
    }, [pasteSelection])

    const onClickDuplicate = useCallback(() => {
      duplicateSelection()
    }, [duplicateSelection])

    const onClickDelete = useCallback(() => {
      deleteSelection()
    }, [deleteSelection])

    const onClickOctaveUp = useCallback(() => {
      transposeSelection(12)
    }, [transposeSelection])

    const onClickOctaveDown = useCallback(() => {
      transposeSelection(-12)
    }, [transposeSelection])

    const onClickQuantize = useCallback(() => {
      quantizeSelectedNotes()
    }, [quantizeSelectedNotes])

    const onClickTranspose = useCallback(() => {
      setOpenTransposeDialog(true)
    }, [setOpenTransposeDialog])

    const onClickVelocity = useCallback(() => {
      setOpenVelocityDialog(true)
    }, [setOpenVelocityDialog])

    // singing language of the selected notes: a {xx} tag at the start of the lyric
    const setLanguage = useCallback(
      (lang: VocalLang | null) => {
        const track = getTrack(selectedTrackId)
        const notes = (track?.events ?? []).filter(
          (e) => isNoteEvent(e) && selectedNoteIds.includes(e.id),
        ) as NoteEvent[]
        if (notes.length === 0) {
          return
        }
        pushHistory()
        editor.updateNotes(
          notes.map((n) => ({
            ...n,
            lyric: withLangTag(n.lyric ?? "", lang),
          })),
        )
      },
      [editor, getTrack, pushHistory, selectedNoteIds, selectedTrackId],
    )

    return (
      <ContextMenu {...props}>
        <MenuItem onClick={onClickCut} disabled={!isNoteSelected}>
          <Localized name="cut" />
          <HotKey>{envString.cmdOrCtrl}+X</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickCopy} disabled={!isNoteSelected}>
          <Localized name="copy" />
          <HotKey>{envString.cmdOrCtrl}+C</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickPaste}>
          <Localized name="paste" />
          <HotKey>{envString.cmdOrCtrl}+V</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickDuplicate} disabled={!isNoteSelected}>
          <Localized name="duplicate" />
          <HotKey>{envString.cmdOrCtrl}+D</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickDelete} disabled={!isNoteSelected}>
          <Localized name="delete" />
          <HotKey>Del</HotKey>
        </MenuItem>
        <MenuDivider />
        <MenuItem onClick={onClickOctaveUp} disabled={!isNoteSelected}>
          <Localized name="one-octave-up" />
          <HotKey>Shift+↑</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickOctaveDown} disabled={!isNoteSelected}>
          <Localized name="one-octave-down" />
          <HotKey>Shift+↓</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickTranspose} disabled={!isNoteSelected}>
          <Localized name="transpose" />
          <HotKey>T</HotKey>
        </MenuItem>
        <MenuDivider />
        <MenuItem onClick={onClickQuantize} disabled={!isNoteSelected}>
          <Localized name="quantize" />
          <HotKey>Q</HotKey>
        </MenuItem>
        <MenuItem onClick={onClickVelocity} disabled={!isNoteSelected}>
          <Localized name="velocity" />
        </MenuItem>
        <MenuItem onClick={() => setOpenLyricsDialog(true)}>
          Lyrics...
          <HotKey>L</HotKey>
        </MenuItem>
        <SubMenu
          trigger={<MenuItem disabled={!isNoteSelected}>Language</MenuItem>}
        >
          <MenuItem onClick={() => setLanguage(null)}>
            Follow track / project
          </MenuItem>
          {VOCAL_LANGS.map((lang) => (
            <MenuItem key={lang} onClick={() => setLanguage(lang)}>
              {VOCAL_LANG_LABELS[lang]}
            </MenuItem>
          ))}
        </SubMenu>
      </ContextMenu>
    )
  },
)
