// Ported from OpenUtau (https://github.com/stakira/OpenUtau), OpenUtau.Core/Util/SplitLyrics.cs
// MIT License, Copyright (c) 2014 StAkira and the OpenUtau contributors.
//
// A lyrics text is split into one syllable per note:
//   - whitespace separates syllables
//   - every CJK ideograph, hiragana, katakana and hangul syllable is a syllable of its own,
//     small kana (ゃゅょ...) stay attached to the kana before them
//   - "double quotes" keep spaces inside one syllable, "" is an empty syllable

const whitespace = /\s/u
const standalone = /[一-鿿぀-ゟ゠-ヿ가-힯]/u
const contracted = /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/u

// Intl.Segmenter splits text into user perceived characters, like .NET's StringInfo text elements
type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> }
const segmenter: GraphemeSegmenter = new (
  Intl as unknown as {
    Segmenter: new (
      locales?: string,
      options?: { granularity: "grapheme" },
    ) => GraphemeSegmenter
  }
).Segmenter(undefined, { granularity: "grapheme" })

export const splitLyrics = (text: string | null | undefined): string[] => {
  if (text === null || text === undefined) {
    return []
  }
  const lyrics: string[] = []
  let builder = ""
  const elements = Array.from(segmenter.segment(text), (s) => s.segment)
  for (let i = 0; i < elements.length; i++) {
    const ele = elements[i]
    if (whitespace.test(ele)) {
      if (builder.length > 0) {
        lyrics.push(builder)
        builder = ""
      }
    } else if (contracted.test(ele)) {
      builder += ele
      lyrics.push(builder)
      builder = ""
    } else if (standalone.test(ele)) {
      if (builder.length > 0) {
        lyrics.push(builder)
        builder = ""
      }
      builder += ele
    } else if (ele === '"') {
      for (i++; i < elements.length; i++) {
        const inner = elements[i]
        if (inner === '"') {
          lyrics.push(builder)
          builder = ""
          break
        }
        builder += inner
      }
    } else {
      if (builder.length > 0 && standalone.test(builder)) {
        lyrics.push(builder)
        builder = ""
      }
      builder += ele
    }
  }
  if (builder.length > 0) {
    lyrics.push(builder)
  }
  return lyrics
}

export const joinLyrics = (lyrics: Iterable<string>): string => {
  let out = ""
  for (const lyric of lyrics) {
    if (out.length !== 0) {
      out += " "
    }
    if (lyric.length === 0) {
      out += '""'
    } else if (whitespace.test(lyric)) {
      out += `"${lyric}"`
    } else if (standalone.test(lyric)) {
      if (lyric.length === 1) {
        out += lyric
      } else if (lyric.length === 2 && contracted.test(lyric.substring(1))) {
        out += lyric
      } else {
        out += `"${lyric}"`
      }
    } else {
      out += lyric
    }
  }
  return out
}
