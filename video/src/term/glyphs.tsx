import type { ReactNode } from 'react'

/**
 * Characters drawn as shapes instead of font glyphs: box drawing and block
 * elements, so lines and bars join seamlessly at any line height, and the
 * symbols JetBrains Mono lacks, so they look the same on every machine.
 */

export type Cell = { x: number; y: number; w: number; h: number }

// Box drawing: arms [up, right, down, left]; 1 light, 2 heavy, 3 rounded corner.
const BOX: Record<string, [number, number, number, number]> = {
  '─': [0, 1, 0, 1],
  '━': [0, 2, 0, 2],
  '│': [1, 0, 1, 0],
  '┃': [2, 0, 2, 0],
  '┌': [0, 1, 1, 0],
  '┐': [0, 0, 1, 1],
  '└': [1, 1, 0, 0],
  '┘': [1, 0, 0, 1],
  '├': [1, 1, 1, 0],
  '┤': [1, 0, 1, 1],
  '┬': [0, 1, 1, 1],
  '┴': [1, 1, 0, 1],
  '┼': [1, 1, 1, 1],
  '╭': [0, 3, 3, 0],
  '╮': [0, 0, 3, 3],
  '╯': [3, 0, 0, 3],
  '╰': [3, 3, 0, 0],
  '╴': [0, 0, 0, 1],
  '╶': [0, 1, 0, 0],
  '╵': [1, 0, 0, 0],
  '╷': [0, 0, 1, 0],
}

// Quadrants: [upper left, upper right, lower left, lower right].
const QUADRANTS: Record<string, [number, number, number, number]> = {
  '▖': [0, 0, 1, 0],
  '▗': [0, 0, 0, 1],
  '▘': [1, 0, 0, 0],
  '▙': [1, 0, 1, 1],
  '▚': [1, 0, 0, 1],
  '▛': [1, 1, 1, 0],
  '▜': [1, 1, 0, 1],
  '▝': [0, 1, 0, 0],
  '▞': [0, 1, 1, 0],
  '▟': [0, 1, 1, 1],
}

/** Light line width, in cell units of width. */
const LIGHT = 0.1

function boxDrawing(ch: string, c: Cell, color: string): ReactNode | null {
  const arms = BOX[ch]
  if (!arms) return null
  const [up, right, down, left] = arms
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const lw = (n: number) => Math.max(1, c.w * LIGHT * (n === 2 ? 2 : 1))
  const isRounded = arms.includes(3)
  if (isRounded) {
    // A rounded corner: straight in, a curve through the center, straight out.
    const r = c.w / 2
    const ends = {
      up: [cx, c.y],
      right: [c.x + c.w, cy],
      down: [cx, c.y + c.h],
      left: [c.x, cy],
    } as const
    const [a, b] = (
      [
        ['up', up],
        ['right', right],
        ['down', down],
        ['left', left],
      ] as const
    )
      .filter(([, v]) => v)
      .map(([k]) => k)
    const p1 = ends[a!]
    const p2 = ends[b!]
    const toward = (p: readonly [number, number]) =>
      [cx + Math.sign(p[0] - cx) * r, cy + Math.sign(p[1] - cy) * r] as const
    const q1 = toward(p1)
    const q2 = toward(p2)
    const d = `M${p1[0]} ${p1[1]}L${q1[0]} ${q1[1]}C${cx} ${cy} ${cx} ${cy} ${q2[0]} ${q2[1]}L${p2[0]} ${p2[1]}`
    return <path d={d} fill="none" stroke={color} strokeWidth={lw(1)} />
  }
  const parts: ReactNode[] = []
  const w = (n: number) => lw(n) / 2
  if (left)
    parts.push(<rect key="l" x={c.x} y={cy - w(left)} width={c.w / 2 + w(Math.max(up, down))} height={w(left) * 2} />)
  if (right)
    parts.push(
      <rect
        key="r"
        x={cx - w(Math.max(up, down))}
        y={cy - w(right)}
        width={c.w / 2 + w(Math.max(up, down))}
        height={w(right) * 2}
      />,
    )
  if (up)
    parts.push(<rect key="u" x={cx - w(up)} y={c.y} width={w(up) * 2} height={c.h / 2 + w(Math.max(left, right))} />)
  if (down)
    parts.push(
      <rect
        key="d"
        x={cx - w(down)}
        y={cy - w(Math.max(left, right))}
        width={w(down) * 2}
        height={c.h / 2 + w(Math.max(left, right))}
      />,
    )
  return <g fill={color}>{parts}</g>
}

function block(ch: string, c: Cell, color: string): ReactNode | null {
  const code = ch.codePointAt(0)!
  // Blocks overlap their neighbors by a hair, so anti-aliasing leaves no seam between cells.
  const SEAM = 0.6
  if (ch === '█') return <rect x={c.x} y={c.y} width={c.w + SEAM} height={c.h + SEAM} fill={color} />
  if (ch === '▀') return <rect x={c.x} y={c.y} width={c.w} height={c.h / 2} fill={color} />
  if (ch === '▐') return <rect x={c.x + c.w / 2} y={c.y} width={c.w / 2} height={c.h} fill={color} />
  if (ch === '▌') return <rect x={c.x} y={c.y} width={c.w / 2} height={c.h} fill={color} />
  if (ch === '▔') return <rect x={c.x} y={c.y} width={c.w} height={c.h / 8} fill={color} />
  if (code >= 0x2581 && code <= 0x2587) {
    const h = (c.h * (code - 0x2580)) / 8
    return <rect x={c.x} y={c.y + c.h - h} width={c.w} height={h} fill={color} />
  }
  if (code >= 0x2589 && code <= 0x258f) {
    const w = (c.w * (0x2590 - code)) / 8
    return <rect x={c.x} y={c.y} width={w} height={c.h} fill={color} />
  }
  const q = QUADRANTS[ch]
  if (q) {
    const [ul, ur, ll, lr] = q
    const hw = c.w / 2
    const hh = c.h / 2
    return (
      <g fill={color}>
        {ul ? <rect x={c.x} y={c.y} width={hw + SEAM} height={hh + SEAM} /> : null}
        {ur ? <rect x={c.x + hw} y={c.y} width={hw + SEAM} height={hh + SEAM} /> : null}
        {ll ? <rect x={c.x} y={c.y + hh} width={hw + SEAM} height={hh + SEAM} /> : null}
        {lr ? <rect x={c.x + hw} y={c.y + hh} width={hw + SEAM} height={hh + SEAM} /> : null}
      </g>
    )
  }
  if (ch === '░' || ch === '▒') {
    // The banner's texture: staggered square dots, a quarter (░) or half (▒) of the cell.
    const dot = c.w / 4
    const perRow = ch === '░' ? 2 : 4
    const rowsOfDots = Math.max(1, Math.round(c.h / (dot * 2)))
    const pitchY = c.h / rowsOfDots
    const rects: ReactNode[] = []
    for (let i = 0; i < rowsOfDots; i++) {
      const y = c.y + i * pitchY + (pitchY - dot) / 2
      const shift = ch === '░' && i % 2 === 1 ? dot : 0
      for (let j = 0; j < perRow; j++) {
        rects.push(<rect key={`${i}-${j}`} x={c.x + shift + (j * c.w) / perRow} y={y} width={dot} height={dot} />)
      }
    }
    return <g fill={color}>{rects}</g>
  }
  if (ch === '▓') return <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={color} opacity={0.75} />
  return null
}

/** Petals around the center, as in the README art. */
function petals(cx: number, cy: number, n: number, d: number, rx: number, ry: number, turn = 0): string {
  let p = ''
  for (let i = 0; i < n; i++) {
    const a = turn + (i * 2 * Math.PI) / n
    const [ex, ey] = [cx + d * Math.cos(a), cy + d * Math.sin(a)]
    const [dx, dy] = [rx * Math.cos(a), rx * Math.sin(a)]
    const deg = (a * 180) / Math.PI
    p += `M${ex - dx} ${ey - dy}A${rx} ${ry} ${deg} 0 1 ${ex + dx} ${ey + dy}A${rx} ${ry} ${deg} 0 1 ${ex - dx} ${ey - dy}Z`
  }
  return p
}

function symbol(ch: string, c: Cell, color: string): ReactNode | null {
  const cx = c.x + c.w / 2
  // Symbols sit on the text's center line, a little above the cell's middle.
  const cy = c.y + c.h * 0.48
  const s = c.w // the glyph box: one cell wide, square
  switch (ch) {
    case '⏺':
      return <circle cx={cx} cy={cy} r={s * 0.38} fill={color} />
    case '⎿': {
      const lw = Math.max(1, s * 0.1)
      return (
        <path
          d={`M${c.x + s * 0.25} ${c.y}V${cy + s * 0.08}H${c.x + c.w}`}
          fill="none"
          stroke={color}
          strokeWidth={lw}
        />
      )
    }
    case '⏵': {
      const r = s * 0.36
      return <path d={`M${cx - r * 0.7} ${cy - r}L${cx + r * 0.9} ${cy}L${cx - r * 0.7} ${cy + r}Z`} fill={color} />
    }
    case '✽':
      return <path d={petals(cx, cy, 8, s * 0.25, s * 0.24, s * 0.085)} fill={color} />
    case '✻':
      return <path d={petals(cx, cy, 8, s * 0.24, s * 0.22, s * 0.06, Math.PI / 8)} fill={color} />
    case '✢':
      return <path d={petals(cx, cy, 4, s * 0.23, s * 0.22, s * 0.09)} fill={color} />
    case '✳': {
      const r = s * 0.42
      const lw = Math.max(1, s * 0.11)
      let d = ''
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4
        d += `M${cx - r * Math.cos(a)} ${cy - r * Math.sin(a)}L${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
      }
      return <path d={d} stroke={color} strokeWidth={lw} strokeLinecap="round" fill="none" />
    }
    case '✶': {
      const [ro, ri] = [s * 0.44, s * 0.2]
      let d = ''
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 6
        const r = i % 2 === 0 ? ro : ri
        d += `${i === 0 ? 'M' : 'L'}${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
      }
      return <path d={d + 'Z'} fill={color} />
    }
    case '✔': {
      const lw = Math.max(1, s * 0.14)
      return (
        <path
          d={`M${cx - s * 0.32} ${cy + s * 0.02}L${cx - s * 0.08} ${cy + s * 0.28}L${cx + s * 0.34} ${cy - s * 0.3}`}
          stroke={color}
          strokeWidth={lw}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    }
    case '✖': {
      const r = s * 0.28
      const lw = Math.max(1, s * 0.14)
      return (
        <path
          d={`M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`}
          stroke={color}
          strokeWidth={lw}
          strokeLinecap="round"
        />
      )
    }
    default:
      return null
  }
}

/** A shape for `ch`, or null to draw it as text. */
export function drawGlyph(ch: string, c: Cell, color: string): ReactNode | null {
  const code = ch.codePointAt(0)!
  if (code >= 0x2500 && code <= 0x257f) return boxDrawing(ch, c, color)
  if (code >= 0x2580 && code <= 0x259f) return block(ch, c, color)
  return symbol(ch, c, color)
}
