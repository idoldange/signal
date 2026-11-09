import { isNoteEvent } from "@signal-app/core"
import type { NoteEvent } from "@signal-app/pianoroll-editor"
import {
  ContextMenu,
  type ContextMenuProps,
  ContextMenuHotKey as HotKey,
  MenuDivider,
  MenuItem,
} from "@signal-app/ui"
import React, { type FC, useCallback } from "react"
import { alignStore } from "../../../../arona/alignStore"
import { useVocalGenPrompts } from "../../../../arona/useVocalGen"
import {
  nudgeOf,
  randomSeed,
  splitLangTag,
  splitTags,
  VOCAL_LANG_LABELS,
  VOCAL_LANGS,
  type VocalLang,
  withLangTag,
  withNudge,
  withTags,
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

    // manual syllable alignment: shift where the syllable of the selected notes starts in the
    // generated voice (<+30> tag in the lyric). delta = null resets it.
    const nudgeNotes = useCallback(
      (delta: number | null) => {
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
            lyric: withNudge(
              n.lyric ?? "",
              delta === null ? 0 : nudgeOf(n.lyric ?? "") + delta,
            ),
          })),
        )
      },
      [editor, getTrack, pushHistory, selectedNoteIds, selectedTrackId],
    )

    // temperature / seed of the selected notes (<t0.7> / <s123> tags). A phrase is generated once, with
    // the first note that has such a tag; notes without tags follow the track, then the project.
    const { askTemperature, askSeed } = useVocalGenPrompts()
    const tagNotes = useCallback(
      async (kind: "temp" | "seed" | "random" | "reset") => {
        const track = getTrack(selectedTrackId)
        const notes = (track?.events ?? []).filter(
          (e) => isNoteEvent(e) && selectedNoteIds.includes(e.id),
        ) as NoteEvent[]
        if (notes.length === 0) {
          return
        }
        const cur = splitTags(splitLangTag(notes[0].lyric ?? "").text)
        let patch: { temp?: number | null; seed?: number | null }
        if (kind === "temp") {
          const v = await askTemperature("selected notes", cur.temp)
          if (v === undefined) {
            return
          }
          patch = { temp: v }
        } else if (kind === "seed") {
          const v = await askSeed("selected notes", cur.seed)
          if (v === undefined) {
            return
          }
          patch = { seed: v }
        } else if (kind === "random") {
          patch = { seed: randomSeed() }
        } else {
          patch = { temp: null, seed: null }
        }
        pushHistory()
        editor.updateNotes(
          notes.map((n) => ({ ...n, lyric: withTags(n.lyric ?? "", patch) })),
        )
      },
      [
        askSeed,
        askTemperature,
        editor,
        getTrack,
        pushHistory,
        selectedNoteIds,
        selectedTrackId,
      ],
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
        <MenuDivider />
        <MenuItem onClick={() => setLanguage(null)} disabled={!isNoteSelected}>
          Language: follow track / project
        </MenuItem>
        {VOCAL_LANGS.map((lang) => (
          <MenuItem
            key={lang}
            onClick={() => setLanguage(lang)}
            disabled={!isNoteSelected}
          >
            Language: {VOCAL_LANG_LABELS[lang]}
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem onClick={() => nudgeNotes(-30)} disabled={!isNoteSelected}>
          Align: earlier 30 ms
        </MenuItem>
        <MenuItem onClick={() => nudgeNotes(-10)} disabled={!isNoteSelected}>
          Align: earlier 10 ms
        </MenuItem>
        <MenuItem onClick={() => nudgeNotes(10)} disabled={!isNoteSelected}>
          Align: later 10 ms
        </MenuItem>
        <MenuItem onClick={() => nudgeNotes(30)} disabled={!isNoteSelected}>
          Align: later 30 ms
        </MenuItem>
        <MenuItem onClick={() => nudgeNotes(null)} disabled={!isNoteSelected}>
          Align: reset
        </MenuItem>
        <MenuItem
          disabled={!isNoteSelected}
          onClick={() => {
            const track = getTrack(selectedTrackId)
            const first = (track?.events ?? [])
              .filter((e) => isNoteEvent(e) && selectedNoteIds.includes(e.id))
              .sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0))[0]
            if (first !== undefined) {
              alignStore.open({
                trackId: selectedTrackId,
                tick: first.tick ?? 0,
              })
            }
          }}
        >
          Align: edit on waveform...
        </MenuItem>
        <MenuDivider />
        <MenuItem onClick={() => tagNotes("temp")} disabled={!isNoteSelected}>
          Voice: temperature...
        </MenuItem>
        <MenuItem onClick={() => tagNotes("seed")} disabled={!isNoteSelected}>
          Voice: seed...
        </MenuItem>
        <MenuItem onClick={() => tagNotes("random")} disabled={!isNoteSelected}>
          Voice: random seed
        </MenuItem>
        <MenuItem onClick={() => tagNotes("reset")} disabled={!isNoteSelected}>
          Voice: reset temperature and seed
        </MenuItem>
      </ContextMenu>
    )
  },
)
