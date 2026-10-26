import { useCallback, useMemo } from "react"
import type { MouseDownHandler } from "../../../gesture/MouseGesture"
import { usePianoRoll } from "../hooks/usePianoRoll"
import { useChangeToolGesture } from "./useChangeToolGesture"
import { useDragScrollGesture } from "./useDragScrollGesture"
import { usePencilGesture } from "./usePencilGesture"
import { usePitchGesture } from "./usePitchGesture"
import { useSelectionGesture } from "./useSelectionGesture"

export const useNoteMouseGesture = (): MouseDownHandler<
  [],
  React.MouseEvent
> => {
  const { mouseMode } = usePianoRoll()
  const pencilGesture = usePencilGesture()
  const selectionGesture = useSelectionGesture()
  const pitchGesture = usePitchGesture()
  const currentGesture = useMemo(() => {
    switch (mouseMode) {
      case "pencil":
        return pencilGesture
      case "selection":
        return selectionGesture
      case "pitch":
        return pitchGesture
    }
  }, [mouseMode, pencilGesture, selectionGesture, pitchGesture])
  const dragScrollAction = useDragScrollGesture()
  const changeToolAction = useChangeToolGesture()

  const getGestureForMouseDown = useCallback(
    (e: MouseEvent) => {
      // Common Action

      // wheel drag to start scrolling
      if (e.button === 1) {
        return dragScrollAction
      }

      // Right Double-click
      if (e.button === 2 && e.detail % 2 === 0) {
        return changeToolAction
      }

      return currentGesture
    },
    [changeToolAction, currentGesture, dragScrollAction],
  )

  return useCallback(
    (ev) => {
      const e = ev.nativeEvent
      getGestureForMouseDown(e)(e)
    },
    [getGestureForMouseDown],
  )
}
