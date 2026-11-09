import type { TrackId } from "@signal-app/core"
import { ContextMenu, type ContextMenuProps, MenuItem } from "@signal-app/ui"
import Color from "color"
import { type FC, useCallback, useState } from "react"
import { useRemoveTrack } from "../../../actions"
import { useVocalGenPrompts } from "../../../arona/useVocalGen"
import { randomSeed, vocalGen } from "../../../arona/vocalTrack"
import { ColorPicker } from "../../../components/ColorPicker/ColorPicker"
import { useSong } from "../../../hooks/useSong"
import { useTrack } from "../../../hooks/useTrack"
import { Localized } from "../../../localize/useLocalization"
import { useTrackList } from "../hooks/useTrackList"
import { TrackDialog } from "./TrackDialog"

export interface TrackListContextMenuProps extends ContextMenuProps {
  trackId: TrackId
}

export const TrackListContextMenu: FC<TrackListContextMenuProps> = ({
  trackId,
  ...props
}) => {
  const { setColor } = useTrack(trackId)
  const { addTrack } = useTrackList()
  const { getTrack } = useSong()
  const { askTemperature, askSeed } = useVocalGenPrompts()
  const removeTrack = useRemoveTrack()

  const [isDialogOpened, setDialogOpened] = useState(false)
  const [isColorPickerOpened, setColorPickerOpened] = useState(false)

  const onClickAdd = addTrack
  const onClickDelete = useCallback(
    () => removeTrack(trackId),
    [trackId, removeTrack],
  )
  const onClickProperty = () => setDialogOpened(true)
  const onClickChangeTrackColor = () => setColorPickerOpened(true)

  // temperature / seed of this vocal track (notes can override with their own tags)
  const changeGen = async (kind: "temp" | "seed" | "random" | "reset") => {
    const track = getTrack(trackId)
    if (!track) {
      return
    }
    const cur = vocalGen.ofTrack(track)
    if (kind === "temp") {
      const v = await askTemperature("this track", cur.temperature)
      if (v !== undefined) {
        vocalGen.setTrack(track, { temperature: v })
      }
    } else if (kind === "seed") {
      const v = await askSeed("this track", cur.seed)
      if (v !== undefined) {
        vocalGen.setTrack(track, { seed: v })
      }
    } else if (kind === "random") {
      vocalGen.setTrack(track, { seed: randomSeed() })
    } else {
      vocalGen.setTrack(track, { temperature: null, seed: null })
    }
  }

  const onPickColor = (color: string | null) => {
    if (color === null) {
      setColor(null)
      return
    }
    const obj = Color(color)
    setColor({
      red: Math.floor(obj.red()),
      green: Math.floor(obj.green()),
      blue: Math.floor(obj.blue()),
      alpha: 0xff,
    })
  }

  return (
    <>
      <ContextMenu {...props}>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation()
            onClickAdd()
          }}
        >
          <Localized name="add-track" />
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation()
            onClickDelete()
          }}
        >
          <Localized name="delete-track" />
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation()
            onClickProperty()
          }}
        >
          <Localized name="property" />
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation()
            onClickChangeTrackColor()
          }}
        >
          <Localized name="change-track-color" />
        </MenuItem>
        <MenuItem onClick={() => changeGen("temp")}>
          Voice: temperature...
        </MenuItem>
        <MenuItem onClick={() => changeGen("seed")}>Voice: seed...</MenuItem>
        <MenuItem onClick={() => changeGen("random")}>
          Voice: random seed
        </MenuItem>
        <MenuItem onClick={() => changeGen("reset")}>
          Voice: reset temperature and seed
        </MenuItem>
      </ContextMenu>
      <TrackDialog
        trackId={trackId}
        open={isDialogOpened}
        onClose={() => setDialogOpened(false)}
      />
      <ColorPicker
        open={isColorPickerOpened}
        onSelect={onPickColor}
        onClose={() => setColorPickerOpened(false)}
      />
    </>
  )
}
