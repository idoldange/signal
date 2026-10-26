import { samplePitch, segmentY } from "@signal-app/core"
import { useAtomValue } from "jotai"
import { type FC, useEffect, useRef } from "react"
import { useTickScroll } from "../../../../hooks/useTickScroll"
import { useKeyScroll } from "../../hooks/useKeyScroll"
import { usePianoRoll } from "../../hooks/usePianoRoll"
import { usePitchNotes } from "../../hooks/usePitchNotes"
import { vibratoCents, vibratoHandles, vibratoSpan } from "../../entities/vibrato"
import { pitchTipAtom } from "../../hooks/usePitchTool"

export interface PitchCurvesProps {
  width: number
  height: number
}

const CURVE_COLOR = "#ff9f43"
const OFFSET_COLOR = "#4dd0e1"
const VIBRATO_COLOR = "#ff6b9d"
const HANDLE_RADIUS = 4

// Pitch bend curves are drawn on a 2D canvas over the WebGL piano roll (like the lyrics).
// With the pitch tool every note shows its control points; with the other tools only the
// curves of notes that have a pitch bend are shown, so they are never hidden.
export const PitchCurves: FC<PitchCurvesProps> = ({ width, height }) => {
  const { mouseMode } = usePianoRoll()
  const { entries, geometry } = usePitchNotes()
  const { scrollLeft } = useTickScroll()
  const { scrollTop } = useKeyScroll()
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1
  const editing = mouseMode === "pitch"
  const tip = useAtomValue(pitchTipAtom)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) {
      return
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.lineJoin = "round"
    ctx.lineCap = "round"

    for (const entry of entries) {
      if (!editing && !entry.stored) {
        continue
      }
      const points = entry.points.map((point) => {
        const p = geometry.pointToPixel(entry.note, entry.startMs, point)
        return { x: p.x - scrollLeft, y: p.y - scrollTop, shape: point.shape }
      })
      const first = points[0]
      const last = points[points.length - 1]
      if (first === undefined || last.x < -20 || first.x > width + 20) {
        continue
      }

      // the curve is flat before the first and after the last point
      ctx.globalAlpha = entry.stored ? 1 : 0.5
      ctx.strokeStyle = CURVE_COLOR
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]
        const b = points[i + 1]
        const steps = Math.max(2, Math.min(40, Math.ceil((b.x - a.x) / 4)))
        for (let s = 1; s <= steps; s++) {
          const u = s / steps
          ctx.lineTo(a.x + (b.x - a.x) * u, segmentY(points, i, u))
        }
      }
      ctx.stroke()

      const off = entry.pitch.pitd
      if (entry.stored && off !== undefined && off.length > 1) {
        const curve = { ...entry.pitch, points: entry.points }
        ctx.strokeStyle = OFFSET_COLOR
        ctx.lineWidth = 2
        ctx.beginPath()
        off.forEach((o, i) => {
          const p = geometry.pointToPixel(entry.note, entry.startMs, {
            x: o.x,
            y: samplePitch(curve, o.x) + o.y,
          })
          if (i === 0) {
            ctx.moveTo(p.x - scrollLeft, p.y - scrollTop)
          } else {
            ctx.lineTo(p.x - scrollLeft, p.y - scrollTop)
          }
        })
        ctx.stroke()
      }
      const vib = entry.pitch.vibrato
      if (entry.stored && vib !== undefined) {
        const noteMs = entry.endMs - entry.startMs
        const { startMs, lenMs } = vibratoSpan(vib, noteMs)
        const curve = { ...entry.pitch, points: entry.points }
        const steps = Math.max(8, Math.min(200, Math.ceil((lenMs / vib.period) * 12)))
        ctx.strokeStyle = VIBRATO_COLOR
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let s = 0; s <= steps; s++) {
          const x = startMs + (lenMs * s) / steps
          const y = samplePitch(curve, x) + vibratoCents(vib, noteMs, x) / 10
          const p = geometry.pointToPixel(entry.note, entry.startMs, { x, y })
          if (s === 0) {
            ctx.moveTo(p.x - scrollLeft, p.y - scrollTop)
          } else {
            ctx.lineTo(p.x - scrollLeft, p.y - scrollTop)
          }
        }
        ctx.stroke()
        if (editing) {
          for (const h of vibratoHandles(curve, noteMs)) {
            const p = geometry.pointToPixel(entry.note, entry.startMs, h)
            ctx.fillStyle = VIBRATO_COLOR
            ctx.fillRect(p.x - scrollLeft - 4, p.y - scrollTop - 4, 8, 8)
          }
        }
      }
      if (!editing) {
        continue
      }
      const locked = entry.pitch.snapFirst
      points.forEach((p, index) => {
        if (p.x < -10 || p.x > width + 10) {
          return
        }
        ctx.beginPath()
        ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2)
        // the first point of a "snap first" note follows the previous note (only x can move)
        ctx.fillStyle = locked && index === 0 ? CURVE_COLOR : "#ffffff"
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = CURVE_COLOR
        ctx.stroke()
      })
    }
    ctx.globalAlpha = 1
    if (tip !== null) {
      const x = tip.x - scrollLeft + 12
      const y = tip.y - scrollTop - 12
      ctx.font = "12px sans-serif"
      ctx.textBaseline = "middle"
      const w = ctx.measureText(tip.text).width + 10
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)"
      ctx.fillRect(x, y - 10, w, 20)
      ctx.fillStyle = "#fff"
      ctx.fillText(tip.text, x + 5, y)
    }
  }, [entries, geometry, editing, tip, scrollLeft, scrollTop, width, height, dpr])

  return (
    <canvas
      ref={ref}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  )
}
