import { usePrompt, useToast } from "dialog-hooks"
import { MAX_SEED } from "./vocalTrack"

export const MIN_TEMPERATURE = 0.05
export const MAX_TEMPERATURE = 1.5

// Prompts for the generation settings. Resolve to: undefined = cancelled / invalid,
// null = cleared (back to the default), number = new value.
export const useVocalGenPrompts = () => {
  const prompt = usePrompt()
  const toast = useToast()

  const askTemperature = async (
    scope: string,
    initial: number | null | undefined,
  ): Promise<number | null | undefined> => {
    const text = await prompt.show({
      title: `Temperature (${scope})`,
      message: `${MIN_TEMPERATURE} - ${MAX_TEMPERATURE}. Lower = steadier, higher = more varied. Empty = default (0.5).`,
      initialText: initial == null ? "" : String(initial),
    })
    if (text === null) {
      return undefined
    }
    if (text.trim() === "") {
      return null
    }
    const v = Number(text)
    if (!Number.isFinite(v) || v < MIN_TEMPERATURE || v > MAX_TEMPERATURE) {
      toast.error(`Temperature must be ${MIN_TEMPERATURE} - ${MAX_TEMPERATURE}`)
      return undefined
    }
    return Math.round(v * 100) / 100
  }

  const askSeed = async (
    scope: string,
    initial: number | null | undefined,
  ): Promise<number | null | undefined> => {
    const text = await prompt.show({
      title: `Seed (${scope})`,
      message:
        "Whole number. The same seed gives the same take; change it to get a different one. Empty = default (fixed by the lyrics).",
      initialText: initial == null ? "" : String(initial),
    })
    if (text === null) {
      return undefined
    }
    if (text.trim() === "") {
      return null
    }
    const v = Number(text)
    if (!Number.isInteger(v) || v < 0 || v > MAX_SEED) {
      toast.error(`Seed must be a whole number 0 - ${MAX_SEED}`)
      return undefined
    }
    return v
  }

  return { askTemperature, askSeed }
}
