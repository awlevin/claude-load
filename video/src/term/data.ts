import { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion'

/** A run of cells with one style, as scripts/snapshot.mjs writes it. */
export type Run = {
  x: number
  t: string
  /** Cell widths per character, present only when a character is wide. */
  w?: number[]
  fg?: string
  bg?: string
  b?: 1
  d?: 1
  i?: 1
  u?: 1
}

export type Screen = { t: number; r: number[]; c: [number, number] | null }

export type Recording = {
  cols: number
  rows: number
  duration: number
  frames: Screen[]
  rowTable: Run[][]
}

export type Recordings = { hero: Recording; stats: Recording }

const cache = new Map<string, Promise<Recording>>()

function fetchRecording(name: string): Promise<Recording> {
  let p = cache.get(name)
  if (!p) {
    p = fetch(staticFile(`term/${name}.json`)).then(res => {
      if (!res.ok) throw new Error(`term/${name}.json: HTTP ${res.status}. Run npm run snapshots.`)
      return res.json() as Promise<Recording>
    })
    cache.set(name, p)
  }
  return p
}

/** Both recordings; rendering waits until they are loaded. */
export function useRecordings(): Recordings | null {
  const [handle] = useState(() => delayRender('Loading terminal recordings'))
  const [data, setData] = useState<Recordings | null>(null)
  useEffect(() => {
    Promise.all([fetchRecording('hero'), fetchRecording('stats')])
      .then(([hero, stats]) => {
        setData({ hero, stats })
        continueRender(handle)
      })
      .catch(err => cancelRender(err))
  }, [handle])
  return data
}

/** The screen on show at recording time `t` (seconds). */
export function screenAt(rec: Recording, t: number): Screen {
  const frames = rec.frames
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid]!.t <= t) lo = mid
    else hi = mid - 1
  }
  return frames[lo]!
}

/** A row's text, with each character at its column. */
export function rowText(rec: Recording, id: number): string {
  let s = ''
  for (const run of rec.rowTable[id]!) {
    s = s.padEnd(run.x, ' ')
    const chars = [...run.t]
    chars.forEach((ch, i) => {
      s += ch
      if ((run.w?.[i] ?? 1) === 2) s += ' '
    })
  }
  return s
}

/** A box of cells: rows r0..r1 and columns c0..c1, inclusive-exclusive on the right and bottom. */
export type CellBox = { r0: number; r1: number; c0: number; c1: number }

/**
 * Where `pattern` appears on the screen, as a box of cells; several patterns
 * give the box around all of them. Null while none is on the screen.
 */
export function findOnScreen(rec: Recording, screen: Screen, patterns: RegExp[]): CellBox | null {
  let box: CellBox | null = null
  screen.r.forEach((id, y) => {
    const text = rowText(rec, id)
    for (const p of patterns) {
      const m = new RegExp(p.source, p.flags.replace('g', '')).exec(text)
      if (!m) continue
      const c0 = [...text.slice(0, m.index)].length
      const c1 = c0 + [...m[0]].length
      box = box
        ? { r0: Math.min(box.r0, y), r1: Math.max(box.r1, y + 1), c0: Math.min(box.c0, c0), c1: Math.max(box.c1, c1) }
        : { r0: y, r1: y + 1, c0, c1 }
    }
  })
  return box
}
