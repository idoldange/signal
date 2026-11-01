import { describe, expect, it } from "vitest"
import { splitLangTag, withLangTag } from "./vocalTrack"

describe("language tag", () => {
  it("splits and sets the {xx} tag of a lyric", () => {
    expect(splitLangTag("{en}hello")).toEqual({ lang: "en", text: "hello" })
    expect(splitLangTag("hello")).toEqual({ lang: null, text: "hello" })
    expect(splitLangTag("{xx}hello").lang).toBeNull()
    expect(withLangTag("hello", "ja")).toBe("{ja}hello")
    expect(withLangTag("{en}hello", "ko")).toBe("{ko}hello")
    expect(withLangTag("{en}hello", null)).toBe("hello")
  })
})
