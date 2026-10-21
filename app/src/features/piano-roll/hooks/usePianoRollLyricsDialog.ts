import { atom, useAtomValue, useSetAtom } from "jotai"

export function usePianoRollLyricsDialog() {
  return {
    setOpen: useSetAtom(openLyricsDialogAtom),
    get isOpen() {
      return useAtomValue(openLyricsDialogAtom)
    },
  }
}

const openLyricsDialogAtom = atom<boolean>(false)
