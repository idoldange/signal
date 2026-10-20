import { ActionDialog, ProgressDialog, PromptDialog } from "@signal-app/ui"
import {
  DialogProvider,
  ProgressProvider,
  PromptProvider,
  ToastProvider,
} from "dialog-hooks"
import React from "react"
import { HelmetProvider } from "react-helmet-async"
import { ArrangeViewProvider } from "../../features/arrange/hooks/useArrangeView"
import { MIDIDeviceProvider } from "../../features/midi-device/hooks/useMIDIDevice"
import { PianoRollProvider } from "../../features/piano-roll/context/PianoRollProvider"
import { TempoEditorProvider } from "../../features/tempo-editor/context/TempoEditorProvider"
import { StoreContext } from "../../hooks/useStores"
import { TrackMuteProvider } from "../../hooks/useTrackMute"
import RootStore from "../../stores/RootStore"
import { ThemeProvider } from "../../theme/ThemeProvider"
import { RootView } from "../RootView/RootView"
import { GlobalCSS } from "../Theme/GlobalCSS"
import { Toast } from "../ui/Toast"
import { LocalizationProvider } from "./LocalizationProvider"

const rootStore = new RootStore()

export function App() {
  return (
    <React.StrictMode>
      <StoreContext.Provider value={rootStore}>
        <ThemeProvider>
          <HelmetProvider>
            <ToastProvider component={Toast}>
              <PromptProvider component={PromptDialog}>
                <DialogProvider component={ActionDialog}>
                  <ProgressProvider component={ProgressDialog}>
                    <LocalizationProvider>
                        <MIDIDeviceProvider>
                          <TrackMuteProvider>
                            <PianoRollProvider>
                              <ArrangeViewProvider>
                                <TempoEditorProvider>
                                  <GlobalCSS />
                                  <RootView />
                                </TempoEditorProvider>
                              </ArrangeViewProvider>
                            </PianoRollProvider>
                          </TrackMuteProvider>
                        </MIDIDeviceProvider>
                    </LocalizationProvider>
                  </ProgressProvider>
                </DialogProvider>
              </PromptProvider>
            </ToastProvider>
          </HelmetProvider>
        </ThemeProvider>
      </StoreContext.Provider>
    </React.StrictMode>
  )
}
