// electronAPI is injected by Electron's preload script (contextBridge).
// Do not detect via user agent: the Discord desktop client is Electron-based,
// so its Activity iframe also reports "Electron/" but has no electronAPI.
export function isRunningInElectron() {
  return (
    typeof window !== "undefined" &&
    (window as { electronAPI?: unknown }).electronAPI !== undefined
  )
}
