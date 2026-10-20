import type { FC } from "react"
import { useDiscordUser } from "../../arona/useDiscordUser"
import { Tab, TabTitle } from "./Navigation"

// Accounts come from Discord: the name and avatar of whoever opened the Activity
export const UserButton: FC = () => {
  const user = useDiscordUser()
  if (user === null) {
    return null
  }
  const name = user.global_name ?? user.username
  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : null
  return (
    <Tab title={`Signed in with Discord as ${name}`} style={{ cursor: "default" }}>
      {avatar && (
        <img
          src={avatar}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: "50%", marginRight: "0.25rem" }}
        />
      )}
      <TabTitle>{name}</TabTitle>
    </Tab>
  )
}
