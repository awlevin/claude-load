import { useCurrentFrame, useVideoConfig } from 'remotion'

import { lerp, progress } from '../motion'
import { C, FONT } from '../theme'

/**
 * How far each demo task's first estimate missed, oldest first, from the
 * recorded `/load stats` table (Result column). Calibration starts at the 4th.
 */
export const MISSES = [10.1, 5.5, 2.5, 2.2, 2.1, 1.3, 1.3, 1.2]
const CALIBRATED_FROM = 3

/** A row of bars, one per task: the miss factor, shrinking as the repo calibrates. */
export function MissChart({ start }: { start: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const H = 250
  const barW = 132
  const gap = 38
  const maxLog = Math.log(MISSES[0]!)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap, marginTop: 8 }}>
        {MISSES.map((m, i) => {
          const p = progress(t, start + i * 0.06, start + i * 0.06 + 0.45)
          const h = lerp(6, 6 + (H - 6) * (Math.log(m) / maxLog), p)
          const isCalibrated = i >= CALIBRATED_FROM
          return (
            <div
              key={i}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: barW }}
            >
              <div
                style={{
                  fontFamily: FONT.sans,
                  fontWeight: 500,
                  fontSize: 52,
                  color: isCalibrated ? C.punch : C.setup,
                  opacity: p,
                }}
              >
                {m.toFixed(1)}×
              </div>
              <div
                style={{ width: barW, height: h, borderRadius: 10, background: isCalibrated ? C.punch : '#4A4945' }}
              />
            </div>
          )
        })}
      </div>
      <div style={{ fontFamily: FONT.sans, fontWeight: 500, fontSize: 48, color: C.setup, letterSpacing: '-0.01em' }}>
        Estimate error, task by task
      </div>
    </div>
  )
}
