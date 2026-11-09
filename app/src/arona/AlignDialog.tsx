import styled from "@emotion/styled"
import { isNoteEvent, type NoteEvent } from "@signal-app/core"
import { useToast } from "dialog-hooks"
import {
  type FC,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useHistory } from "../hooks/useHistory"
import { useSong } from "../hooks/useSong"
import { TrackMute } from "../trackMute/TrackMute"
import { type AlignPhrase, fetchAlignView } from "./activityApi"
import { alignStore } from "./alignStore"
import { buildVocalBodies } from "./vocal"
import { withNudge } from "./vocalTrack"

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
`

const Panel = styled.div`
  width: min(52rem, 94vw);
  max-height: 90vh;
  overflow: auto;
  padding: 1rem;
  background: var(--color-background);
  color: var(--color-text);
  border: 1px solid var(--color-divider);
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.8rem;
`

const Row = styled.div`
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
`

const Btn = styled.button`
  padding: 0.3rem 0.8rem;
  color: var(--color-text);
  background: var(--color-background-secondary);
  border: 1px solid var(--color-divider);
  border-radius: 0.25rem;
  cursor: pointer;
`

const RULER = 18
const LABELS = 24
const H = 160
const GRAB_PX = 10

const decode = async (ctx: AudioContext, b64: string) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return await ctx.decodeAudioData(bytes.buffer)
}

type Drag = { kind: "marker"; i: number } | { kind: "head"; resume: boolean }

// One phrase: the raw voice as a waveform. Colored bands = syllables (their text is written at the
// bottom). Drag an orange line to move where a syllable starts. The red line is the play head:
// drag the ruler (or click the waveform) to scrub, Play / Pause to listen from there.
const PhraseView: FC<{
  phrase: AlignPhrase
  buffer: AudioBuffer
  positions: number[]
  getCtx: () => AudioContext
  onChange: (positions: number[]) => void
}> = ({ phrase, buffer, positions, getCtx, onChange }) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const src = useRef<AudioBufferSourceNode | null>(null)
  const startedAt = useRef(0)
  const startedMs = useRef(0)
  const headRef = useRef(0)
  const raf = useRef(0)
  const [width, setWidth] = useState(800)
  const [headMs, setHeadMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const dur = phrase.dur_ms
  const endMs = phrase.end_ms ?? dur

  useEffect(() => {
    const el = wrap.current
    if (el) {
      setWidth(Math.max(200, Math.floor(el.clientWidth)))
    }
  }, [])

  const stopSource = () => {
    cancelAnimationFrame(raf.current)
    const s = src.current
    if (s) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // already stopped
      }
      s.disconnect()
      src.current = null
    }
  }

  useEffect(() => () => stopSource(), [])

  const nowMs = () =>
    Math.min(
      dur,
      startedMs.current + (getCtx().currentTime - startedAt.current) * 1000,
    )

  const tick = () => {
    const ms = nowMs()
    headRef.current = ms
    setHeadMs(ms)
    if (ms >= dur) {
      stopSource()
      setPlaying(false)
      return
    }
    raf.current = requestAnimationFrame(tick)
  }

  const play = (fromMs: number) => {
    stopSource()
    const ctx = getCtx()
    void ctx.resume()
    const from = fromMs >= dur - 20 ? 0 : fromMs
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.connect(ctx.destination)
    s.start(0, from / 1000)
    src.current = s
    startedAt.current = ctx.currentTime
    startedMs.current = from
    setPlaying(true)
    raf.current = requestAnimationFrame(tick)
  }

  const pause = () => {
    const ms = nowMs()
    stopSource()
    headRef.current = ms
    setHeadMs(ms)
    setPlaying(false)
  }

  const rewind = () => {
    stopSource()
    setPlaying(false)
    headRef.current = 0
    setHeadMs(0)
  }

  const segmentAt = (ms: number) => {
    let found = -1
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] <= ms) {
        found = i
      }
    }
    return found
  }
  const current = segmentAt(headMs)

  useEffect(() => {
    const c = canvas.current
    const g = c?.getContext("2d")
    if (!c || !g) {
      return
    }
    const fg =
      getComputedStyle(c).getPropertyValue("--color-text").trim() || "#ddd"
    const px = (ms: number) => (ms / dur) * width
    g.clearRect(0, 0, width, H)

    // syllable bands + their text
    g.font = "bold 13px sans-serif"
    g.textAlign = "center"
    positions.forEach((pos, i) => {
      const x0 = px(pos)
      const x1 = px(i + 1 < positions.length ? positions[i + 1] : endMs)
      const active = i === current
      g.fillStyle = active
        ? "rgba(255,159,28,0.28)"
        : i % 2 === 0
          ? "rgba(255,159,28,0.08)"
          : "rgba(80,160,255,0.10)"
      g.fillRect(x0, RULER, Math.max(1, x1 - x0), H - RULER)
      g.fillStyle = fg
      g.fillText(
        phrase.groups[i].text || "~",
        (x0 + x1) / 2,
        H - 7,
        Math.max(10, x1 - x0 - 4),
      )
    })

    // waveform
    const top = RULER + 4
    const bottom = H - LABELS
    const mid = (top + bottom) / 2
    const half = (bottom - top) / 2
    const data = buffer.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / width))
    g.fillStyle = "rgba(120,160,255,0.9)"
    for (let x = 0; x < width; x++) {
      let peak = 0
      for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i++) {
        peak = Math.max(peak, Math.abs(data[i]))
      }
      const h = peak * half
      g.fillRect(x, mid - h, 1, Math.max(1, 2 * h))
    }

    // ruler
    g.fillStyle = "rgba(128,128,128,0.2)"
    g.fillRect(0, 0, width, RULER)
    g.font = "10px sans-serif"
    g.textAlign = "left"
    for (let ms = 0; ms <= dur; ms += 100) {
      const x = px(ms)
      const big = ms % 500 === 0
      g.fillStyle = "rgba(160,160,160,0.9)"
      g.fillRect(x, big ? 8 : 12, 1, big ? 10 : 6)
      if (big) {
        g.fillStyle = fg
        g.fillText(`${(ms / 1000).toFixed(1)}s`, x + 3, 9)
      }
    }

    // syllable start markers (the first one is fixed)
    positions.forEach((pos, i) => {
      const x = px(pos)
      g.strokeStyle = i === 0 ? "rgba(150,150,150,0.9)" : "#ff9f1c"
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(x, RULER)
      g.lineTo(x, H)
      g.stroke()
      if (i > 0) {
        g.fillStyle = "#ff9f1c"
        g.beginPath()
        g.arc(x, RULER + 9, 5, 0, Math.PI * 2)
        g.fill()
      }
    })

    // play head
    const hx = px(headMs)
    g.strokeStyle = "#ff3b3b"
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(hx, 0)
    g.lineTo(hx, H)
    g.stroke()
    g.fillStyle = "#ff3b3b"
    g.beginPath()
    g.moveTo(hx - 6, 0)
    g.lineTo(hx + 6, 0)
    g.lineTo(hx, 9)
    g.fill()
  }, [buffer, phrase, positions, width, dur, endMs, headMs, current])

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      ms: Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur)),
      y: e.clientY - r.top,
      pxPerMs: r.width / dur,
    }
  }

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const { ms, y, pxPerMs } = point(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (y >= RULER) {
      let best = -1
      let bestD = GRAB_PX
      for (let i = 1; i < positions.length; i++) {
        const d = Math.abs(positions[i] - ms) * pxPerMs
        if (d <= bestD) {
          best = i
          bestD = d
        }
      }
      if (best >= 0) {
        drag.current = { kind: "marker", i: best }
        return
      }
    }
    // ruler or empty waveform: move the play head
    drag.current = { kind: "head", resume: playing }
    if (playing) {
      pause()
    }
    headRef.current = ms
    setHeadMs(ms)
  }

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (d === null) {
      return
    }
    const { ms } = point(e)
    if (d.kind === "head") {
      headRef.current = ms
      setHeadMs(ms)
      return
    }
    // Drag freely between the neighbouring markers (20 ms gap, same as the server), no matter
    // how far the automatic boundary was off. The old +-MAX_NUDGE_MS clamp made markers that
    // the detector put too far out impossible to correct by hand.
    const i = d.i
    const lo = Math.max(0, positions[i - 1] + 20)
    const hi = Math.min(dur, (positions[i + 1] ?? endMs) - 20)
    if (hi < lo) {
      return
    }
    const next = positions.slice()
    next[i] = Math.min(hi, Math.max(lo, ms))
    onChange(next)
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === "head" && d.resume) {
      play(headRef.current)
    }
  }

  return (
    <div ref={wrap}>
      <canvas
        ref={canvas}
        width={width}
        height={H}
        style={{
          width: "100%",
          height: H,
          touchAction: "none",
          cursor: "pointer",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      />
      <Row
        style={{
          justifyContent: "flex-start",
          alignItems: "center",
          marginTop: "0.4rem",
        }}
      >
        <Btn onClick={() => (playing ? pause() : play(headMs))}>
          {playing ? "Pause" : "Play"}
        </Btn>
        <Btn onClick={rewind}>Back to start</Btn>
        <Btn
          onClick={() => onChange(phrase.groups.map((g) => g.start_ms))}
          title="Put every marker back where the automatic alignment found it"
        >
          Reset to auto
        </Btn>
        <span>
          {(headMs / 1000).toFixed(2)} / {(dur / 1000).toFixed(2)} s
          {current >= 0 && `  -  now: ${phrase.groups[current].text || "~"}`}
        </span>
      </Row>
    </div>
  )
}

export const AlignDialog: FC = () => {
  const target = useSyncExternalStore(alignStore.subscribe, alignStore.get)
  const toast = useToast()
  const { getSong, getTrack } = useSong()
  const { pushHistory } = useHistory()
  const [phrases, setPhrases] = useState<AlignPhrase[] | null>(null)
  const [buffers, setBuffers] = useState<AudioBuffer[]>([])
  const [positions, setPositions] = useState<number[][]>([])
  const [error, setError] = useState<string | null>(null)
  const ctx = useRef<AudioContext | null>(null)

  const getCtx = useCallback(() => {
    ctx.current ??= new AudioContext()
    return ctx.current
  }, [])

  const close = useCallback(() => {
    alignStore.close()
  }, [])

  useEffect(() => {
    setPhrases(null)
    setError(null)
    if (target === null) {
      return
    }
    let cancelled = false
    ;(async () => {
      const body = buildVocalBodies(getSong(), TrackMute.empty).find(
        (b) => b.trackId === target.trackId,
      )
      if (!body) {
        throw new Error("This track has nothing to sing")
      }
      const info = await fetchAlignView({ ...body.body, at: target.tick })
      const bufs = await Promise.all(
        info.phrases.map((p) => decode(getCtx(), p.wav)),
      )
      if (!cancelled) {
        setBuffers(bufs)
        setPositions(
          info.phrases.map((p) => p.groups.map((g) => g.start_ms + g.nudge)),
        )
        setPhrases(info.phrases)
      }
    })().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
    return () => {
      cancelled = true
    }
  }, [target, getSong, getCtx])

  const apply = () => {
    const track = target ? getTrack(target.trackId) : undefined
    if (!track || !phrases) {
      return
    }
    const updates: NoteEvent[] = []
    phrases.forEach((p, pi) => {
      p.groups.forEach((g, gi) => {
        if (gi === 0 || g.pos === null) {
          return
        }
        const nudge = Math.round(positions[pi][gi] - g.start_ms)
        const ev = track.events.find(
          (e) => isNoteEvent(e) && e.tick === g.pos,
        ) as NoteEvent | undefined
        if (ev) {
          updates.push({ ...ev, lyric: withNudge(ev.lyric ?? "", nudge) })
        }
      })
    })
    if (updates.length > 0) {
      pushHistory()
      track.updateEvents(updates)
      toast.success(`Aligned ${updates.length} syllable(s)`)
    }
    close()
  }

  if (target === null) {
    return null
  }
  return (
    <Overlay onMouseDown={(e) => e.stopPropagation()}>
      <Panel>
        <b>Align syllables on the waveform</b>
        <span>
          Each colored band is one syllable (its text is at the bottom). Press
          Play and watch the red line: if a syllable starts earlier or later
          than its orange line, drag the orange dot to where it really starts.
          Drag the ruler (or click the waveform) to move the red line, then Play
          again. Press Apply when it sounds right.
        </span>
        {error !== null && <span>Failed: {error}</span>}
        {error === null && phrases === null && <span>Generating…</span>}
        {phrases?.map((p, i) => (
          <div key={`${p.dur_ms}-${i}`}>
            {p.aligned ? (
              <PhraseView
                phrase={p}
                buffer={buffers[i]}
                positions={positions[i]}
                getCtx={getCtx}
                onChange={(next) =>
                  setPositions((all) => all.map((a, k) => (k === i ? next : a)))
                }
              />
            ) : (
              <span>
                This phrase is stretched evenly (syllable count does not match
                the notes), so there is nothing to align.
              </span>
            )}
          </div>
        ))}
        <Row>
          <Btn onClick={close}>Cancel</Btn>
          <Btn onClick={apply} disabled={phrases === null}>
            Apply
          </Btn>
        </Row>
      </Panel>
    </Overlay>
  )
}
