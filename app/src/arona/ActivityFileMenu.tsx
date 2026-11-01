import { useTheme } from "@emotion/react"
import { Menu, MenuDivider, MenuItem, SubMenu } from "@signal-app/ui"
import { useProgress, useToast } from "dialog-hooks"
import ChevronRight from "mdi-react/ChevronRightIcon"
import KeyboardArrowDown from "mdi-react/KeyboardArrowDownIcon"
import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useCreateSong, useSetSong } from "../actions"
import { songFromFile } from "../actions/file"
import { Tab } from "../components/Navigation/Navigation"
import { useSong } from "../hooks/useSong"
import { useStores } from "../hooks/useStores"
import { useTrackMute } from "../hooks/useTrackMute"
import { type ActivityProject, saveSongToChannel } from "./activityApi"
import { type ActivityExportMode, exportActivitySong } from "./activityExport"
import { loadProjectFonts } from "./activityFonts"
import {
  fetchActivityProjects,
  fetchLatestSave,
  fetchSave,
  fetchSaveList,
  openActivityFile,
  type SaveEntry,
} from "./activityImport"
import { projectToSong } from "./projectToSong"
import {
  getVocalTrackIds,
  VOCAL_LANG_LABELS,
  VOCAL_LANGS,
  vocalLanguage,
  vocalTrackFlags,
} from "./vocalTrack"

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
  const createSong = useCreateSong()
  const { synth, vocalService, backingTracks } = useStores()
  const { trackMute } = useTrackMute()
  const backing = useSyncExternalStore(
    backingTracks.subscribe,
    backingTracks.getSnapshot,
  )
  const [isOpen, setOpen] = useState(false)
  const [projects, setProjects] = useState<ActivityProject[] | null>(null)
  const [recents, setRecents] = useState<SaveEntry[]>([])
  const projectLang = useSyncExternalStore(vocalTrackFlags.subscribe, () =>
    vocalLanguage.ofSong(getSong()),
  )
  const [vocal, setVocal] = useState(() => vocalService.isEnabled)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let cancelled = false
    fetchSaveList()
      .then((items) => {
        if (!cancelled) {
          setRecents(items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecents([])
        }
      })
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
        trackMute,
        attachBacking: true,
      })
      toast.success(`Saved to channel: ${result.files.join(", ")}`)
      if (result.skipped !== undefined && result.skipped.length > 0) {
        toast.error(
          `Too big for this server, not sent: ${result.skipped.join(", ")}`,
        )
      }
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
    trackMute,
    vocal,
    vocalService,
  ])

  // Ctrl/Cmd+S saves to the channel (never the browser's download of the page)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault()
        void onSave()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onSave])

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

  const onOpenRecent = useCallback(
    async (id: string) => {
      try {
        const save = await fetchSave(id)
        setSong(save.song)
        toast.success(`Opened ${save.name || "the project"}`)
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [setSong, toast],
  )

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
          trackMute,
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
      trackMute,
      vocal,
      vocalService,
    ],
  )

  // The picker is a plain <input type="file">: the File System Access API is not available
  // inside the Discord iframe, but the classic input works there.
  const onImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // Opens ONE project file (MIDI / UST / USTX): it replaces the song. The bot classifies the
  // tracks (vocal / instrument / drums) and resolves their soundfonts, so a MIDI opened here
  // behaves like one from the `!arona synth` panel; only if the bot cannot read it is a MIDI
  // opened as a plain one.
  const openProjectFile = useCallback(
    async (file: File) => {
      if (/\.midi?$/i.test(file.name)) {
        try {
          return await openActivityFile(file, setSong, synth)
        } catch (err) {
          console.warn("[arona] bot import failed, opening as plain MIDI", err)
          setSong(await songFromFile(file))
          return file.name
        }
      }
      return await openActivityFile(file, setSong, synth)
    },
    [setSong, synth],
  )

  // The picker allows several files at once: every audio file becomes an audio track, and of
  // the project files (a project replaces the song) the first one is opened.
  const onImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ""
      if (files.length === 0) {
        return
      }
      const isProject = (file: File) => /\.(midi?|ustx?)$/i.test(file.name)
      const projects = files.filter(isProject)
      const audio = files.filter(isAudioFile)
      const unsupported = files.filter(
        (file) => !isProject(file) && !isAudioFile(file),
      )
      const messages: string[] = []
      const errors: string[] = []

      if (projects.length > 0) {
        try {
          messages.push(`Opened ${await openProjectFile(projects[0])}`)
        } catch (err) {
          errors.push(
            `Could not read ${projects[0].name}: ${(err as Error).message}`,
          )
        }
        if (projects.length > 1) {
          errors.push(
            `Only one project can be open: skipped ${projects
              .slice(1)
              .map((file) => file.name)
              .join(", ")}`,
          )
        }
      }

      // one after the other: decoding several long files at once needs a lot of memory
      let added = 0
      for (const file of audio) {
        try {
          await backingTracks.importFile(file)
          added += 1
        } catch (err) {
          errors.push(`Could not read ${file.name}: ${(err as Error).message}`)
        }
      }
      if (added > 0) {
        messages.push(
          added === 1
            ? `Added audio track ${audio[0].name}`
            : `Added ${added} audio tracks`,
        )
      }

      if (unsupported.length > 0) {
        errors.push(
          `Supported files: MIDI, UST, USTX and audio (WAV, MP3, OGG, FLAC, M4A...); skipped ${unsupported
            .map((file) => file.name)
            .join(", ")}`,
        )
      }
      if (messages.length > 0) {
        toast.success(messages.join(" · "))
      }
      if (errors.length > 0) {
        toast.error(errors.join(" · "))
      }
    },
    [backingTracks, openProjectFile, toast],
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
        multiple
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
        {/* No confirm(): dialogs can be blocked in the Discord iframe. The current song is
            autosaved first (see "Open latest autosave"); audio tracks are cleared with it. */}
        <MenuItem onClick={createSong}>New project</MenuItem>

        <MenuDivider />

        <MenuItem onClick={onSave}>
          Save to channel
          <span style={{ marginLeft: "auto", opacity: 0.5 }}>Ctrl+S</span>
        </MenuItem>

        <SubMenu
          trigger={
            <MenuItem>
              Recents
              <ChevronRight
                style={{ marginLeft: "auto", fill: theme.tertiaryTextColor }}
              />
            </MenuItem>
          }
        >
          {recents.length === 0 && (
            <MenuItem disabled>No recent projects in this channel</MenuItem>
          )}
          {recents.map((entry) => (
            <MenuItem key={entry.id} onClick={() => onOpenRecent(entry.id)}>
              {entry.name || "Untitled"}
              <span
                style={{
                  marginLeft: "auto",
                  paddingLeft: "1rem",
                  opacity: 0.5,
                }}
              >
                {new Date(entry.saved_at).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </MenuItem>
          ))}
        </SubMenu>

        <MenuItem onClick={onOpenLatest}>Open latest autosave</MenuItem>

        <SubMenu
          trigger={
            <MenuItem>
              Vocal language:{" "}
              {projectLang ? VOCAL_LANG_LABELS[projectLang] : "Auto"}
              <ChevronRight
                style={{ marginLeft: "auto", fill: theme.tertiaryTextColor }}
              />
            </MenuItem>
          }
        >
          <MenuItem onClick={() => vocalLanguage.setSong(getSong(), null)}>
            {projectLang === null ? "✓ " : ""}Auto (detect from the lyrics)
          </MenuItem>
          {VOCAL_LANGS.map((lang) => (
            <MenuItem
              key={lang}
              onClick={() => vocalLanguage.setSong(getSong(), lang)}
            >
              {projectLang === lang ? "✓ " : ""}
              {VOCAL_LANG_LABELS[lang]}
            </MenuItem>
          ))}
        </SubMenu>

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
