import type { ReactNode } from 'react'
import { memo } from 'react'

import { C, FONT } from '../theme'
import type { Recording, Run, Screen } from './data'
import { drawGlyph } from './glyphs'

/** JetBrains Mono's advance: 600 units of a 1000-unit em. */
export const ADVANCE = 0.6

export type Metrics = { fontSize: number; cellW: number; lineH: number }

export function metrics(fontSize: number, lineHeight: number): Metrics {
  return { fontSize, cellW: fontSize * ADVANCE, lineH: fontSize * lineHeight }
}

const RowView = memo(function RowView({ runs, y, m }: { runs: Run[]; y: number; m: Metrics }) {
  const top = y * m.lineH
  const mid = top + m.lineH / 2
  const out: ReactNode[] = []
  runs.forEach((run, ri) => {
    const fg = run.fg ?? C.terminalText
    const chars = [...run.t]
    const widths = chars.map((_, i) => run.w?.[i] ?? 1)
    const cols: number[] = []
    let col = run.x
    for (const w of widths) {
      cols.push(col)
      col += w
    }
    if (run.bg) {
      out.push(
        <rect
          key={`bg${ri}`}
          x={run.x * m.cellW}
          y={top}
          width={(col - run.x) * m.cellW}
          height={m.lineH}
          fill={run.bg}
        />,
      )
    }
    // Plain characters share one <text>, each pinned to its own cell.
    let textChars = ''
    let textXs: number[] = []
    const flush = (key: string) => {
      if (textChars === '') return
      out.push(
        <text
          key={key}
          x={textXs.join(' ')}
          y={mid}
          dominantBaseline="central"
          fontFamily={`'${FONT.mono}', 'Apple Symbols', 'Menlo', monospace`}
          fontSize={m.fontSize}
          fontWeight={run.b ? 700 : 400}
          fontStyle={run.i ? 'italic' : 'normal'}
          fill={fg}
          opacity={run.d ? 0.6 : 1}
          xmlSpace="preserve"
          style={{ fontKerning: 'none', fontVariantLigatures: 'none' }}
        >
          {textChars}
        </text>,
      )
      textChars = ''
      textXs = []
    }
    chars.forEach((ch, i) => {
      const x = cols[i]! * m.cellW
      const shape = ch === ' ' ? null : drawGlyph(ch, { x, y: top, w: m.cellW * widths[i]!, h: m.lineH }, fg)
      if (shape) {
        flush(`t${ri}-${i}`)
        out.push(
          <g key={`g${ri}-${i}`} opacity={run.d ? 0.6 : 1}>
            {shape}
          </g>,
        )
      } else if (ch !== ' ') {
        textChars += ch
        textXs.push(x)
      }
    })
    flush(`t${ri}-end`)
    if (run.u) {
      out.push(
        <rect
          key={`u${ri}`}
          x={run.x * m.cellW}
          y={top + m.lineH * 0.86}
          width={(col - run.x) * m.cellW}
          height={Math.max(1, m.fontSize * 0.06)}
          fill={fg}
        />,
      )
    }
  })
  return <g>{out}</g>
})

/** One terminal screen as SVG elements, its top left at (0, 0). */
export function TermContent({ rec, screen, m }: { rec: Recording; screen: Screen; m: Metrics }) {
  return (
    <g>
      {screen.r.map((id, y) => (
        <RowView key={y} runs={rec.rowTable[id]!} y={y} m={m} />
      ))}
      {screen.c ? (
        <rect
          x={screen.c[0] * m.cellW}
          y={screen.c[1] * m.lineH + m.lineH * 0.1}
          width={m.cellW}
          height={m.lineH * 0.8}
          fill={C.terminalText}
          opacity={0.85}
        />
      ) : null}
    </g>
  )
}
