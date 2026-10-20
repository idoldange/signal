// True when the editor runs inside the Arona Discord Activity (Discord adds frame_id to the iframe URL).
export const isDiscordActivity = new URLSearchParams(window.location.search).has(
  "frame_id",
)
