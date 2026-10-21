// Test cases ported from OpenUtau.Test/Core/Util/SplitLyricsTest.cs (MIT, StAkira and the OpenUtau contributors)
import { describe, expect, it } from "vitest"
import { joinLyrics, splitLyrics } from "./splitLyrics"

describe("splitLyrics", () => {
  it("splits like OpenUtau", () => {
    expect(
      splitLyrics('a word中文русский가각갂ひらがな "がな" "" "two words"'),
    ).toEqual([
      "a", "word", "中", "文", "русский", "가", "각", "갂",
      "ひ", "ら", "が", "な", "がな", "", "two words",
    ])
  })

  it("keeps small kana with the kana before them", () => {
    expect(splitLyrics("きょう")).toEqual(["きょ", "う"])
  })

  it("handles empty and missing text", () => {
    expect(splitLyrics("")).toEqual([])
    expect(splitLyrics(null)).toEqual([])
    expect(splitLyrics(undefined)).toEqual([])
  })

  it("keeps an unterminated quote as one syllable", () => {
    expect(splitLyrics('a "b c')).toEqual(["a", "b c"])
  })
})

describe("joinLyrics", () => {
  it("joins like OpenUtau", () => {
    expect(
      joinLyrics([
        "a", "word", "中", "文", "русский", "가", "각", "갂",
        "ひ", "ら", "が", "な", "がな", "", "two words",
      ]),
    ).toBe('a word 中 文 русский 가 각 갂 ひ ら が な "がな" "" "two words"')
  })

  it("round trips", () => {
    const lyrics = [
      "a", "word", "中", "文", "中文", " ", "    ", "-", "12 3# $%^", "中русский",
      "русский", "ひ", "ら", "が", "な", "がな", "two words", "가", "각", "갂", "갃간",
    ]
    expect(splitLyrics(joinLyrics(lyrics))).toEqual(lyrics)
  })
})
