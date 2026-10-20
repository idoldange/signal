import { useEffect, useState } from "react"

export interface DiscordUser {
  id: string
  username: string
  global_name?: string | null
  avatar?: string | null
}

interface AronaState {
  user?: DiscordUser | null
}

// window.__arona is filled by arona-boot.js, which logs in through the Discord Embedded App SDK
const currentUser = () =>
  (window as unknown as { __arona?: AronaState }).__arona?.user ?? null

export const useDiscordUser = (): DiscordUser | null => {
  const [user, setUser] = useState<DiscordUser | null>(currentUser)

  useEffect(() => {
    const update = () => setUser(currentUser())
    window.addEventListener("arona-auth", update)
    update()
    return () => window.removeEventListener("arona-auth", update)
  }, [])

  return user
}
