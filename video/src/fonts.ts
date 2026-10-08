import { continueRender, delayRender, staticFile } from 'remotion'

import { FONT } from './theme'

const FACES: { family: string; file: string; weight: string }[] = [
  { family: FONT.sans, file: 'fonts/Geist-Medium.otf', weight: '500' },
  { family: FONT.mono, file: 'fonts/JetBrainsMono-Regular.ttf', weight: '400' },
  { family: FONT.mono, file: 'fonts/JetBrainsMono-Bold.ttf', weight: '700' },
  { family: FONT.pixel, file: 'fonts/DepartureMono-Regular.otf', weight: '400' },
]

let loaded: Promise<void> | null = null

/** Loads every font once; rendering waits until they are ready. */
export function loadFonts(): void {
  if (loaded) return
  const handle = delayRender('Loading fonts')
  loaded = Promise.all(
    FACES.map(async ({ family, file, weight }) => {
      const face = new FontFace(family, `url(${staticFile(file)})`, { weight })
      await face.load()
      ;(document.fonts as unknown as { add(f: FontFace): void }).add(face)
    }),
  ).then(() => continueRender(handle))
}
