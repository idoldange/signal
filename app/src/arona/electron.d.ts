import type { ElectronAPI } from "../../../electron/src/ElectronAPI"

// Only present inside the Signal desktop app (preload script); undefined in a browser or a Discord Activity
declare global {
  interface Window {
    readonly electronAPI: ElectronAPI
  }
}
