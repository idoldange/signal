export function getPlatform() {
  const platform = navigator.platform.toLowerCase()
  let os = null

  if (platform.indexOf("win") >= 0) {
    os = "Windows"
  } else if (platform.indexOf("mac") >= 0) {
    os = "macOS"
  }

  return os
}

export function isRunningInElectron() {
  // electronAPI is injected by Electron's preload script (contextBridge).
  // Do not detect via user agent: the Discord desktop client is Electron-based,
  // so its Activity iframe also reports "Electron/" but has no electronAPI.
  return typeof window !== "undefined" &&
    (window as { electronAPI?: unknown }).electronAPI !== undefined
}
