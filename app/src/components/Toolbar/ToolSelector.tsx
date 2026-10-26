import styled from "@emotion/styled"
import {
  ToolbarButtonGroup,
  ToolbarButtonGroupItem,
  Tooltip,
} from "@signal-app/ui"
import { type FC, type ReactNode, useCallback } from "react"
import PencilIcon from "../../images/icons/pencil.svg"
import SelectionIcon from "../../images/icons/selection.svg"
import { Localized } from "../../localize/useLocalization"

const ButtonGroup = styled(ToolbarButtonGroup)`
  background-color: transparent;
  margin-right: 1rem;
`

export interface ToolSelectorProps {
  mouseMode: "pencil" | "selection" | "pitch"
  onSelect: (mouseMode: "pencil" | "selection") => void
  // extra tools shown after the pencil and selection tools
  children?: ReactNode
}

const IconWrapper = styled.div`
  display: flex;
`

export const ToolSelector: FC<ToolSelectorProps> = ({
  mouseMode,
  onSelect,
  children,
}) => {
  return (
    <ButtonGroup>
      <ToolbarButtonGroupItem
        onMouseDown={useCallback(() => onSelect("pencil"), [onSelect])}
        selected={mouseMode === "pencil"}
      >
        <Tooltip
          title={
            <>
              <Localized name="pencil-tool" /> [1]
            </>
          }
        >
          <IconWrapper>
            <PencilIcon
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
      <ToolbarButtonGroupItem
        onMouseDown={useCallback(() => onSelect("selection"), [onSelect])}
        selected={mouseMode === "selection"}
      >
        <Tooltip
          title={
            <>
              <Localized name="selection-tool" /> [2]
            </>
          }
        >
          <IconWrapper>
            <SelectionIcon
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
      {children}
    </ButtonGroup>
  )
}
