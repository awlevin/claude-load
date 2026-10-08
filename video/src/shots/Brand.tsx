import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { lerp, progress } from '../motion'
import { C, FONT } from '../theme'

/** The banner's ░ texture: staggered square dots, a quarter of the area. */
function Dots({
  x,
  y,
  w,
  h,
  dot = 10,
  opacity = 1,
}: {
  x: number
  y: number
  w: number
  h: number
  dot?: number
  opacity?: number
}) {
  const id = `dots-${dot}`
  return (
    <svg style={{ position: 'absolute', left: x, top: y, opacity }} width={w} height={h}>
      <defs>
        <pattern id={id} width={dot * 4} height={dot * 2} patternUnits="userSpaceOnUse">
          <rect x={0} y={0} width={dot} height={dot} fill={C.shade} />
          <rect x={dot * 2} y={dot} width={dot} height={dot} fill={C.shade} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>
  )
}

/**
 * The title: the README banner in motion. The bar fills in amber to 3/8, the
 * word sits on it, and the ░ texture holds the line.
 */
export function TitleCard() {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const W = 1920
  const H = 1080
  const split = (W * 3) / 8
  const fill = progress(t, 0.05, 0.9)
  const word = progress(t, 0.45, 0.95)
  const line = progress(t, 0.75, 1.25)
  const out = 1 - progress(t, end - 0.35, end, x => x)
  return (
    <AbsoluteFill style={{ background: C.ground, opacity: out }}>
      <Dots x={split} y={0} w={W - split} h={H} opacity={progress(t, 0.2, 0.8)} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: split * fill, height: H, background: C.amber }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: split,
          height: H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT.pixel,
          fontSize: 136,
          color: C.ink,
          opacity: word,
          transform: `translateY(${lerp(16, 0, word)}px)`,
        }}
      >
        loading
      </div>
      <div
        style={{
          position: 'absolute',
          left: split + 110,
          top: H / 2,
          padding: '34px 48px',
          background: C.ground,
          fontFamily: FONT.sans,
          fontWeight: 500,
          fontSize: 104,
          lineHeight: 1.1,
          letterSpacing: '-0.035em',
          color: C.punch,
          opacity: line,
          transform: `translateY(calc(-50% + ${lerp(18, 0, line)}px))`,
        }}
      >
        A live countdown
        <br />
        <span style={{ color: C.setup, fontSize: 64, letterSpacing: '-0.02em' }}>for Claude Code</span>
      </div>
    </AbsoluteFill>
  )
}

/** The end card: the word, the install command and the repo. */
export function EndCard() {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const a = progress(t, 0.05, 0.55)
  const b = progress(t, 0.35, 0.85)
  const c = progress(t, 0.6, 1.1)
  const bar = progress(t, 0.1, end - 0.4, x => x)
  return (
    <AbsoluteFill style={{ background: C.ground, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 56 }}>
        <div
          style={{
            fontFamily: FONT.pixel,
            fontSize: 200,
            color: C.ink,
            background: C.amber,
            padding: '4px 56px 20px',
            opacity: a,
            transform: `translateY(${lerp(14, 0, a)}px)`,
          }}
        >
          loading
        </div>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 46,
            color: C.punch,
            padding: '26px 40px',
            borderRadius: 18,
            border: `1px solid ${C.frameBorder}`,
            background: 'rgba(255,255,255,0.04)',
            opacity: b,
            transform: `translateY(${lerp(14, 0, b)}px)`,
          }}
        >
          /plugin install loading --marketplace awlevin/claude-load
        </div>
        <div
          style={{
            fontFamily: FONT.sans,
            fontWeight: 500,
            fontSize: 58,
            color: C.setup,
            letterSpacing: '-0.01em',
            opacity: c,
            transform: `translateY(${lerp(14, 0, c)}px)`,
          }}
        >
          github.com/awlevin/claude-load
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 10, width: 1920 * bar, background: C.amber }} />
    </AbsoluteFill>
  )
}
