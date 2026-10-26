import { type MouseEvent, useCallback, useState } from "react"
import type { PitchMenuTarget } from "../components/menus/PitchContextMenu"
import { useContextMenu } from "../../../hooks/useContextMenu"
import { hitTestPitchPoint } from "../entities/pitchHit"
import { useNoteCoordTransform } from "./useNoteCoordTransform"
import { findPitchOwner, usePitchNotes } from "./usePitchNotes"

// Right click with the pitch tool: on a control point it edits that point, near a note it edits
// the note's pitch bend. Nothing opens when the click is not near any note.
export const usePitchContextMenu = () => {
  const { getLocal } = useNoteCoordTransform()
  const { geometry, entries } = usePitchNotes()
  const { onContextMenu, menuProps } = useContextMenu()
  const [target, setTarget] = useState<PitchMenuTarget>()

  const open = useCallback(
    (e: MouseEvent) => {
      const local = getLocal(e.nativeEvent)
      const hit = hitTestPitchPoint(entries, geometry, local)
      if (hit !== undefined) {
        setTarget({ noteId: hit.entry.note.id, index: hit.index })
        onContextMenu(e)
        return
      }
      const owner = findPitchOwner(entries, geometry.pixelToMs(local.x))
      if (owner !== undefined) {
        setTarget({ noteId: owner.note.id })
        onContextMenu(e)
      }
    },
    [getLocal, entries, geometry, onContextMenu],
  )

  return { open, menuProps, target }
}
