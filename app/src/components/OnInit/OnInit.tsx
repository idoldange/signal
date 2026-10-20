import { useProgress } from "dialog-hooks"
import { type FC, useEffect, useRef, useState } from "react"
import { useMIDIDevice } from "../../features/midi-device/hooks/useMIDIDevice"
import { useSoundFont } from "../../features/soundfont/hooks/useSoundFont"
import { useAutoSave } from "../../hooks/useAutoSave"
import { isDiscordActivity } from "../../arona/activity"
import { useStores } from "../../hooks/useStores"
import { useLocalization } from "../../localize/useLocalization"
import { AutoSaveDialog } from "../AutoSaveDialog/AutoSaveDialog"
import { InitializeErrorDialog } from "./InitializeErrorDialog"

export const OnInit: FC = () => {
  const rootStore = useStores()

  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [isAutoSaveDialogOpen, setIsAutoSaveDialogOpen] = useState(false)
  const { show: showProgress } = useProgress()
  const localized = useLocalization()
  const { shouldShowAutoSaveDialog } = useAutoSave()
  const { initSoundFont } = useSoundFont()
  const { initMIDIDevice } = useMIDIDevice()
  const didInit = useRef(false)

  const init = async () => {
    const closeProgress = showProgress(localized["initializing"])
    try {
      await rootStore.init()
      await initSoundFont()
      // Web MIDI asks for a permission. Inside a Discord Activity that prompt can stay unanswered forever and
      // would block the whole editor, so there it only connects when the user presses the button in the MIDI settings.
      if (!isDiscordActivity) {
        await initMIDIDevice()
      }
    } catch (e) {
      setIsErrorDialogOpen(true)
      setErrorMessage((e as Error).message)
    } finally {
      closeProgress()
    }
  }

  const checkAutoSave = async () => {
    // Skip auto save restore if external file loading is present
    const params = new URLSearchParams(window.location.search)
    const openParam = params.get("open")
    if (openParam) {
      return
    }

    // Check for auto save restore
    if (shouldShowAutoSaveDialog()) {
      setIsAutoSaveDialogOpen(true)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  useEffect(() => {
    // StrictMode runs effects twice in development
    if (didInit.current) {
      return
    }
    didInit.current = true
    ;(async () => {
      await init()
      await checkAutoSave()
    })()
  }, [])

  return (
    <>
      <InitializeErrorDialog
        open={isErrorDialogOpen}
        message={errorMessage}
        onClose={() => setIsErrorDialogOpen(false)}
      />
      <AutoSaveDialog
        open={isAutoSaveDialogOpen}
        onClose={() => setIsAutoSaveDialogOpen(false)}
      />
    </>
  )
}
