import { SoundFont, type SoundFontSynth } from "@signal-app/player"
import { activityFetch, type ActivityProject } from "./activityApi"

// Loaded by the editor as the main sound bank (see SoundFontRepository).
const MAIN_SOUND_FONT = "generaluser-gs"

// Downloads the extra soundfonts the bot picked for the imported tracks (including
// fonts the user uploaded to the `!arona synth` panel) and registers each one as a
// separate bank. Returns stem -> bank MSB offset for projectToSong.
export const loadProjectFonts = async (
  synth: SoundFontSynth,
  project: ActivityProject,
): Promise<Map<string, number>> => {
  const stems = [
    ...new Set(
      project.tracks
        .map((t) => t.sf)
        .filter(
          (sf): sf is string =>
            !!sf && sf.toLowerCase() !== MAIN_SOUND_FONT,
        ),
    ),
  ]
  const offsets = new Map<string, number>()
  let next = 2 // bank MSB 1 is the GM drum bank
  for (const stem of stems) {
    try {
      const res = await activityFetch(
        `/api/session/font/${encodeURIComponent(stem)}`,
      )
      const soundFont = await SoundFont.load(await res.arrayBuffer())
      await synth.addSoundFont(soundFont, `arona:${stem}`, next)
      offsets.set(stem, next)
      next += 1
    } catch (e) {
      console.warn(`[arona] soundfont "${stem}" is not available`, e)
    }
  }
  return offsets
}
