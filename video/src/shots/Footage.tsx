import type { ReactElement } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { lerp, progress } from '../motion'
import type { CellBox, Recording } from '../term/data'
import { findOnScreen, screenAt } from '../term/data'
import { TermContent, metrics } from '../term/TermView'
import { C, FONT, power2InOut } from '../theme'

/** The footage frame, and the terminal drawn inside it. */
export const FRAME = { w: 1600, h: 900, radius: 28 }
const M = metrics(21.1, 1.18)

/**
 * A stretch of the recording, from `from` to `to` seconds, played at `speed`.
 * `dip` fades the terminal to dark over that many seconds on each side of the
 * cut into this segment, so the camera can move while nothing shows.
 */
export type Segment = { from: number; to: number; speed: number; dip?: number }

/**
 * Where the camera looks from local time `at`: the whole screen, or a box of
 * cells fitted to the frame (`zoom` overrides the fit). `align: 'left'` puts
 * the box's left edge at the frame's left, so no text is cut there.
 */
export type CameraKey = {
  at: number
  zoom?: number
  focus?: CellBox
  align?: 'left' | 'center'
  dur?: number
  /** Center on the focus even past the terminal's edge (the ground shows there). */
  free?: boolean
}

/** A coral box around what matches `targets` on screen, from `from` to `to` seconds. */
export type Highlight = {
  from: number
  to: number
  targets: RegExp[]
  /** One box per target instead of one box around all of them. */
  isEach?: boolean
}

export type FootageProps = {
  rec: Recording
  segments: Segment[]
  camera: CameraKey[]
  highlights: Highlight[]
  /** Extra fade at the frame's top and left edges, in pixels, to keep a crop clean. */
  fade?: { top?: number; left?: number; right?: number }
  /** The video opens on this shot: its first frame shows at full strength. */
  isOpening?: boolean
}

export function footageDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.to - s.from) / s.speed, 0)
}

function locate(segments: Segment[], t: number) {
  let start = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!
    const len = (s.to - s.from) / s.speed
    if (t < start + len || i === segments.length - 1) {
      return { i, seg: s, local: t - start, castT: Math.min(s.to, s.from + (t - start) * s.speed) }
    }
    start += len
  }
  throw new Error('no segments')
}

function termSize(rec: Recording) {
  return { w: rec.cols * M.cellW, h: rec.rows * M.lineH }
}

/** Cells to world pixels: the terminal sits centered in the frame. */
function world(rec: Recording) {
  const { w, h } = termSize(rec)
  const padX = (FRAME.w - w) / 2
  const padY = (FRAME.h - h) / 2
  return {
    padX,
    padY,
    box: (b: CellBox) => ({
      x: padX + b.c0 * M.cellW,
      y: padY + b.r0 * M.lineH,
      w: (b.c1 - b.c0) * M.cellW,
      h: (b.r1 - b.r0) * M.lineH,
    }),
  }
}

type Cam = { zoom: number; cx: number; cy: number; free?: boolean }

function cameraAt(rec: Recording, keys: CameraKey[], t: number): Cam {
  const w = world(rec)
  const MARGIN = 28
  const camOf = (k: CameraKey | undefined): Cam => {
    if (!k || !k.focus) return { zoom: k?.zoom ?? 1, cx: FRAME.w / 2, cy: FRAME.h / 2 }
    const b = w.box(k.focus)
    const zoom = k.zoom ?? Math.min(FRAME.w / (b.w + MARGIN * 2), FRAME.h / (b.h + MARGIN * 2))
    const cx = k.align === 'left' ? b.x - MARGIN + FRAME.w / zoom / 2 : b.x + b.w / 2
    return { zoom, cx, cy: b.y + b.h / 2, free: k.free }
  }
  let idx = -1
  keys.forEach((k, i) => {
    if (k.at <= t) idx = i
  })
  if (idx < 0) return camOf(keys[0])
  const cur = keys[idx]!
  const prev = idx > 0 ? camOf(keys[idx - 1]) : camOf(cur)
  const next = camOf(cur)
  const p = progress(t, cur.at, cur.at + (cur.dur ?? 0.8), power2InOut)
  // Zoom moves in log space, so the speed feels even.
  const zoom = Math.exp(lerp(Math.log(prev.zoom), Math.log(next.zoom), p))
  return { zoom, cx: lerp(prev.cx, next.cx, p), cy: lerp(prev.cy, next.cy, p), free: next.free }
}

/** The camera's window on the world, kept inside the frame. */
function viewBox(cam: Cam) {
  const vw = FRAME.w / cam.zoom
  const vh = FRAME.h / cam.zoom
  if (cam.free) return { x: cam.cx - vw / 2, y: cam.cy - vh / 2, vw, vh }
  const x = Math.min(Math.max(cam.cx - vw / 2, 0), FRAME.w - vw)
  const y = Math.min(Math.max(cam.cy - vh / 2, 0), FRAME.h - vh)
  return { x, y, vw, vh }
}

const PAD = 7 // highlight padding around the text, in screen pixels
const STROKE = 4
const RADIUS = 10

type Rect = { x: number; y: number; w: number; h: number }

function HighlightBox({ rect, draw, pulse, opacity }: { rect: Rect; draw: number; pulse: number; opacity: number }) {
  const perimeter = 2 * (rect.w + rect.h)
  const glow = 0.22 + 0.22 * pulse
  return (
    <g opacity={opacity}>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx={RADIUS}
        fill="none"
        stroke={C.coral}
        strokeWidth={STROKE * 3}
        opacity={draw >= 1 ? glow : 0}
        filter="url(#coral-glow)"
      />
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx={RADIUS}
        fill="none"
        stroke={C.coral}
        strokeWidth={STROKE}
        strokeLinecap="round"
        pathLength={perimeter}
        strokeDasharray={perimeter}
        strokeDashoffset={perimeter * (1 - draw)}
      />
    </g>
  )
}

function SpeedPill({ speed, opacity }: { speed: number; opacity: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        right: 28,
        padding: '10px 20px 10px 18px',
        borderRadius: 999,
        background: 'rgba(33,33,32,0.82)',
        border: `1px solid ${C.frameBorder}`,
        color: C.punch,
        fontFamily: FONT.sans,
        fontWeight: 500,
        fontSize: 28,
        letterSpacing: '-0.01em',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <svg width={22} height={16} viewBox="0 0 22 16">
        <path d="M0 0L10 8L0 16Z M11 0L21 8L11 16Z" fill={C.punch} />
      </svg>
      {speed}×
    </div>
  )
}

/** Zoomed in, the terminal fades out at the frame's edges, so a crop never ends in cut letters. */
function edgeFade(zoom: number, extra: FootageProps['fade'] = {}) {
  const f = Math.round(90 * Math.min(1, Math.max(0, (zoom - 1) / 0.4)))
  if (f === 0) return {}
  const left = Math.max(f, extra.left ?? 0)
  const right = Math.max(f, extra.right ?? 0)
  const top = Math.max(f * 0.6, extra.top ?? 0)
  const mask = [
    `linear-gradient(to right, transparent 0, black ${left}px, black calc(100% - ${right}px), transparent 100%)`,
    `linear-gradient(to bottom, transparent 0, black ${top}px, black calc(100% - ${f * 0.6}px), transparent 100%)`,
  ].join(', ')
  return {
    WebkitMaskImage: mask,
    WebkitMaskComposite: 'source-in',
    maskImage: mask,
    maskComposite: 'intersect',
  } as const
}

export function Footage({ rec, segments, camera, highlights, fade, isOpening = false }: FootageProps) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const at = locate(segments, t)
  const screen = screenAt(rec, at.castT)

  // Dip to dark around a cut, where a segment asks for it.
  const segLen = (at.seg.to - at.seg.from) / at.seg.speed
  const dipIn = at.seg.dip ?? 0
  const dipOut = segments[at.i + 1]?.dip ?? 0
  const contentOpacity = Math.min(
    dipIn > 0 ? progress(at.local, 0, dipIn, x => x) : 1,
    dipOut > 0 ? 1 - progress(at.local, segLen - dipOut, segLen, x => x) : 1,
  )

  const cam = cameraAt(rec, camera, t)
  const vb = viewBox(cam)
  const w = world(rec)
  const toScreen = (r: Rect): Rect => ({
    x: (r.x - vb.x) * cam.zoom - PAD,
    y: (r.y - vb.y) * cam.zoom - PAD,
    w: r.w * cam.zoom + PAD * 2,
    h: r.h * cam.zoom + PAD * 2,
  })

  // The highlight on show, if any.
  const boxes: ReactElement[] = []
  const hi = highlights.findIndex(h => t >= h.from && t < h.to)
  if (hi >= 0) {
    const h = highlights[hi]!
    const groups = h.isEach ? h.targets.map(p => [p]) : [h.targets]
    const draw = progress(t, h.from, h.from + 0.55)
    const opacity = 1 - progress(t, h.to - 0.25, h.to, x => x)
    const pulse = 0.5 + 0.5 * Math.sin(((t - h.from - 0.55) / 1.3) * 2 * Math.PI - Math.PI / 2)
    groups.forEach((targets, i) => {
      const found = findOnScreen(rec, screen, targets)
      if (!found) return
      boxes.push(
        <HighlightBox
          key={i}
          rect={toScreen(w.box(found))}
          draw={draw}
          pulse={draw >= 1 ? pulse : 0}
          opacity={opacity}
        />,
      )
    })
  }

  // The frame scales in from 95.5% over 0.45s (power3.out) and fades at the end.
  const pIn = progress(t, 0, 0.45)
  const scale = lerp(0.955, 1, pIn)
  const fadeIn = isOpening ? 1 : progress(t, 0, 0.25, x => x)
  const opacity = Math.min(fadeIn, 1 - progress(t, end - 0.3, end, x => x))
  const pillSpeed = at.seg.speed
  const pillOpacity =
    pillSpeed === 1
      ? 0
      : Math.min(
          progress(at.local, 0, 0.15, x => x),
          1 - progress(at.local, segLen - 0.15, segLen, x => x),
        )

  return (
    <AbsoluteFill style={{ background: C.ground, justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          width: FRAME.w,
          height: FRAME.h,
          borderRadius: FRAME.radius,
          overflow: 'hidden',
          position: 'relative',
          background: C.terminal,
          border: `1px solid ${C.frameBorder}`,
          boxShadow: '0 50px 120px rgba(0,0,0,0.5), 0 12px 32px rgba(0,0,0,0.35)',
          transform: `scale(${scale})`,
          opacity,
        }}
      >
        <svg
          width={FRAME.w}
          height={FRAME.h}
          viewBox={`${vb.x} ${vb.y} ${vb.vw} ${vb.vh}`}
          style={{ position: 'absolute', inset: 0, ...edgeFade(cam.zoom, fade) }}
        >
          <g transform={`translate(${w.padX} ${w.padY})`} opacity={contentOpacity}>
            <TermContent rec={rec} screen={screen} m={M} />
          </g>
        </svg>
        <svg width={FRAME.w} height={FRAME.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs>
            <filter id="coral-glow" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          {boxes}
        </svg>
        <SpeedPill speed={pillSpeed} opacity={pillOpacity} />
      </div>
    </AbsoluteFill>
  )
}
