import styled from "@emotion/styled"
import { ToolbarButtonGroupItem, Tooltip } from "@signal-app/ui"
import { useAtom } from "jotai"
import { ToolSelector } from "../../../../components/Toolbar/ToolSelector"
import PitchIcon from "../../../../images/icons/pitch.svg"
import { usePianoRoll } from "../../hooks/usePianoRoll"
import { pitchToolKeys } from "../../hooks/usePianoRollKeyboardShortcut"
import { type PitchTool, pitchToolAtom } from "../../hooks/usePitchTool"

const IconWrapper = styled.div`
  display: flex;
`

const Label = styled.span`
  font-size: 0.7rem;
  padding: 0 0.2rem;
  white-space: nowrap;
`

const pitchTools: { tool: PitchTool; label: string; tip: string }[] = [
  { tool: "point", label: "Point", tip: "Pitch Point Tool: click the curve to add, drag to move (Ctrl = semitones, Shift = previous height)" },
  { tool: "draw", label: "Draw", tip: "Draw Pitch Tool: draw freehand" },
  { tool: "overwrite", label: "Overwrite", tip: "Pitch Overwrite Tool: draw a deviation on top of the curve, across notes" },
  { tool: "line", label: "Line", tip: "Pitch Line Tool: drag a straight line" },
  { tool: "scurve", label: "S-Curve", tip: "Pitch S-Curve Tool: drag a smooth transition" },
  { tool: "sine", label: "Sine", tip: "Pitch Sine Wave Tool: drag the length, height = amplitude" },
  { tool: "smooth", label: "Smooth", tip: "Pitch Smoothen Tool: brush over the curve" },
  { tool: "erase", label: "Erase", tip: "Pitch Eraser: brush to delete pitch points" },
]

export const PianoRollToolSelector = () => {
  const { mouseMode, setMouseMode } = usePianoRoll()
  const [pitchTool, setPitchTool] = useAtom(pitchToolAtom)
  return (
    <ToolSelector mouseMode={mouseMode} onSelect={setMouseMode}>
      <ToolbarButtonGroupItem
        onMouseDown={() => setMouseMode("pitch")}
        selected={mouseMode === "pitch"}
      >
        <Tooltip title="Pitch Tool [3]">
          <IconWrapper>
            <PitchIcon
              style={{
                width: "1.3rem",
                height: "1.3rem",
                fill: "currentColor",
              }}
              viewBox="0 0 128 128"
            />
          </IconWrapper>
        </Tooltip>
      </ToolbarButtonGroupItem>
      {mouseMode === "pitch" &&
        pitchTools.map(({ tool, label, tip }) => (
          <ToolbarButtonGroupItem
            key={tool}
            onMouseDown={() => setPitchTool(tool)}
            selected={pitchTool === tool}
          >
            <Tooltip title={`${tip} [${pitchToolKeys.find((k) => k.tool === tool)?.code.replace("Digit", "").replace("Minus", "-")}]`}>
              <Label>{label}</Label>
            </Tooltip>
          </ToolbarButtonGroupItem>
        ))}
    </ToolSelector>
  )
}
