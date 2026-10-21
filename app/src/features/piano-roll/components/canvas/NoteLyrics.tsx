import { useTheme } from "@emotion/react"
import { type FC, useEffect, useRef } from "react"
import { useTickScroll } from "../../../../hooks/useTickScroll"
import { useIsRhythmTrack } from "../../hooks/useIsRhythmTrack"
import { useKeyScroll } from "../../hooks/useKeyScroll"
import { useNotes } from "../../hooks/useNotes"

export interface NoteLyricsProps {
  width: number
  height: number
}

// Lyrics can be any script, so they are drawn on a 2D canvas laid over the WebGL piano roll
// (the WebGL note labels use a glyph atlas that only has ASCII).
export const NoteLyrics: FC<NoteLyricsProps> = ({ width, height }) => {
  const notes = useNotes()
  const isRhythmTrack = useIsRhythmTrack()
  const { scrollLeft } = useTickScroll()
  const { scrollTop } = useKeyScroll()
  const theme = useTheme()
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = window.devicePixelRatio || 1

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) {
      return
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (isRhythmTrack) {
      return
    }
    ctx.textBaseline = "middle"
    for (const note of notes) {
      const lyric = note.lyric ?? ""
      if (lyric.length === 0 || note.width < 8) {
        continue
      }
      const x = note.x - scrollLeft
      const y = note.y - scrollTop
      if (x + note.width < 0 || x > width || y + note.height < 0 || y > height) {
        continue
      }
      const size = Math.max(8, Math.min(note.height - 3, 14))
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, note.width, note.height)
      ctx.clip()
      ctx.font = `${size}px sans-serif`
      ctx.fillStyle = note.isSelected
        ? theme.isLightContent
          ? theme.backgroundColor
          : theme.textColor
        : theme.onSurfaceColor
      ctx.fillText(lyric, x + 3, y + note.height / 2)
      ctx.restore()
    }
  }, [notes, scrollLeft, scrollTop, width, height, dpr, isRhythmTrack, theme])

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
