// Trong Discord Activity (iframe) navigator.clipboard thuong bi chan, nen luu them
// ban sao trong bo nho: copy/paste giua cac track van chay du clipboard he thong hong.
let memoryClipboard: string | null = null
// false khi lan ghi clipboard he thong gan nhat that bai -> ban trong bo nho moi hon
let systemInSync = true

function parseJSON(text: string | null | undefined): object | null {
  if (!text) {
    return null
  }
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

export async function readClipboardData(): Promise<object | null> {
  if (memoryClipboard !== null && !systemInSync) {
    return parseJSON(memoryClipboard)
  }
  try {
    const parsed = parseJSON(await navigator.clipboard.readText())
    if (parsed) {
      return parsed
    }
  } catch {
    // bi chan quyen doc -> dung ban trong bo nho
  }
  return parseJSON(memoryClipboard)
}

export async function writeClipboardData<T extends object>(
  data: T,
): Promise<void> {
  const jsonData = JSON.stringify(data)
  memoryClipboard = jsonData
  try {
    await navigator.clipboard.writeText(jsonData)
    systemInSync = true
  } catch (error) {
    systemInSync = false
    console.warn("System clipboard unavailable, using in-app clipboard:", error)
  }
}

export function readJSONFromClipboard(e: ClipboardEvent) {
  const parsed = parseJSON(e.clipboardData?.getData("text/plain"))
  if (parsed && (systemInSync || memoryClipboard === null)) {
    return parsed
  }
  return parseJSON(memoryClipboard) ?? parsed
}
