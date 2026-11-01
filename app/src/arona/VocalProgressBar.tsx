import styled from "@emotion/styled"
import {
  type FC,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useStores } from "../hooks/useStores"

const DONE_VISIBLE_MS = 2500

const Bar = styled.div`
  position: relative;
  flex-shrink: 0;
  height: 1.5rem;
  display: flex;
  align-items: center;
  padding: 0 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text);
  background: var(--color-background-secondary);
  border-top: 1px solid var(--color-divider);
  overflow: hidden;
`

const Fill = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--color-theme);
  opacity: 0.3;
  transition: width 0.3s ease;

  &[data-error="true"] {
    background: #e53935;
  }

  &[data-indeterminate="true"] {
    width: 30%;
    animation: arona-vocal-slide 1.2s ease-in-out infinite alternate;
  }

  @keyframes arona-vocal-slide {
    from {
      left: 0;
    }
    to {
      left: 70%;
    }
  }
`

const Text = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

const Retry = styled.div`
  position: relative;
  flex-shrink: 0;
  margin-left: 0.5rem;
  padding: 0 0.5rem;
  border: 1px solid var(--color-divider);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: var(--color-highlight);
  }
`

// Progress of the Arona vocal synthesis, shown right under the editor: how many phrases
// of the song are ready, so the user knows when it is safe to press play or export.
export const VocalProgressBar: FC = () => {
  const { vocalService } = useStores()
  const progress = useSyncExternalStore(
    vocalService.subscribeProgress,
    vocalService.getProgress,
  )
  // "done" is only shown (briefly) after something was actually generated, so opening a
  // song whose phrases are all cached does not flash a message.
  const wasBusy = useRef(false)
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    if (progress.phase === "planning" || progress.phase === "generating") {
      wasBusy.current = true
      setShowDone(false)
      return undefined
    }
    if (progress.phase === "done" && wasBusy.current) {
      wasBusy.current = false
      setShowDone(true)
      const timer = window.setTimeout(() => setShowDone(false), DONE_VISIBLE_MS)
      return () => window.clearTimeout(timer)
    }
    setShowDone(false)
    return undefined
  }, [progress.phase])

  const { phase, total, done, failed, error } = progress
  if (phase === "idle" || (phase === "done" && !showDone)) {
    return null
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  let text: string
  switch (phase) {
    case "planning":
      text = "Arona vocal: preparing…"
      break
    case "generating":
      text = `Arona vocal: synthesizing phrase ${Math.min(done + 1, total)}/${total} (${percent}%)${
        failed > 0 ? ` · ${failed} failed` : ""
      }`
      break
    case "done":
      text = `Arona vocal ready (${total} phrases)`
      break
    default:
      text =
        failed > 0
          ? `Arona vocal: ${failed} of ${total} phrase(s) failed — ${error ?? "unknown error"}`
          : `Arona vocal failed — ${error ?? "unknown error"}`
  }

  return (
    <Bar title={error}>
      <Fill
        data-error={phase === "error"}
        data-indeterminate={phase === "planning"}
        style={
          phase === "planning"
            ? undefined
            : { width: `${phase === "error" ? 100 : percent}%` }
        }
      />
      <Text>{text}</Text>
      {phase === "error" && (
        <Retry onMouseDown={() => vocalService.retry()}>Retry</Retry>
      )}
    </Bar>
  )
}
