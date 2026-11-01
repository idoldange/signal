import styled from "@emotion/styled"
import { type FC, useRef, useState } from "react"

const Row = styled.div`
  display: flex;
  align-items: center;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: var(--color-text-secondary);
`

const Label = styled.div`
  flex-shrink: 0;
  width: 1.6rem;
`

const Range = styled.input`
  flex-grow: 1;
  min-width: 4rem;
  height: 0.75rem;
  margin: 0 0.4rem;
  cursor: pointer;
  accent-color: var(--color-theme);
  background: transparent;

  &[data-dim="true"] {
    opacity: 0.4;
  }
`

const NumberBox = styled.input`
  flex-shrink: 0;
  width: 2.2rem;
  box-sizing: border-box;
  padding: 0.05rem 0.2rem;
  text-align: right;
  font-size: 0.625rem;
  font-family: inherit;
  color: var(--color-text);
  background: transparent;
  border: 1px solid var(--color-divider);
  border-radius: 3px;
  outline: none;

  &:hover {
    background: var(--color-highlight);
  }

  &:focus {
    border-color: var(--color-theme);
    background: var(--color-background);
  }
`

export interface ValueSliderProps {
  label: string
  min: number
  max: number
  value: number
  defaultValue: number
  onChange: (value: number) => void
  // called once before a change is made by hand (to record the undo history)
  onStart?: () => void
  title?: string
  dim?: boolean
}

// A slider with a box after it: the number can be clicked and typed (Enter / leaving the box
// applies it, Escape cancels). Double-clicking the slider goes back to the default value.
export const ValueSlider: FC<ValueSliderProps> = ({
  label,
  min,
  max,
  value,
  defaultValue,
  onChange,
  onStart,
  title,
  dim,
}) => {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  const commit = () => {
    const text = draft
    setDraft(null)
    if (cancelled.current || text === null || text.trim() === "") {
      return
    }
    const typed = Number(text.replace(",", "."))
    if (!Number.isFinite(typed)) {
      return
    }
    const next = Math.max(min, Math.min(max, Math.round(typed)))
    if (next !== value) {
      onStart?.()
      onChange(next)
    }
  }

  return (
    <Row
      title={title}
      // the track list is sortable by dragging: a drag here must only move the slider
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Label>{label}</Label>
      <Range
        type="range"
        min={min}
        max={max}
        value={value}
        data-dim={dim}
        onPointerDown={() => onStart?.()}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => {
          onStart?.()
          onChange(defaultValue)
        }}
      />
      <NumberBox
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        onFocus={(e) => {
          cancelled.current = false
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        // keys typed in the box must not reach the editor shortcuts (space = play, delete...)
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") {
            e.currentTarget.blur()
          } else if (e.key === "Escape") {
            cancelled.current = true
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onKeyPress={(e) => e.stopPropagation()}
      />
    </Row>
  )
}
