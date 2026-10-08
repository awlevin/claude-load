import type { ReactNode } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { lerp, progress } from '../motion'
import { C, FONT } from '../theme'

/** Type sizes, chosen to read on a phone (the video at 480 px wide). */
export const TYPE = { setup: 64, punch: 124 }

/**
 * A text card, centered: a grey setup line, then a white punchline.
 * Everything fades out near the end.
 */
export function TextCard({
  setup,
  punch,
  punchAt = 0.55,
  children,
}: {
  setup: ReactNode
  punch: ReactNode
  /** When the punchline arrives, in seconds. */
  punchAt?: number
  children?: ReactNode
}) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const out = 1 - progress(t, end - 0.35, end, x => x)
  const pSetup = progress(t, 0.08, 0.55)
  const pPunch = progress(t, punchAt, punchAt + 0.5)
  const pChild = progress(t, punchAt + 0.25, punchAt + 0.75)
  return (
    <AbsoluteFill style={{ background: C.ground, justifyContent: 'center', alignItems: 'center', opacity: out }}>
      <div
        style={{
          width: 1640,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 30,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: FONT.sans,
            fontWeight: 500,
            fontSize: TYPE.setup,
            lineHeight: 1.22,
            letterSpacing: '-0.015em',
            color: C.setup,
            opacity: pSetup,
            transform: `translateY(${lerp(14, 0, pSetup)}px)`,
            textWrap: 'balance',
          }}
        >
          {setup}
        </div>
        <div
          style={{
            fontFamily: FONT.sans,
            fontWeight: 500,
            fontSize: TYPE.punch,
            lineHeight: 1.05,
            letterSpacing: '-0.035em',
            color: C.punch,
            opacity: pPunch,
            transform: `translateY(${lerp(20, 0, pPunch)}px)`,
            textWrap: 'balance',
          }}
        >
          {punch}
        </div>
        {children ? <div style={{ opacity: pChild, marginTop: 16 }}>{children}</div> : null}
      </div>
    </AbsoluteFill>
  )
}
