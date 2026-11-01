import type { Track } from "@signal-app/core"

// Volume of a track = its MIDI volume (CC7) at the start of the song. It is a plain MIDI
// event of the track, so it is kept when the song is saved or exported as MIDI.
export const DEFAULT_TRACK_VOLUME = 100
export const MAX_TRACK_VOLUME = 127

// Pan = MIDI pan (CC10): 0 = hard left, 64 = centre, 127 = hard right.
export const CENTER_PAN = 64

export const trackVolume = (track: Track): number =>
  track.getVolume(0)?.value ?? DEFAULT_TRACK_VOLUME

export const trackPan = (track: Track): number =>
  track.getPan(0)?.value ?? CENTER_PAN

// MIDI pan <-> -1 (left) .. 1 (right), and the -100 .. 100 shown to the user
export const panFromCc = (cc: number): number =>
  Math.max(-1, Math.min(1, (cc - CENTER_PAN) / 63))

export const ccFromPan = (pan: number): number =>
  Math.max(0, Math.min(127, Math.round(CENTER_PAN + pan * 63)))

export const panPercentFromCc = (cc: number): number =>
  Math.round(panFromCc(cc) * 100)

export const ccFromPanPercent = (percent: number): number =>
  ccFromPan(percent / 100)

// Level of the Arona vocal of a track: the default volume (100) sings as loud as before.
export const vocalGainOf = (track: Track): number =>
  trackVolume(track) / DEFAULT_TRACK_VOLUME

// OpenUtau stores a track volume in dB (0 = unchanged, -24 = silent).
export const trackVolumeDb = (track: Track): number => {
  const gain = vocalGainOf(track)
  return gain <= 0
    ? -24
    : Math.max(-24, Math.round(20 * Math.log10(gain) * 10) / 10)
}

// ... and a pan as -100 .. 100
export const trackPanPercent = (track: Track): number =>
  panPercentFromCc(trackPan(track))
