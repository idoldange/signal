import { type NotePitch, samplePitch } from "@signal-app/core"
import { Point } from "@signal-app/geometry"
import { useAtomValue, useSetAtom } from "jotai"
import { useCallback } from "react"
import type { MouseDownHandler } from "../../../gesture/MouseGesture"
import { observeDrag2 } from "../../../helpers/observeDrag"
import { useHistory } from "../../../hooks/useHistory"
import {
  addPoint,
  drawPitch,
  erasePitch,
  linePitch,
  movePoint,
  overwritePitch,
  type PitchSample,
  removePoint,
  sinePitch,
  smoothPitch,
} from "../entities/pitchCurve"
import { dragVibrato, vibratoHandles } from "../entities/vibrato"
import { hitTestPitchPoint } from "../entities/pitchHit"
import { useNoteCoordTransform } from "../hooks/useNoteCoordTransform"
import { usePianoRollEditor } from "../hooks/usePianoRollEditor"
import { findPitchOwner, usePitchNotes } from "../hooks/usePitchNotes"
import { pitchTipAtom, pitchToolAtom } from "../hooks/usePitchTool"

const DRAW_STEP = 3 // px between interpolated samples while drawing
const BRUSH_STEP = 8 // px between brush applications (erase / smooth)
const BRUSH_RADIUS_PX = 24
const CURVE_HIT_PX = 8 // click distance to the curve that adds a point
const MERGE_PX = 8 // a point dropped this close to a neighbour is deleted

// Pitch tool. The sub-tool is chosen in the toolbar:
// - point: click the curve to add a point and drag it; drag a point to move it
//   (Ctrl = whole semitones, Shift = height of the previous point, Alt+Shift = of the next one);
//   a point dropped onto a neighbour is deleted; double-click a point to delete it
// - draw / line / scurve / sine / smooth / erase: drag over the notes
export const usePitchGesture = (): MouseDownHandler => {
  const tool = useAtomValue(pitchToolAtom)
  const setTip = useSetAtom(pitchTipAtom)
  const { getLocal } = useNoteCoordTransform()
  const { geometry, entries } = usePitchNotes()
  const pianoRollEditor = usePianoRollEditor()
  const { pushHistory } = useHistory()

  return useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) {
        return
      }
      const start = getLocal(e)
      const ownerAt = (p: Point) =>
        findPitchOwner(entries, geometry.pixelToMs(p.x))

      // one undo step per gesture, taken just before the first real change
      let pushed = false
      const commit = (id: number, pitch: NotePitch | undefined) => {
        if (!pushed) {
          pushHistory()
          pushed = true
        }
        pianoRollEditor.updateNote({ id, pitch })
      }

      // vibrato handles first (any sub-tool)
      for (const en of entries) {
        if (!en.stored || en.pitch.vibrato === undefined) {
          continue
        }
        const noteMs = en.endMs - en.startMs
        const curve = { ...en.pitch, points: en.points }
        const h = vibratoHandles(curve, noteMs).find((c) => {
          const q = geometry.pointToPixel(en.note, en.startMs, c)
          return Math.hypot(q.x - start.x, q.y - start.y) <= 7
        })
        if (h === undefined) {
          continue
        }
        const grabbed = geometry.pointToPixel(en.note, en.startMs, h)
        observeDrag2(e, {
          onMouseMove: (_ev, delta) => {
            const pos = { x: grabbed.x + delta.x, y: grabbed.y + delta.y }
            const rel = geometry.pixelToPoint(en.note, en.startMs, pos)
            const vib = dragVibrato(curve, noteMs, h.kind, rel.x, rel.y)
            commit(en.note.id, { ...en.pitch, vibrato: vib })
            setTip({
              ...pos,
              text: `${h.kind} ${h.kind === "period" ? `${vib.period}ms` : h.kind === "depth" ? `${vib.depth}cent` : `${vib[h.kind]}%`}`,
            })
          },
          onMouseUp: () => setTip(null),
        })
        return
      }

      if (tool === "point") {
        const hit = hitTestPitchPoint(entries, geometry, start)
        if (e.detail === 2) {
          if (hit !== undefined) {
            commit(hit.entry.note.id, removePoint(hit.entry.pitch, hit.index))
          }
          return
        }
        let entry = hit?.entry
        let index = hit?.index ?? -1
        let cur = entry?.pitch
        if (hit === undefined) {
          const owner = ownerAt(start)
          if (owner === undefined) {
            return
          }
          const rel = geometry.pixelToPoint(owner.note, owner.startMs, start)
          const y = samplePitch({ ...owner.pitch, points: owner.points }, rel.x)
          const onCurve = geometry.pointToPixel(owner.note, owner.startMs, {
            x: rel.x,
            y,
          })
          if (Math.abs(onCurve.y - start.y) > CURVE_HIT_PX) {
            return
          }
          const added = addPoint(owner.pitch, { x: rel.x, y })
          if (added === owner.pitch) {
            return
          }
          commit(owner.note.id, added)
          entry = owner
          cur = added
          index = added.points.findIndex((p) => Math.abs(p.x - rel.x) < 0.06)
        }
        if (entry === undefined || cur === undefined || index < 0) {
          return
        }
        const { note, startMs } = entry
        let pitch: NotePitch = cur
        const grabbed = geometry.pointToPixel(
          note,
          startMs,
          (hit === undefined ? pitch.points : entry.points)[index],
        )
        observeDrag2(e, {
          onMouseMove: (ev, delta) => {
            const pos = { x: grabbed.x + delta.x, y: grabbed.y + delta.y }
            const point = geometry.pixelToPoint(note, startMs, pos)
            const pts = pitch.points
            let y = point.y
            if (ev.ctrlKey || ev.metaKey) {
              y = Math.round(y / 10) * 10
            } else if (ev.altKey && ev.shiftKey && index < pts.length - 1) {
              y = pts[index + 1].y
            } else if (ev.shiftKey && index > 0) {
              y = pts[index - 1].y
            }
            pitch = movePoint(pitch, index, point.x, y)
            commit(note.id, pitch)
            const p = pitch.points[index]
            setTip({
              ...pos,
              text: `${p.x.toFixed(1)}ms, ${Math.round(p.y * 10)}cent`,
            })
          },
          onMouseUp: () => {
            setTip(null)
            const pts = pitch.points
            if (pts.length > 2 && index > 0 && index < pts.length - 1) {
              const me = geometry.pointToPixel(note, startMs, pts[index])
              const near = [pts[index - 1], pts[index + 1]].some((n) => {
                const q = geometry.pointToPixel(note, startMs, n)
                return Math.hypot(q.x - me.x, q.y - me.y) < MERGE_PX
              })
              if (near) {
                commit(note.id, removePoint(pitch, index))
              }
            }
          },
        })
        return
      }

      // two-point tools act on the note under the start of the drag
      const twoPoint = tool === "line" || tool === "scurve" || tool === "sine"
      const startOwner = ownerAt(start)
      if (twoPoint && startOwner === undefined) {
        return
      }
      const a =
        startOwner === undefined
          ? undefined
          : geometry.pixelToPoint(startOwner.note, startOwner.startMs, start)

      const samples = new Map<number, PitchSample[]>()
      const baselines = new Map<number, NotePitch | undefined>()
      const working = new Map<number, NotePitch | undefined>()

      const owners = new Map<number, (typeof entries)[number]>()
      const addSample = (pixel: Point) => {
        const owner = ownerAt(pixel)
        if (owner === undefined) {
          return
        }
        const id = owner.note.id
        owners.set(id, owner)
        if (!baselines.has(id)) {
          baselines.set(id, owner.note.pitch)
        }
        const list = samples.get(id) ?? []
        list.push(geometry.pixelToPoint(owner.note, owner.startMs, pixel))
        samples.set(id, list)
      }
      const applyBrush = (pixel: Point) => {
        const owner = ownerAt(pixel)
        if (owner === undefined) {
          return
        }
        const id = owner.note.id
        const base = working.has(id) ? working.get(id) : owner.note.pitch
        const ms = geometry.pixelToMs(pixel.x)
        const radius = geometry.pixelToMs(pixel.x + BRUSH_RADIUS_PX) - ms
        const x = ms - owner.startMs
        const next =
          tool === "erase"
            ? erasePitch(base, x - radius, x + radius)
            : smoothPitch(base, x - radius, x + radius)
        working.set(id, next)
        if (next !== base) {
          commit(id, next)
        }
      }

      const brush = tool === "erase" || tool === "smooth"
      if (brush) {
        applyBrush(start)
      }
      let last = start
      let moved = false
      observeDrag2(e, {
        onMouseMove: (_ev, delta) => {
          const pos = Point.add(start, delta)
          if (twoPoint && startOwner !== undefined && a !== undefined) {
            const b = geometry.pixelToPoint(
              startOwner.note,
              startOwner.startMs,
              pos,
            )
            const base = startOwner.note.pitch
            commit(
              startOwner.note.id,
              tool === "sine"
                ? sinePitch(base, a, b)
                : linePitch(base, a, b, tool === "line" ? "l" : "io"),
            )
            return
          }
          if ((tool === "draw" || tool === "overwrite") && !moved) {
            addSample(start)
          }
          moved = true
          const step = brush ? BRUSH_STEP : DRAW_STEP
          const steps = Math.max(
            1,
            Math.ceil(Math.hypot(pos.x - last.x, pos.y - last.y) / step),
          )
          for (let i = 1; i <= steps; i++) {
            const p = {
              x: last.x + ((pos.x - last.x) * i) / steps,
              y: last.y + ((pos.y - last.y) * i) / steps,
            }
            if (brush) {
              applyBrush(p)
            } else {
              addSample(p)
            }
          }
          last = pos
          for (const [id, list] of samples) {
            const xs = list.map((s) => s.x)
            const owner = owners.get(id)
            commit(
              id,
              tool === "overwrite" && owner !== undefined
                ? overwritePitch(
                    baselines.get(id),
                    { ...owner.pitch, points: owner.points },
                    list,
                    Math.min(...xs),
                    Math.max(...xs),
                  )
                : drawPitch(
                    baselines.get(id),
                    list,
                    Math.min(...xs),
                    Math.max(...xs),
                  ),
            )
          }
        },
      })
    },
    [
      tool,
      setTip,
      getLocal,
      entries,
      geometry,
      pianoRollEditor,
      pushHistory,
    ],
  )
}
