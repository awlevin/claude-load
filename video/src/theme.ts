// The look of the video: agentnative.inc motion graphics, with the repo's
// amber and pixel wordmark for the title and end cards.

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

export const C = {
  ground: '#212120',
  setup: '#9C9B96',
  punch: '#FFFFFF',
  coral: '#F07A5A',
  amber: '#F7B54A',
  /** The README banner's ink, for the wordmark on amber. */
  ink: '#191C36',
  /** The ░ texture of the banner: amber dots dimmed toward the ground. */
  shade: '#8A6A3E',
  terminal: '#1A1A1A',
  terminalText: '#E8E6E3',
  frameBorder: 'rgba(255,255,255,0.10)',
}

export const FONT = {
  sans: 'Geist',
  mono: 'JetBrains Mono',
  pixel: 'Departure Mono',
}

/** GSAP's power3.out. */
export const power3Out = (t: number) => 1 - Math.pow(1 - t, 3)
export const power2InOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
