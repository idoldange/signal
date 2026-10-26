import { atom } from "jotai"

// Sub-tools of the pitch tool (like OpenUtau's pitch toolbar)
export type PitchTool =
  | "point"
  | "draw"
  | "overwrite"
  | "line"
  | "scurve"
  | "sine"
  | "smooth"
  | "erase"

export const pitchToolAtom = atom<PitchTool>("point")

// Value tip shown next to the cursor while a point is dragged (piano roll content pixels)
export const pitchTipAtom = atom<{ x: number; y: number; text: string } | null>(
  null,
)
