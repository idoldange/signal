import type { TrackId } from "@signal-app/core"

// "Edit on waveform": which note the alignment dialog is open for (null = closed).
export interface AlignTarget {
  trackId: TrackId
  tick: number
}

let current: AlignTarget | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const alignStore = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  open(target: AlignTarget) {
    current = target
    emit()
  },
  close() {
    current = null
    emit()
  },
}
