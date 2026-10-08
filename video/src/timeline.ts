// The cut: every shot, in order. Footage times are seconds into the real
// recordings (casts/*.cast); see scripts/snapshot.mjs.
import type { CameraKey, Highlight, Segment } from './shots/Footage'

export type Shot =
  | { id: string; kind: 'card'; seconds: number; setup: string; punch: string; punchAt?: number; chart?: boolean }
  | { id: string; kind: 'title' | 'end'; seconds: number }
  | {
      id: string
      kind: 'footage'
      rec: 'hero' | 'stats'
      segments: Segment[]
      camera: CameraKey[]
      highlights: Highlight[]
      fade?: { top?: number; left?: number; right?: number }
    }

/** The spinner and the status line, at the bottom left of the screen, tight. */
const BOTTOM_LEFT = { r0: 24, r1: 32, c0: 0, c1: 30 }
const TIGHT = 3.7

export const SHOTS: Shot[] = [
  {
    // The hook: the countdown, ticking.
    id: 'hook',
    kind: 'footage',
    rec: 'hero',
    segments: [{ from: 132.8, to: 136.3, speed: 1 }],
    camera: [{ at: 0, focus: BOTTOM_LEFT, zoom: TIGHT, align: 'left' }],
    highlights: [
      // The spinner's countdown, then the status line's bar.
      { from: 0.15, to: 1.65, targets: [/~\d+m left(?= \()/] },
      { from: 1.75, to: 3.5, targets: [/█+░*\s+~?\S+ left/] },
    ],
  },
  {
    id: 'problem',
    kind: 'card',
    seconds: 2.9,
    setup: 'Every coding agent says working, done, or needs input.',
    punch: 'None of them say how long.',
    punchAt: 0.9,
  },
  { id: 'title', kind: 'title', seconds: 2.2 },
  {
    // Claude asks before it commits: the clock pauses.
    id: 'paused',
    kind: 'footage',
    rec: 'hero',
    segments: [
      { from: 136.4, to: 149.2, speed: 8 },
      { from: 149.2, to: 151.4, speed: 1 },
    ],
    camera: [
      { at: 0, focus: BOTTOM_LEFT, zoom: TIGHT, align: 'left' },
      // Out a little, so Claude's question and the paused clock share the frame.
      { at: 1.6, focus: { r0: 20, r1: 32, c0: 0, c1: 50 }, align: 'left', dur: 0.6 },
    ],
    highlights: [{ from: 2.2, to: 3.8, targets: [/paused/] }],
  },
  {
    id: 'your-time',
    kind: 'card',
    seconds: 2.2,
    setup: 'The clock pauses while Claude waits on you.',
    punch: 'Your time ≠ agent time.',
    punchAt: 0.6,
  },
  {
    // The push closes the task: the toast.
    id: 'push',
    kind: 'footage',
    rec: 'hero',
    segments: [{ from: 229.75, to: 232.7, speed: 1 }],
    camera: [{ at: 0, focus: { r0: 30, r1: 32, c0: 60, c1: 122 }, free: true }],
    highlights: [{ from: 0.35, to: 2.95, targets: [/loading: Done in .* waiting on you/] }],
    fade: { top: 420 },
  },
  {
    id: 'stats',
    kind: 'footage',
    rec: 'stats',
    segments: [
      { from: 12.0, to: 15.0, speed: 1 },
      { from: 20.2, to: 23.0, speed: 1, dip: 0.2 },
    ],
    camera: [
      { at: 0, focus: { r0: 10, r1: 16, c0: 0, c1: 35 }, align: 'left' },
      { at: 3.0, focus: { r0: 8, r1: 17, c0: 75, c1: 118 }, dur: 0.01 },
    ],
    highlights: [
      { from: 0.5, to: 3.0, targets: [/Off by ×[\d.]+/, /baseline: ×[\d.]+/], isEach: true },
      { from: 3.6, to: 5.8, targets: [/Result/, /[~✓✗] [\d.]+× (?:slower|faster)/] },
    ],
  },
  {
    id: 'latency',
    kind: 'card',
    seconds: 2.4,
    setup: 'Estimates run on a background fork of the prompt cache.',
    punch: 'Zero added latency.',
    punchAt: 0.6,
  },
  {
    id: 'learns',
    kind: 'card',
    seconds: 3.0,
    setup: 'After 3 tasks, it calibrates to the repo.',
    punch: 'Learns each repo.',
    punchAt: 0.5,
    chart: true,
  },
  {
    id: 'explains',
    kind: 'card',
    seconds: 2.6,
    setup: '“Most of the time went into reading the code and designing the template rules.”',
    punch: 'Explains every miss.',
    punchAt: 0.8,
  },
  { id: 'end', kind: 'end', seconds: 3.2 },
]
