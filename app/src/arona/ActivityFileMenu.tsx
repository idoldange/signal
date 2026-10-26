import { useTheme } from "@emotion/react"
import { Menu, MenuDivider, MenuItem, SubMenu } from "@signal-app/ui"
import ChevronRight from "mdi-react/ChevronRightIcon"
import KeyboardArrowDown from "mdi-react/KeyboardArrowDownIcon"
import { useToast, useProgress } from "dialog-hooks"
import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useSetSong } from "../actions"
import { songFromFile } from "../actions/file"
import { useSong } from "../hooks/useSong"
import { useStores } from "../hooks/useStores"
import { type ActivityExportMode, exportActivitySong } from "./activityExport"
import {
  fetchActivityProjects,
  fetchLatestSave,
  openActivityFile,
} from "./activityImport"
import { saveSongToChannel, type ActivityProject } from "./activityApi"
import { loadProjectFonts } from "./activityFonts"
import { projectToSong } from "./projectToSong"
import { getVocalTrackIds } from "./vocalTrack"
import { Tab } from "../components/Navigation/Navigation"

const AUDIO_EXT =
  /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|wma|aiff?|webm|mp4|mkv|mov)$/i

// Extensions only: MIME types (audio/midi, audio/wav...) expand into extensions already listed
// and show up twice in the file dialog.
const ACCEPT = [
  ".mid",
  ".midi",
  ".ust",
  ".ustx",
  ".wav",
  ".mp3",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".m4a",
  ".aac",
  ".wma",
  ".aif",
  ".aiff",
  ".webm",
  ".mp4",
  ".mkv",
  ".mov",
].join(",")

const isAudioFile = (file: File) =>
  !/\.(midi?|ustx?)$/i.test(file.name) &&
  (file.type.startsWith("audio/") || AUDIO_EXT.test(file.name))

export const ActivityFileMenu: FC = () => {
  const theme = useTheme()
  const toast = useToast()
  const { show: showProgress } = useProgress()
  const { getSong } = useSong()
  const setSong = useSetSong()
  const { synth, vocalService, backingTracks } = useStores()
  const backing = useSyncExternalStore(
    backingTracks.subscribe,
    backingTracks.getSnapshot,
  )
  const [isOpen, setOpen] = useState(false)
  const [projects, setProjects] = useState<ActivityProject[] | null>(null)
  const [vocal, setVocal] = useState(() => vocalService.isEnabled)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let cancelled = false
    fetchActivityProjects()
      .then((items) => {
        if (!cancelled) {
          setProjects(items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const onSave = useCallback(async () => {
    if (busy) {
      return
    }
    setBusy(true)
    const close = showProgress("Saving to channel...")
    try {
      const song = getSong()
      // Autosave de "Open latest autosave" van hoat dong, roi dang project len kenh:
      // co loi hat -> .ustx, nhac cu -> .mid.
      await saveSongToChannel(song)
      song.isSaved = true
      const result = await exportActivitySong("ustx", song, {
        soundFontData: synth.loadedSoundFont?.data,
        vocalService,
        withVocals: vocal,
        backingTracks: backingTracks.getSnapshot(),
      })
      toast.success(`Saved to channel: ${result.files.join(", ")}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      close()
      setBusy(false)
    }
  }, [
    backingTracks,
    busy,
    getSong,
    showProgress,
    synth,
    toast,
    vocal,
    vocalService,
  ])

  const onOpenLatest = useCallback(async () => {
    try {
      const latest = await fetchLatestSave()
      if (latest === null) {
        toast.error("No autosave for this voice channel yet")
        return
      }
      setSong(latest.song)
      toast.success(`Opened ${latest.name || "the latest take"}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [setSong, toast])

  const onOpenProject = useCallback(
    async (project: ActivityProject) => {
      try {
        await synth.setup()
        const fonts = await loadProjectFonts(synth, project)
        setSong(projectToSong(project, fonts))
        toast.success(`Opened ${project.name}`)
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [setSong, synth, toast],
  )

  const onExport = useCallback(
    async (mode: ActivityExportMode) => {
      if (busy) {
        return
      }
      setBusy(true)
      const close = showProgress(
        mode === "ustx" ? "Writing the USTX project..." : "Rendering audio...",
      )
      try {
        const result = await exportActivitySong(mode, getSong(), {
          soundFontData: synth.loadedSoundFont?.data,
          vocalService,
          withVocals: vocal,
          backingTracks: backingTracks.getSnapshot(),
        })
        toast.success(`Sent to Discord: ${result.files.join(", ")}`)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        close()
        setBusy(false)
      }
    },
    [
      backingTracks,
      busy,
      getSong,
      showProgress,
      synth,
      toast,
      vocal,
      vocalService,
    ],
  )

  // The picker is a plain <input type="file">: the File System Access API is not available
  // inside the Discord iframe, but the classic input works there.
  const onImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) {
        return
      }
      try {
        if (isAudioFile(file)) {
          await backingTracks.importFile(file)
          toast.success(`Added audio track ${file.name}`)
          return
        }
        if (/\.midi?$/i.test(file.name)) {
          setSong(await songFromFile(file))
          toast.success(`Opened ${file.name}`)
          return
        }
        if (/\.ustx?$/i.test(file.name)) {
          const name = await openActivityFile(file, setSong, synth)
          toast.success(`Opened ${name}`)
          return
        }
        toast.error(
          "Supported files: MIDI, UST, USTX and audio (WAV, MP3, OGG, FLAC, M4A...)",
        )
      } catch (err) {
        toast.error(`Could not read ${file.name}: ${(err as Error).message}`)
      }
    },
    [backingTracks, setSong, synth, toast],
  )

  const onToggleVocal = useCallback(() => {
    const next = !vocal
    vocalService.setEnabled(next)
    setVocal(next)
  }, [vocal, vocalService])

  // Cung quy tac voi file gui len: co track hat -> USTX, nhac cu -> MIDI.
  const projectFormat = getVocalTrackIds(getSong()).size > 0 ? "USTX" : "MIDI"

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: "none" }}
        onChange={onImportFile}
      />
      <Menu
        open={isOpen}
        onOpenChange={setOpen}
        trigger={
          <Tab id="tab-file">
            <span style={{ marginLeft: "0.25rem" }}>File</span>
            <KeyboardArrowDown
              style={{ width: "1rem", marginLeft: "0.25rem" }}
            />
          </Tab>
        }
      >
        <MenuItem onClick={onSave}>
          Save to channel
          <span style={{ marginLeft: "auto", opacity: 0.5 }}>Ctrl+S</span>
        </MenuItem>

        <MenuItem onClick={onOpenLatest}>Open latest autosave</MenuItem>

        <MenuItem onClick={onImportClick}>
          Import from computer (MIDI, UST, USTX, audio)
        </MenuItem>

        {backing.map((track) => (
          <MenuItem
            key={track.id}
            onClick={() => backingTracks.remove(track.id)}
          >
            Remove audio: {track.name}
          </MenuItem>
        ))}

        {projects !== null && projects.length > 0 && (
          <SubMenu
            trigger={
              <MenuItem>
                Open from panel
                <ChevronRight
                  style={{ marginLeft: "auto", fill: theme.tertiaryTextColor }}
                />
              </MenuItem>
            }
          >
            {projects.slice(0, 10).map((project, index) => (
              <MenuItem
                key={`${project.name}-${index}`}
                onClick={() => onOpenProject(project)}
              >
                {project.name}
              </MenuItem>
            ))}
          </SubMenu>
        )}

        <MenuDivider />

        <SubMenu
          trigger={
            <MenuItem>
              Export to Discord
              <ChevronRight
                style={{ marginLeft: "auto", fill: theme.tertiaryTextColor }}
              />
            </MenuItem>
          }
        >
          <MenuItem onClick={() => onExport("audio+ustx")}>
            Audio + {projectFormat} project
          </MenuItem>
          <MenuItem onClick={() => onExport("audio")}>Audio (WAV)</MenuItem>
          <MenuItem onClick={() => onExport("ustx")}>
            {projectFormat} project
          </MenuItem>
        </SubMenu>

        <MenuDivider />

        <MenuItem onClick={onToggleVocal}>
          {vocal ? "✓ Sing with Arona" : "Sing with Arona"}
        </MenuItem>
      </Menu>
    </>
  )
}
