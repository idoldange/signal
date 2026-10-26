import type { PitchShape } from "@signal-app/core"
import {
  ContextMenu,
  type ContextMenuProps,
  MenuDivider,
  MenuItem,
} from "@signal-app/ui"
import { type FC, useCallback } from "react"
import { useHistory } from "../../../../hooks/useHistory"
import {
  DEFAULT_VIBRATO,
  removePoint,
  setVibrato,
  setPointShape,
  toggleSnapFirst,
} from "../../entities/pitchCurve"
import { usePianoRollEditor } from "../../hooks/usePianoRollEditor"
import { usePitchNotes } from "../../hooks/usePitchNotes"

export interface PitchMenuTarget {
  noteId: number
  // control point under the cursor, when there is one
  index?: number
}

const shapeLabels: readonly { shape: PitchShape; label: string }[] = [
  { shape: "io", label: "Smooth (ease in-out)" },
  { shape: "l", label: "Linear" },
  { shape: "i", label: "Ease in" },
  { shape: "o", label: "Ease out" },
  { shape: "sp", label: "Spline" },
]

const check = (on: boolean) => (on ? "✓ " : "")

export const PitchContextMenu: FC<
  ContextMenuProps & { target: PitchMenuTarget | undefined }
> = ({ target, ...props }) => {
  const { entries } = usePitchNotes()
  const pianoRollEditor = usePianoRollEditor()
  const { pushHistory } = useHistory()

  const entry =
    target === undefined
      ? undefined
      : entries.find((e) => e.note.id === target.noteId)
  const index = target?.index
  const point = index === undefined ? undefined : entry?.pitch.points[index]

  const change = useCallback(
    (next: ReturnType<typeof setPointShape> | undefined) => {
      if (entry === undefined) {
        return
      }
      pushHistory()
      pianoRollEditor.updateNote({ id: entry.note.id, pitch: next })
    },
    [entry, pianoRollEditor, pushHistory],
  )

  return (
    <ContextMenu {...props}>
      {entry !== undefined && index !== undefined && point !== undefined && (
        <>
          {shapeLabels.map(({ shape, label }) => (
            <MenuItem
              key={shape}
              onClick={() => change(setPointShape(entry.pitch, index, shape))}
            >
              {check(point.shape === shape)}
              {label}
            </MenuItem>
          ))}
          <MenuItem onClick={() => change(removePoint(entry.pitch, index))}>
            Delete point
          </MenuItem>
          <MenuDivider />
        </>
      )}
      <MenuItem
        disabled={entry === undefined}
        onClick={() => entry && change(toggleSnapFirst(entry.pitch))}
      >
        {check(entry?.pitch.snapFirst ?? false)}
        Snap first point to previous note
      </MenuItem>
      <MenuItem
        disabled={entry === undefined}
        onClick={() =>
          entry &&
          change(
            setVibrato(
              entry.pitch,
              entry.pitch.vibrato === undefined ? DEFAULT_VIBRATO : undefined,
            ),
          )
        }
      >
        {check(entry?.pitch.vibrato !== undefined)}
        Vibrato
      </MenuItem>
      <MenuItem
        disabled={entry === undefined || !entry.stored}
        onClick={() => change(undefined)}
      >
        Reset pitch bend
      </MenuItem>
    </ContextMenu>
  )
}
