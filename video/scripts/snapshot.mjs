// Replays each asciinema recording in casts/ through a headless xterm and
// writes the screen after every change to public/term/<name>.json. The video
// draws those screens itself, so terminal text stays sharp at any zoom.
//
//   node scripts/snapshot.mjs
import fs from 'node:fs'
import path from 'node:path'

import xterm from '@xterm/headless'

const { Terminal } = xterm
const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'term')

/** Screens closer together than this are merged: the video runs at 30 fps. */
const MIN_GAP = 1 / 120

/** The xterm 256-color palette, for the few cells that use one. */
function palette() {
  const base = [
    '#1a1a1a',
    '#e06c6c',
    '#5cbf7a',
    '#e5c07b',
    '#61afef',
    '#c678dd',
    '#56b6c2',
    '#c9c7c2',
    '#6b6b6b',
    '#ff8585',
    '#7ad694',
    '#f7d06a',
    '#8ab4ff',
    '#d79cf0',
    '#7fd0dc',
    '#ffffff',
  ]
  const hex = n => n.toString(16).padStart(2, '0')
  const steps = [0, 95, 135, 175, 215, 255]
  for (let i = 0; i < 216; i++) {
    const [r, g, b] = [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map(v => steps[v])
    base.push(`#${hex(r)}${hex(g)}${hex(b)}`)
  }
  for (let i = 0; i < 24; i++) base.push(`#${hex(8 + i * 10).repeat(3)}`)
  return base
}
const PALETTE = palette()

function color(cell, which) {
  const isFg = which === 'fg'
  if (isFg ? cell.isFgDefault() : cell.isBgDefault()) return null
  const v = isFg ? cell.getFgColor() : cell.getBgColor()
  if (isFg ? cell.isFgRGB() : cell.isBgRGB()) return `#${v.toString(16).padStart(6, '0')}`
  return PALETTE[v] ?? null
}

/** One screen row as runs of cells that share a style. */
function readRow(line, cols) {
  const runs = []
  const cell = line.getCell(0)
  let run = null
  for (let x = 0; x < cols; x++) {
    line.getCell(x, cell)
    const width = cell.getWidth()
    if (width === 0) continue // the right half of a wide character
    let fg = color(cell, 'fg')
    let bg = color(cell, 'bg')
    if (cell.isInverse()) [fg, bg] = [bg ?? '#1a1a1a', fg ?? '#e8e6e3']
    const style = {
      fg,
      bg,
      b: cell.isBold() ? 1 : 0,
      d: cell.isDim() ? 1 : 0,
      i: cell.isItalic() ? 1 : 0,
      u: cell.isUnderline() ? 1 : 0,
    }
    const ch = cell.getChars() || ' '
    const key = JSON.stringify(style)
    if (run && run.key === key && run.end === x) {
      run.chars.push([ch, width])
      run.end = x + width
    } else {
      run = { key, style, x, end: x + width, chars: [[ch, width]] }
      runs.push(run)
    }
  }
  return runs
    .filter(r => r.style.bg !== null || r.style.u || r.chars.some(([c]) => c.trim() !== ''))
    .map(r => {
      // Trailing spaces draw nothing unless they carry a background.
      let chars = r.chars
      if (r.style.bg === null && !r.style.u) {
        while (chars.length > 0 && chars.at(-1)[0] === ' ') chars = chars.slice(0, -1)
      }
      const out = { x: r.x, t: chars.map(([c]) => c).join('') }
      if (chars.some(([, w]) => w === 2)) out.w = chars.map(([, w]) => w)
      for (const [k, v] of Object.entries(r.style)) if (v) out[k] = v
      return out
    })
}

function write(term, data) {
  return new Promise(resolve => term.write(data, resolve))
}

async function snapshot(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const header = JSON.parse(lines[0])
  const { cols, rows } = header.term
  const term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true })
  const rowIds = new Map()
  const rowList = []
  const frames = []
  let t = 0
  let pending = ''
  let last = null

  const capture = at => {
    const buf = term.buffer.active
    const ids = []
    for (let y = 0; y < rows; y++) {
      const line = buf.getLine(buf.baseY + y)
      const json = JSON.stringify(line ? readRow(line, cols) : [])
      let id = rowIds.get(json)
      if (id === undefined) {
        id = rowList.length
        rowIds.set(json, id)
        rowList.push(JSON.parse(json))
      }
      ids.push(id)
    }
    const hidden = term._core.coreService.isCursorHidden
    const frame = { t: Math.round(at * 1000) / 1000, r: ids, c: hidden ? null : [buf.cursorX, buf.cursorY] }
    const same =
      last && JSON.stringify(last.r) === JSON.stringify(frame.r) && JSON.stringify(last.c) === JSON.stringify(frame.c)
    if (!same) {
      if (last && frame.t - last.t < MIN_GAP) frames.pop()
      frames.push(frame)
      last = frame
    }
  }

  for (const line of lines.slice(1)) {
    const [interval, kind, data] = JSON.parse(line)
    const next = t + interval
    if (pending !== '' && next > t) {
      await write(term, pending)
      pending = ''
      capture(t)
    }
    t = next
    if (kind === 'o') pending += data
    if (kind === 'r') {
      const [c, r] = data.split('x').map(Number)
      term.resize(c, r)
    }
  }
  if (pending !== '') {
    await write(term, pending)
    capture(t)
  }
  return { cols, rows, duration: t, rows_: rowList, frames: steady(frames) }
}

/**
 * Drops screens that last less than TRANSIENT: Claude Code repaints in
 * several writes, and a half-drawn screen caught by a video frame flickers.
 */
const TRANSIENT = 0.05
function steady(frames) {
  return frames.filter((f, i) => i === frames.length - 1 || frames[i + 1].t - f.t >= TRANSIENT)
}

fs.mkdirSync(OUT, { recursive: true })
for (const name of fs.readdirSync(path.join(ROOT, 'casts')).filter(f => f.endsWith('.cast'))) {
  const shot = await snapshot(path.join(ROOT, 'casts', name))
  const out = path.join(OUT, name.replace(/\.cast$/, '.json'))
  const { rows_, ...rest } = shot
  fs.writeFileSync(out, JSON.stringify({ ...rest, rowTable: rows_ }))
  console.log(
    `${name}: ${shot.frames.length} screens, ${rows_.length} rows, ${shot.duration.toFixed(1)}s → ${path.relative(ROOT, out)}`,
  )
}
