// Builds the README images in assets/. Text is converted to outlines, so the
// SVGs look the same on every machine, with no font to load.
//
//   cd assets/src && npm install && npm run build
//
// The social preview PNG is drawn with Google Chrome (playwright-core).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import opentype from 'opentype.js'
import { chromium } from 'playwright-core'

const OUT = path.resolve(import.meta.dirname, '..')

// ---- Fonts -----------------------------------------------------------------

// Both are SIL Open Font License fonts, fetched once into a cache.
const FONT_URLS = {
  mono: 'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-Regular.ttf',
  bold: 'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-Bold.ttf',
  pixel: 'https://cdn.jsdelivr.net/gh/rektdeckard/departure-mono@v1.500/public/assets/DepartureMono-Regular.otf',
}

async function loadFont(url) {
  const cache = path.join(os.tmpdir(), 'claude-load-fonts')
  const file = path.join(cache, path.basename(url))
  let buf
  try {
    buf = fs.readFileSync(file)
  } catch {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(file, buf)
  }
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

const FONTS = Object.fromEntries(
  await Promise.all(Object.entries(FONT_URLS).map(async ([key, url]) => [key, await loadFont(url)])),
)

// Glyphs JetBrains Mono does not have, drawn in its units (600 wide, baseline 0).
function petals() {
  const [cx, cy, d, rx, ry] = [300, -340, 150, 145, 52]
  let p = ''
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const [ex, ey] = [cx + d * Math.cos(a), cy + d * Math.sin(a)]
    const [dx, dy] = [rx * Math.cos(a), rx * Math.sin(a)]
    const deg = (a * 180) / Math.PI
    p += `M${ex - dx} ${ey - dy}A${rx} ${ry} ${deg} 0 1 ${ex + dx} ${ey + dy}A${rx} ${ry} ${deg} 0 1 ${ex - dx} ${ey - dy}Z`
  }
  return p
}
const CUSTOM = {
  '✽': petals(),
  '⏺': 'M300 -540A195 195 0 1 1 300 -150A195 195 0 1 1 300 -540Z',
  '⎿': 'M150 -1000H210V-400H600V-340H150Z',
}

const r = n => Math.round(n * 100) / 100

/** One SVG document: collects the glyphs its text uses into <defs>. */
class Doc {
  constructor() {
    this.glyphs = new Map()
  }

  glyph(font, ch) {
    const id = `${font}-${ch.codePointAt(0).toString(16)}`
    if (!this.glyphs.has(id)) {
      const f = FONTS[font]
      const custom = font !== 'pixel' ? CUSTOM[ch] : undefined
      const g = f.charToGlyph(ch)
      if (custom === undefined && g.index === 0) throw new Error(`no glyph for ${ch} in ${font}`)
      this.glyphs.set(id, custom ?? g.getPath(0, 0, f.unitsPerEm).toPathData(1))
    }
    return id
  }

  static advance(font) {
    return FONTS[font].charToGlyph('0').advanceWidth
  }

  static width(text, size, font = 'mono') {
    return ([...text].length * Doc.advance(font) * size) / FONTS[font].unitsPerEm
  }

  /**
   * A line of text at baseline `y`. `runs` is a string or a list of
   * [text, fill, font?]; a run's font defaults to `font`.
   */
  text(runs, { x, y, size, font = 'mono', fill = 'currentColor', anchor = 'start' }) {
    if (typeof runs === 'string') runs = [[runs, fill]]
    const all = runs.map(([t]) => t).join('')
    const w = Doc.width(all, size, font)
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x
    const adv = Doc.advance(font)
    let i = 0
    const parts = runs.map(([t, f, runFont = font]) => {
      const uses = [...t]
        .map(ch => {
          const at = i++
          return ch === ' ' ? '' : `<use href="#${this.glyph(runFont, ch)}" x="${at * adv}"/>`
        })
        .join('')
      return uses === '' ? '' : `<g fill="${f}">${uses}</g>`
    })
    const k = size / FONTS[font].unitsPerEm
    return `<g transform="translate(${r(x0)} ${r(y)}) scale(${r(k * 1e5) / 1e5})">${parts.join('')}</g>`
  }

  svg({ width, height, body, style = '', title, desc }) {
    const defs = [...this.glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('\n')
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
      `<title id="title">${title}</title>`,
      `<desc id="desc">${desc}</desc>`,
      style ? `<style>${style}</style>` : '',
      `<defs>\n${defs}\n</defs>`,
      body,
      '</svg>',
      '',
    ].join('\n')
  }
}

// ---- Palette ---------------------------------------------------------------

const C = {
  ink: '#191C36', // banner and terminal ground
  inkDeep: '#12142A',
  amber: '#F7B24A', // the filled part of the bar
  paper: '#F2EBDD',
  mist: '#9298BE',
  line: '#2C3158',
  // Claude Code's own terminal colors.
  claude: '#D97757',
  yellow: '#F2C14E',
  green: '#5CBF7A',
  text: '#E4E2EC',
  dim: '#8C91AE',
}

/** Banner and social preview: the size of one dot of the ░ texture. */
const DOT = 8
/** The empty part of the bar: amber dots, dimmed toward the ground. */
const SHADE = '#A57A47'

/**
 * The ░ texture as one path: a staggered dot covering 25% of the area, as in
 * the glyph. Dots that touch a hole are left out, so text sits on clean ground.
 */
function shade({ x0, y0, x1, y1, fill = SHADE, dot = DOT, holes = [] }) {
  let d = ''
  for (let y = y0, row = 0; y + dot <= y1; y += dot, row++) {
    for (let x = x0 + (row % 2) * 2 * dot; x + dot <= x1; x += 4 * dot) {
      const isHole = holes.some(h => x + dot > h.left && x < h.right && y + dot > h.top && y < h.bottom)
      if (!isHole) d += `M${x} ${y}h${dot}v${dot}h-${dot}z`
    }
  }
  return `<path d="${d}" fill="${fill}"/>`
}

/** A text label and the block of clean ground around it, on the dot grid. */
function label(doc, text, { x, y, size, font = 'mono', fill, pad = 14 }) {
  const w = Doc.width(text, size, font)
  const isPixel = font === 'pixel'
  const snap = (n, up) => (up ? Math.ceil(n / DOT) : Math.floor(n / DOT)) * DOT
  const box = {
    left: snap(x - pad * 1.4, false),
    right: snap(x + w + pad * 1.4, true),
    top: snap(y - size * (isPixel ? 400 / 550 : 0.76) - pad, false),
    bottom: snap(y + size * (isPixel ? 100 / 550 : 0.24) + pad, true),
  }
  return { box, svg: doc.text(text, { x, y, size, font, fill }) }
}

/**
 * The banner, 1280×320: the bar at full width, amber up to 3/8 with the word
 * on it, then the ░ texture with the labels cut out of it.
 */
function band(doc) {
  const [W, H] = [1280, 320]
  const split = (W * 3) / 8 // ███░░░░░
  const labels = [
    label(doc, 'How long will this task take?', { x: 552, y: 132, size: 33, font: 'pixel', fill: C.paper }),
    label(doc, 'A live countdown for Claude Code', { x: 552, y: 204, size: 20, fill: C.mist }),
  ]
  return [
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>`,
    shade({ x0: split, y0: 0, x1: W, y1: H, holes: labels.map(l => l.box) }),
    `<rect width="${split}" height="${H}" fill="${C.amber}"/>`,
    // Departure Mono is drawn on an 11 px grid: at 154 px, a dot is 14 px.
    doc.text('load', { x: split / 2, y: 216, size: 154, font: 'pixel', fill: C.ink, anchor: 'middle' }),
    ...labels.map(l => l.svg),
  ].join('\n')
}

// ---- Banner: 1280×320 ------------------------------------------------------

function banner() {
  const doc = new Doc()
  const [W, H] = [1280, 320]
  const body = band(doc)
  return doc.svg({
    width: W,
    height: H,
    body,
    title: 'load',
    desc: 'The word load on the filled part of a progress bar, and the question: how long will this task take?',
  })
}

// ---- Terminal: the countdown in a Claude Code session ----------------------

const TERM = { w: 880, size: 14, lh: 24, pad: 28, top: 40 }
const TASK = 'Build CLI calculator, tests, commit, push'

const tool = (name, args) => [['⏺ ', C.green], [name, C.text, 'bold'], [`(${args})`, C.text]]
const out = text => [['  ⎿  ', C.dim], [text, C.dim]]
const said = text => [['⏺ ', C.text], [text, C.text]]
const typed = text => [['> ', C.dim], [text, C.dim]]

// Each frame is one moment of the same task. The numbers agree with each
// other: est 4m, 2m of work, 3m waiting on you, overrun, est 5m, done in 5m.
const FRAMES = [
  {
    s: 2.8,
    tail: [tool('Write', 'tests/calc.test.ts'), out('Wrote 58 lines to tests/calc.test.ts')],
    spinner: ['~3m left', '(33s · ↓ 2.9k tokens)'],
    status: `██░░░░░░ ~3m left · est 4m · ${TASK}`,
  },
  {
    s: 2.8,
    tail: [tool('Bash', 'npm test'), out('2 failed, 14 passed')],
    spinner: ['~2m left', '(1m 41s · ↓ 6.0k tokens)'],
    status: `████░░░░ ~2m left · est 4m · ${TASK}`,
  },
  {
    s: 3.6,
    tail: [said('Should 1/0 print an error, or exit with code 1?'), []],
    spinner: null,
    status: `████░░░░ ~2m left · est 4m · paused · ${TASK}`,
  },
  {
    s: 2.8,
    tail: [typed('exit with code 1'), tool('Update', 'src/calc.ts')],
    spinner: ['~1m left', '(14s · ↓ 1.1k tokens)'],
    status: `██████░░ ~1m left · est 4m · ${TASK}`,
  },
  {
    s: 2.8,
    tail: [tool('Bash', 'npm test'), out('1 failed, 15 passed')],
    spinner: ['re-estimating…', '(1m 12s · ↓ 4.0k tokens)'],
    status: `████████ re-estimating… · 4m so far · ${TASK}`,
  },
  {
    s: 2.8,
    tail: [tool('Update', 'src/calc.ts'), out('Updated src/calc.ts with 4 additions')],
    spinner: ['~1m left', '(1m 30s · ↓ 4.6k tokens)'],
    status: `███████░ ~1m left · est 5m · ${TASK}`,
  },
  {
    s: 4.0,
    tail: [tool('Bash', 'git push'), out('main -> main')],
    spinner: null,
    toast: 'Done in 5m (estimated 4m) · 3m waiting on you',
  },
]

function terminal() {
  const doc = new Doc()
  const { w, size, lh, pad, top } = TERM
  const lines = 13
  const h = top + 22 + lines * lh + 20
  const y = i => top + 22 + i * lh + 8 // baseline of line i (0-based)
  const cw = Doc.width('0', size)
  const line = (runs, i) => (runs.length === 0 ? '' : doc.text(runs, { x: pad, y: y(i), size }))

  const fixed = [
    // Window
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.ink}" stroke="${C.line}"/>`,
    `<path d="M0.5 ${top}V12.5A12 12 0 0 1 12.5 0.5H${w - 12.5}A12 12 0 0 1 ${w - 0.5} 12.5V${top}Z" fill="${C.inkDeep}"/>`,
    `<rect x="0" y="${top}" width="${w}" height="1" fill="${C.line}"/>`,
    ...[0, 1, 2].map(i => `<circle cx="${22 + i * 20}" cy="${top / 2}" r="6" fill="${C.line}"/>`),
    doc.text('~/calc — claude', { x: w / 2, y: top / 2 + 4.5, size: 13, fill: C.dim, anchor: 'middle' }),
    // The prompt the task came from
    `<rect x="${pad - 8}" y="${y(0) - 17}" width="${w - 2 * pad + 16}" height="${lh}" rx="3" fill="${C.line}" opacity="0.55"/>`,
    line(typed('Build a CLI calculator with tests, then commit and push.'), 0),
    line(tool('Update', 'src/calc.ts'), 2),
    line(out('Updated src/calc.ts with 42 additions'), 3),
    // Input box
    `<rect x="${pad - 8}" y="${y(9) + 6}" width="${w - 2 * pad + 16}" height="1" fill="${C.dim}" opacity="0.6"/>`,
    line([['> ', C.text]], 10),
    `<rect class="cursor" x="${pad + 2 * cw}" y="${y(10) - 13}" width="${cw}" height="17" fill="${C.text}" opacity="0.85"/>`,
    `<rect x="${pad - 8}" y="${y(11) + 6}" width="${w - 2 * pad + 16}" height="1" fill="${C.dim}" opacity="0.6"/>`,
  ]

  const frames = FRAMES.map((f, i) => {
    const parts = [line(f.tail[0], 5), line(f.tail[1] ?? [], 6)]
    if (f.spinner) {
      const [left, meta] = f.spinner
      parts.push(line([['✽ ', C.claude], [`Gusting… ${left} `, C.claude], [meta, C.dim]], 8))
    }
    if (f.status) parts.push(line([['⚠ load: ', C.yellow], [f.status, C.text]], 12))
    if (f.toast) parts.push(line([[f.toast, C.text]], 12))
    return `<g class="f f${i}">${parts.join('')}</g>`
  })

  const total = FRAMES.reduce((sum, f) => sum + f.s, 0)
  let at = 0
  const keyframes = FRAMES.map((f, i) => {
    const a = (at / total) * 100
    at += f.s
    const b = (at / total) * 100
    const on = i === 0 ? `0%,${r(b - 0.01)}%{opacity:1}` : `0%,${r(a - 0.01)}%{opacity:0}${r(a)}%,${r(b - 0.01)}%{opacity:1}`
    const off = i === FRAMES.length - 1 ? '' : `${r(b)}%,100%{opacity:0}`
    return `@keyframes f${i}{${on}${off}}.f${i}{animation:f${i} ${total}s infinite}`
  })
  const style = [
    '.f{opacity:0}.f0{opacity:1}',
    ...keyframes,
    '@keyframes blink{0%,49%{opacity:.85}50%,100%{opacity:0}}.cursor{animation:blink 1.1s infinite}',
    '@media (prefers-reduced-motion:reduce){.f,.cursor{animation:none}}',
  ].join('\n')

  return doc.svg({
    width: w,
    height: h,
    style,
    body: [...fixed, ...frames].join('\n'),
    title: 'load in a Claude Code session',
    desc:
      'The spinner reads: Gusting… ~3m left. The status line under the prompt reads: ⚠ load: ██░░░░░░ ~3m left · est 4m · ' +
      `${TASK}. The countdown pauses while Claude waits for an answer, re-estimates when it runs out, and ends with: Done in 5m (estimated 4m) · 3m waiting on you.`,
  })
}

// ---- How it works: one task, start to end, and what it teaches the next --

const THEMES = {
  light: { text: '#1F2340', mist: '#5D6385', rule: '#C9CCDD', shade: '#B9BCD3', amber: '#F2A93B', over: '#E0694A', on: '#191C36' },
  dark: { text: '#ECE6DA', mist: '#9BA0C2', rule: '#3A4068', shade: '#4A5080', amber: '#F7B24A', over: '#EF7A57', on: '#191C36' },
}

function lifecycle(theme) {
  const t = THEMES[theme]
  const doc = new Doc()
  const [W, H] = [1000, 450]
  const s = 14 // body text size
  const txt = (runs, o) => doc.text(runs, { size: s, fill: t.mist, ...o })
  const title = (text, x, y) => doc.text(text, { x, y, size: 22, font: 'pixel', fill: t.text })
  const arrow = (x, y, dir) => {
    const k = 6
    const pts = {
      left: [[x, y], [x + k * 1.5, y - k], [x + k * 1.5, y + k]],
      right: [[x, y], [x - k * 1.5, y - k], [x - k * 1.5, y + k]],
    }[dir]
    return `<path d="M${pts.map(p => p.join(' ')).join('L')}Z" fill="${t.mist}"/>`
  }
  const line = d => `<path d="${d}" fill="none" stroke="${t.mist}" stroke-width="1.5"/>`

  // Wall-clock minutes: 2 working, 3 waiting on you, 2 working, 1 past the estimate.
  const [x0, x1] = [60, 960]
  const xs = [0, 2, 5, 7, 8].map(m => x0 + ((x1 - x0) * m) / 8)
  const [top, bottom] = [140, 180]
  const mid = (a, b) => (a + b) / 2
  const seg = (a, b, fill, label, color) => [
    `<rect x="${a}" y="${top}" width="${b - a}" height="${bottom - top}" fill="${fill}"/>`,
    doc.text(label, { x: mid(a, b), y: top + 25, size: s, fill: color, anchor: 'middle', font: 'bold' }),
  ]
  const waitLabel = 'you 3m'
  const waitW = Doc.width(waitLabel, s) + 24
  const hole = { left: mid(xs[1], xs[2]) - waitW / 2, right: mid(xs[1], xs[2]) + waitW / 2, top, bottom }

  const estY = 112
  const body = [
    // Events
    doc.text('first edit', { x: x0, y: 40, size: s, fill: t.text, font: 'bold' }),
    txt('opens the task', { x: x0, y: 60 }),
    doc.text('estimate runs out', { x: xs[3] - 10, y: 40, size: s, fill: t.text, font: 'bold', anchor: 'end' }),
    txt('re-estimate', { x: xs[3] - 10, y: 60, anchor: 'end' }),
    doc.text('git push', { x: x1, y: 40, size: s, fill: t.text, font: 'bold', anchor: 'end' }),
    txt('task closes', { x: x1, y: 60, anchor: 'end' }),
    ...[x0, xs[3], x1].map(x => `<rect x="${x - 0.75}" y="70" width="1.5" height="${top - 70}" fill="${t.rule}"/>`),
    // The estimate counts agent time only: it skips the wait.
    txt([['background estimate: ', t.mist], ['p50 4m', t.text], [' · p90 9m', t.mist]], { x: x0 + 10, y: estY - 12 }),
    line(`M${x0} ${estY + 8}V${estY}H${xs[1]}M${xs[2]} ${estY}H${xs[3]}V${estY + 8}`),
    `<path d="M${xs[1] + 6} ${estY}H${xs[2] - 6}" stroke="${t.mist}" stroke-width="1.5" stroke-dasharray="3 5"/>`,
    // The task
    ...seg(xs[0], xs[1], t.amber, 'agent 2m', t.on),
    `<rect x="${xs[1] + 0.75}" y="${top + 0.75}" width="${xs[2] - xs[1] - 1.5}" height="${bottom - top - 1.5}" fill="none" stroke="${t.rule}" stroke-width="1.5"/>`,
    shade({ x0: xs[1] + 4, y0: top + 4, x1: xs[2] - 4, y1: bottom - 4, fill: t.shade, dot: 4, holes: [hole] }),
    doc.text(waitLabel, { x: mid(xs[1], xs[2]), y: top + 25, size: s, fill: t.text, anchor: 'middle', font: 'bold' }),
    ...seg(xs[2], xs[3], t.amber, 'agent 2m', t.on),
    ...seg(xs[3], xs[4], t.over, '+1m', t.on),
    // What the status line says meanwhile
    txt('~3m left', { x: mid(xs[0], xs[1]), y: 212, anchor: 'middle' }),
    txt('paused', { x: mid(xs[1], xs[2]), y: 212, anchor: 'middle' }),
    txt('~1m left', { x: mid(xs[2], xs[3]), y: 212, anchor: 'middle' }),
    txt('re-estimating…', { x: x1, y: 212, anchor: 'end' }),
  ]

  // After the push: right to left, back into the next estimate.
  const [bTop, bBottom] = [262, 424]
  const boxes = [
    [670, 960, 'done', ['A toast at the push:', 'Done in 5m (estimated 4m)', '· 3m waiting on you']],
    [365, 640, 'why', ['The model says in one or', 'two sentences why it took', 'longer or shorter.']],
    [60, 335, 'learn', ['40 past tasks go into the', 'next estimate. After 3, it', 'is scaled by their median', 'of actual ÷ estimate.']],
  ]
  for (const [a, b, name, lines] of boxes) {
    body.push(
      `<rect x="${a + 0.75}" y="${bTop + 0.75}" width="${b - a - 1.5}" height="${bBottom - bTop - 1.5}" rx="8" fill="none" stroke="${t.rule}" stroke-width="1.5"/>`,
      title(name, a + 20, bTop + 38),
      ...lines.map((l, i) => txt(l, { x: a + 20, y: bTop + 70 + i * 22, fill: name === 'done' && i > 0 ? t.text : t.mist })),
    )
  }
  const bMid = mid(bTop, bBottom)
  body.push(
    line(`M${x1} ${mid(top, bottom)}H${x1 + 22}V${bMid}H${x1 + 8}`),
    arrow(x1 + 1, bMid, 'left'),
    ...boxes.slice(1).flatMap(([, b], i) => [line(`M${boxes[i][0]} ${bMid}H${b + 10}`), arrow(b + 2, bMid, 'left')]),
    line(`M${x0} ${bMid}H${x0 - 30}V${estY}H${x0 - 8}`),
    arrow(x0 - 1, estY, 'right'),
  )
  return doc.svg({
    width: W,
    height: H,
    body: body.join('\n'),
    title: 'How load times a task',
    desc:
      'The first edit opens a task. A background estimate gives p50 4m. The agent works 2 minutes, then waits 3 minutes on you: ' +
      'the clock pauses. It works 2 more minutes, the estimate runs out, and it re-estimates. git push closes the task after 1 more minute. ' +
      'A toast says Done in 5m (estimated 4m) · 3m waiting on you. The model explains why, and past tasks tune the next estimate.',
  })
}

// ---- Social preview: 1280×640 --------------------------------------------

function social() {
  const doc = new Doc()
  const [W, H] = [1280, 640]
  const x = 72
  const body = [
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>`,
    band(doc),
    doc.text([['✽ ', C.claude], ['Gusting… ~3m left ', C.claude], ['(33s · ↓ 2.9k tokens)', C.dim]], { x, y: 410, size: 28 }),
    doc.text([['⚠ load: ', C.yellow], ['██░░░░░░ ~3m left · est 4m', C.text]], { x, y: 466, size: 28 }),
    `<rect x="${x}" y="530" width="${W - 2 * x}" height="1" fill="${C.line}"/>`,
    doc.text('/plugin install load --marketplace awlevin/claude-load', { x, y: 584, size: 22, fill: C.mist }),
  ].join('\n')
  return doc.svg({
    width: W,
    height: H,
    body,
    title: 'load: a live countdown for Claude Code',
    desc: 'The load banner, the spinner and status line with ~3m left, and the install command.',
  })
}

// ---- Output ----------------------------------------------------------------

const outputs = {
  'banner.svg': banner(),
  'terminal.svg': terminal(),
  'how-it-works-light.svg': lifecycle('light'),
  'how-it-works-dark.svg': lifecycle('dark'),
  'src/social-preview.svg': social(),
}
for (const [name, svg] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(OUT, name), svg)
  console.log(`${name}  ${(svg.length / 1024).toFixed(1)} KB`)
}

/** Draws an SVG into a transparent PNG at its own size, with Google Chrome. */
export async function rasterize(svgFile, pngFile, { time = null } = {}) {
  const svg = fs.readFileSync(svgFile, 'utf8')
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg)
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-gpu'] })
  const page = await browser.newPage({ viewport: { width: +w, height: +h } })
  await page.goto(`file://${path.resolve(svgFile)}`)
  if (time !== null) {
    await page.evaluate(t => document.getAnimations().forEach(a => ((a.currentTime = t * 1000), a.pause())), time)
  }
  await page.screenshot({ path: pngFile, omitBackground: true })
  await browser.close()
}

// GitHub's social preview size is 1280×640; it is uploaded by hand in the
// repository settings.
if (process.argv[1] === import.meta.filename) {
  await rasterize(path.join(OUT, 'src/social-preview.svg'), path.join(OUT, 'social-preview.png'))
  console.log('social-preview.png')
}
