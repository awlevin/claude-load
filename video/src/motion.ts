import { interpolate } from 'remotion'

import { FPS, power3Out } from './theme'

/** Seconds to frames. */
export const sec = (s: number) => Math.round(s * FPS)

/** 0 → 1 between seconds `from` and `to`, eased. */
export function progress(t: number, from: number, to: number, ease: (x: number) => number = power3Out): number {
  return ease(interpolate(t, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
}

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p
