// midifile-ts writes meta event text as one byte per character, which would cut anything beyond Latin-1.
// Lyrics are therefore stored as UTF-8 bytes, each byte held in one character of the string.
export const encodeLyricText = (text: string): string =>
  Array.from(new TextEncoder().encode(text), (byte) =>
    String.fromCharCode(byte),
  ).join("")

export const decodeLyricText = (binary: string): string =>
  new TextDecoder("utf-8").decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0) & 0xff),
  )
