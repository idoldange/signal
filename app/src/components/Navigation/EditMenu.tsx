import {
  MenuHotKey as HotKey,
  Menu,
  MenuDivider,
  MenuItem,
} from "@signal-app/ui"
import React, { type FC, useCallback, useState } from "react"
import { useVocalGenPrompts } from "../../arona/useVocalGen"
import { randomSeed, vocalGen } from "../../arona/vocalTrack"
import { useHistory } from "../../hooks/useHistory"
import { useSong } from "../../hooks/useSong"
import { envString } from "../../localize/envString"
import { Localized } from "../../localize/useLocalization"
import { useEditMenuChildren } from "./EditMenuPortal"

export interface EditMenuProps {
  trigger: React.ReactNode
}

const _EditMenu: FC<EditMenuProps> = ({ trigger }) => {
  const { hasUndo, undo, hasRedo, redo } = useHistory()
  const editMenuChildren = useEditMenuChildren()
  const { getSong } = useSong()
  const { askTemperature, askSeed } = useVocalGenPrompts()
  const [isOpen, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const onClickUndo = useCallback(() => {
    close()
    undo()
  }, [close, undo])

  const onClickRedo = useCallback(() => {
    close()
    redo()
  }, [close, redo])

  // temperature / seed of the whole project (tracks and notes can override)
  const changeGen = async (kind: "temp" | "seed" | "random" | "reset") => {
    close()
    const song = getSong()
    const cur = vocalGen.ofSong(song)
    if (kind === "temp") {
      const v = await askTemperature("whole project", cur.temperature)
      if (v !== undefined) {
        vocalGen.setSong(song, { temperature: v })
      }
    } else if (kind === "seed") {
      const v = await askSeed("whole project", cur.seed)
      if (v !== undefined) {
        vocalGen.setSong(song, { seed: v })
      }
    } else if (kind === "random") {
      vocalGen.setSong(song, { seed: randomSeed() })
    } else {
      vocalGen.setSong(song, { temperature: null, seed: null })
    }
  }

  return (
    <Menu open={isOpen} onOpenChange={setOpen} trigger={trigger}>
      <MenuItem onClick={onClickUndo} disabled={!hasUndo}>
        <Localized name="undo" />
        <HotKey>{envString.cmdOrCtrl}+Z</HotKey>
      </MenuItem>

      <MenuItem onClick={onClickRedo} disabled={!hasRedo}>
        <Localized name="redo" />
        <HotKey>{envString.cmdOrCtrl}+Shift+Z</HotKey>
      </MenuItem>

      <MenuDivider />
      <MenuItem onClick={() => changeGen("temp")}>
        Voice: project temperature...
      </MenuItem>
      <MenuItem onClick={() => changeGen("seed")}>
        Voice: project seed...
      </MenuItem>
      <MenuItem onClick={() => changeGen("random")}>
        Voice: random project seed
      </MenuItem>
      <MenuItem onClick={() => changeGen("reset")}>
        Voice: reset project temperature and seed
      </MenuItem>

      {editMenuChildren.map((entry) => (
        <React.Fragment key={entry.id}>{entry.children}</React.Fragment>
      ))}
    </Menu>
  )
}

export const EditMenu = React.memo(_EditMenu)
