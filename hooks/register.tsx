import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRepo } from 'claude-code'

import type { LoadTask, StatsData } from '../types'
import {
  BAR_STYLES,
  MAX_REESTIMATES,
  TREE_SIGNATURE,
  accuracy,
  agentElapsed,
  calibrationFactor,
  closeTask,
  editTrigger,
  estimatePrompt,
  explainPrompt,
  findPrUrl,
  formatDuration,
  isEditTool,
  markActive,
  markIdle,
  newTask,
  normalizeRemote,
  parseEstimate,
  pct,
  reestimatePrompt,
  repoSlug,
  shipKind,
  statsMarkdown,
  times,
  toEstimate,
  view,
  type BarStyle,
  type Overrun,
} from './core'

type $ = EngineInterface

const task = atom({ plugin: 'load', key: 'task' } as const, null as LoadTask | null)
const label = atom({ plugin: 'load', key: 'label' } as const, null as string | null)
const turnStartedAt = atom({ plugin: 'load', key: 'turnStartedAt' } as const, null as number | null)
const treeBaseline = atom({ plugin: 'load', key: 'treeBaseline' } as const, null as string | null)
const statsData = atom({ plugin: 'load', key: 'statsData' } as const, null as StatsData | null)
const agentStarts = atom({ plugin: 'load', key: 'agentStarts' } as const, {} as Record<string, number>)

/** How often the countdown and the background estimates are checked. */
const TICK_MS = 2_000
/** A `gh pr create` this soon after a push adds its URL to the closed task. */
const PR_GRACE_MS = 15 * 60_000
const STATS_PANE = 'load-stats'
/** Agent spawn times kept, newest first. */
const MAX_AGENT_STARTS = 100
/** Failed estimates allowed per task before it stops asking. */
const MAX_FAILURES = 3

// Module state: a reload starts these over, which is safe.
let overrun: Overrun = 're-estimate'
let barStyle: BarStyle = 'blocks'
let isEstimating = false
let isTicking = false
let failures = { taskId: '', count: 0 }
let lastStatus: string | undefined
let lastLabel: string | null = null
/** A closed task to explain once its turn ends, so the fork sees the push. */
let toExplain: LoadTask | null = null

// ---- Storage: one JSON file per task under ~/.claude/load/tasks/<repo>/ --

async function tasksRoot($: $): Promise<string> {
  const base = (await $.env.get('CLAUDE_LOAD_DIR')) ?? `${await $.env.get('HOME')}/.claude/load`
  return `${base}/tasks`
}

async function tasksDir($: $, repo: string): Promise<string> {
  return `${await tasksRoot($)}/${repoSlug(repo)}`
}

async function save($: $, t: LoadTask): Promise<void> {
  await $.fs.write(`${await tasksDir($, t.repo)}/${t.id}.json`, JSON.stringify(t, null, 2) + '\n')
}

async function loadHistory($: $, repo: string): Promise<LoadTask[]> {
  return loadDir($, await tasksDir($, repo))
}

/** Every repo's history, keyed by repo. */
async function loadAll($: $): Promise<Map<string, LoadTask[]>> {
  const root = await tasksRoot($)
  const dirs = (await $.fs.list(root).catch(() => [])).filter(d => d.kind === 'dir')
  const lists = await Promise.all(dirs.map(d => loadDir($, `${root}/${d.name}`)))
  const byRepo = new Map<string, LoadTask[]>()
  for (const t of lists.flat()) {
    const list = byRepo.get(t.repo)
    if (list) list.push(t)
    else byRepo.set(t.repo, [t])
  }
  return byRepo
}

async function loadDir($: $, dir: string): Promise<LoadTask[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries
    .filter(f => f.kind === 'file' && f.name.endsWith('.json'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 200)
  const tasks = await Promise.all(
    files.map(async f => {
      try {
        return JSON.parse(String(await $.fs.read(`${dir}/${f.name}`))) as LoadTask
      } catch {
        return null
      }
    }),
  )
  return tasks.filter((t): t is LoadTask => t !== null && t.v === 1)
}

/** Applies `fn` to the open task in state and saves the result. */
async function change($: $, fn: (t: LoadTask) => LoadTask): Promise<LoadTask | null> {
  let changed: LoadTask | null = null
  await update($, task, t => {
    changed = t === null ? null : fn(t)
    return changed
  })
  if (changed !== null) await save($, changed)
  return changed
}

// ---- Background work ----------------------------------------------------

async function estimate($: $, t: LoadTask): Promise<void> {
  isEstimating = true
  try {
    const now = await $.clock.now()
    const isFirst = t.estimates.length === 0
    const history = isFirst ? (await loadHistory($, t.repo)).filter(h => h.id !== t.id) : []
    const prompt = isFirst ? estimatePrompt(t, history, now) : reestimatePrompt(t, now)
    const reply = await $.model.fork({ prompt })
    const answer = reply.isAnswered ? parseEstimate(reply.text) : null
    if (answer === null) {
      failures = { taskId: t.id, count: failures.taskId === t.id ? failures.count + 1 : 1 }
      const why = reply.isAnswered ? `unreadable reply: ${reply.text.slice(0, 200)}` : reply.reason
      $.ui.log(`load: estimate failed (${why})`, { to: 'debug' })
      return
    }
    // An overrun is evidence against shrinking: re-estimates never scale down.
    const factor = isFirst ? calibrationFactor(history) : Math.max(1, t.estimates[0]!.factor)
    const done = await $.clock.now()
    const next = toEstimate(answer, agentElapsed(t, now), factor, done)
    await change($, cur =>
      cur.id === t.id && cur.status === 'open'
        ? { ...cur, summary: cur.summary ?? answer.summary, estimates: [...cur.estimates, next] }
        : cur,
    )
  } finally {
    isEstimating = false
  }
}

async function explain($: $, t: LoadTask): Promise<void> {
  const reply = await $.model.fork({ prompt: explainPrompt(t) })
  if (!reply.isAnswered) return
  const explanation = reply.text.trim().slice(0, 400)
  // The task may have left state by now: save the closed copy directly.
  await save($, { ...t, explanation })
  await update($, task, cur => (cur?.id === t.id ? { ...cur, explanation } : cur))
}

async function tick($: $): Promise<void> {
  if (isTicking) return
  isTicking = true
  try {
    await syncActivity($)
    const t = await read($, task)
    const now = await $.clock.now()
    let shown = view(t, now, { isEstimating, overrun, barStyle })
    if (t?.status === 'open' && !isEstimating) {
      const hasFailedOut = failures.taskId === t.id && failures.count >= MAX_FAILURES
      const isFirst = t.estimates.length === 0
      const isRe =
        shown?.isOver === true && overrun === 're-estimate' && t.estimates.length <= MAX_REESTIMATES && t.activeSince !== null
      if (!hasFailedOut && (isFirst || isRe)) {
        void estimate($, t)
        shown = view(t, now, { isEstimating, overrun, barStyle })
      }
    }
    if (shown?.status !== lastStatus) {
      lastStatus = shown?.status
      $.ui.status(shown?.status)
    }
    const spinner = shown?.spinner ?? null
    if (spinner !== lastLabel) {
      lastLabel = spinner
      await update($, label, () => spinner)
    }
  } finally {
    isTicking = false
  }
}

/** Closes the open task; null when none was open. */
async function finish($: $, status: 'done' | 'abandoned', end: LoadTask['end']): Promise<LoadTask | null> {
  if ((await read($, task))?.status !== 'open') return null
  const now = await $.clock.now()
  const closed = await change($, t => closeTask(t, now, status, end))
  void tick($)
  return closed
}

/**
 * When the work behind a tool call began: the spawn of the subagent that made
 * it, else the start of the main turn, else now; never before the previous
 * task ended, so two tasks in one turn do not overlap.
 */
async function workStart($: $, agentId: string | undefined, now: number): Promise<number> {
  const spawned = agentId === undefined ? undefined : (await read($, agentStarts))[agentId]
  const start = spawned ?? (await read($, turnStartedAt)) ?? now
  return Math.max(start, (await read($, task))?.endedAt ?? 0)
}

async function openTask($: $, trigger: string, repo: SessionRepo, agentId: string | undefined): Promise<void> {
  const now = await $.clock.now()
  const sessionId = await $.session.id()
  const opened = newTask({
    id: `${now.toString(36)}-${sessionId.slice(0, 8)}`,
    sessionId,
    repo: normalizeRemote(repo.remote, repo.root),
    model: await $.session.model(),
    trigger,
    startedAt: await workStart($, agentId, now),
  })
  await update($, task, () => opened)
  await save($, opened)
  await syncActivity($)
  void tick($)
}

async function openIfEdit($: $, tool: string, input: Record<string, unknown>, agentId: string | undefined): Promise<void> {
  if ((await read($, task))?.status === 'open') return
  const repo = await $.session.repo()
  const trigger = repo && editTrigger(tool, input, repo.root)
  if (repo && trigger) await openTask($, trigger, repo, agentId)
}

/** The working tree's signature, or null outside a repo. */
async function treeSignature($: $, root: string): Promise<string | null> {
  const ran = await $.process.run(['sh', '-c', TREE_SIGNATURE], { cwd: root, timeoutMs: 10_000 })
  return ran.exitCode === 0 ? ran.stdout : null
}

/** Records the tree at turn start, so a shell edit later in the turn shows. */
async function recordBaseline($: $): Promise<void> {
  const repo = await $.session.repo()
  const signature = repo && (await treeSignature($, repo.root))
  await update($, treeBaseline, () => signature)
}

/** Opens a task when a shell call changed the tree since the baseline. */
async function openIfTreeChanged($: $, agentId: string | undefined): Promise<void> {
  if ((await read($, task))?.status === 'open') return
  const before = await read($, treeBaseline)
  const repo = await $.session.repo()
  if (before === null || repo === null) return
  const after = await treeSignature($, repo.root)
  if (after !== null && after !== before) await openTask($, 'shell edit', repo, agentId)
}

/**
 * The agent is working while the main turn runs or any of the session's
 * agents runs (background delegation); otherwise the time is the person's.
 */
async function syncActivity($: $): Promise<void> {
  const t = await read($, task)
  if (t?.status !== 'open') return
  const isTurnRunning = (await read($, turnStartedAt)) !== null
  const isBusy =
    isTurnRunning || (await $.agent.list()).some(a => a.status === 'running' || a.status === 'pending')
  if (isBusy === (t.activeSince !== null)) return
  const now = await $.clock.now()
  await change($, cur => (isBusy ? markActive(cur, now) : markIdle(cur, now)))
}

async function onShipped($: $, command: string, output: string): Promise<void> {
  const kind = shipKind(command)
  if (kind === null) return
  const prUrl = findPrUrl(output)
  const closed = await finish($, 'done', { kind, prUrl, command: command.slice(0, 200) })
  if (closed !== null) {
    // The commit just pushed is not new work: compare later calls with now.
    await recordBaseline($)
    const est = closed.estimates[0]
    $.ui.toast(
      `Done in ${formatDuration(closed.agentMs)}` +
        (est ? ` (estimated ${formatDuration(est.p50Ms)})` : '') +
        (closed.humanMs > 60_000 ? ` · ${formatDuration(closed.humanMs)} waiting on you` : ''),
    )
    toExplain = closed
    return
  }
  const t = await read($, task)
  const now = await $.clock.now()
  if (t?.status === 'done' && prUrl && !t.end?.prUrl && now - (t.endedAt ?? 0) < PR_GRACE_MS) {
    // `gh pr create` right after the push that closed the task: keep its URL.
    const withPr: LoadTask = { ...t, end: { kind: 'pr', prUrl, command: t.end?.command ?? command.slice(0, 200) } }
    await update($, task, () => withPr)
    await save($, withPr)
  }
}

function debug($: $, where: string, err: unknown): void {
  $.ui.log(`load: ${where} failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
}

async function refreshStats($: $): Promise<void> {
  const histories = Object.fromEntries(await loadAll($))
  const at = await $.clock.now()
  await update($, statsData, () => ({ histories, at }))
}

async function openStats($: $): Promise<void> {
  await refreshStats($)
  await $.ui.open({ id: STATS_PANE, title: 'load · accuracy', focus: true, closeOnEscape: true })
}

/** The short text answer of `/load`; `/load stats` has the full picture. */
async function report($: $): Promise<string> {
  const shown = view(await read($, task), await $.clock.now(), { isEstimating, overrun, barStyle })
  const lines = [shown ? shown.status : 'No open task. A task opens at the first edit, and closes at a push or PR.']
  const repo = await $.session.repo()
  if (repo !== null) {
    const key = normalizeRemote(repo.remote, repo.root)
    const a = accuracy(await loadHistory($, key))
    lines.push(
      a.n === 0
        ? `${key}: no estimated task has finished yet.`
        : `${key}: estimates off by ${times(a.modelError)}` +
            (a.baselineError === null ? '' : ` vs ${times(a.baselineError)} for the repo-median baseline`) +
            ` · ${pct(a.withinP50)} within p50 · ${pct(a.withinP90)} within p90 · n=${a.n}`,
    )
  }
  lines.push('/load stats opens the full stats pane.')
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  overrun = options.onOverrun === 'say-overdue' ? 'say-overdue' : 're-estimate'
  barStyle = BAR_STYLES.find(style => style === options.barStyle) ?? 'blocks'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'load',
      description: 'Show the task estimate and how accurate past estimates were',
      argumentHint: '[stats|done|drop]',
    })
    $.clock.every(TICK_MS, () => void tick($))
    void tick($)
    return next(e)
  })

  // An observer, never a gate: any failure here leaves the tool call alone.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    if (isEditTool(e.tool)) await openIfEdit($, e.tool, input, e.agentId).catch(err => debug($, 'open', err))
    const ran = await next(e)
    if (e.tool === 'Bash') {
      // First the tree, so one command that edits, commits and pushes opens
      // the task before the push closes it.
      await openIfTreeChanged($, e.agentId).catch(err => debug($, 'tree', err))
      if (ran.deny === undefined && ran.isError !== true && shipKind(e.command) !== null) {
        await onShipped($, e.command, String(ran.text ?? '')).catch(err => debug($, 'ship', err))
      }
    }
    return ran
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, turnStartedAt, () => now)
    if ((await read($, task))?.status === 'open') await syncActivity($)
    // Off the turn's path: the model streams for seconds before any tool runs.
    else void recordBaseline($).catch(err => debug($, 'baseline', err))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turnStartedAt, () => null)
      await syncActivity($)
      if (toExplain !== null) void explain($, toExplain)
      toExplain = null
      void tick($)
    }
    return next(e)
  })

  // Spawn times, so a task a background agent opens starts with that agent.
  on('agent.spawn', async ($, e, next) => {
    const now = await $.clock.now()
    const spawned = await next(e)
    const id = spawned.agentId
    if (id !== undefined) {
      await update($, agentStarts, starts =>
        Object.fromEntries([[id, now] as const, ...Object.entries(starts)].slice(0, MAX_AGENT_STARTS)),
      ).catch(err => debug($, 'spawn', err))
    }
    return spawned
  })

  on('session.end', async ($, e, next) => {
    await finish($, 'abandoned', null)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: STATS_PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const data = await read($, statsData)
    const current = await read($, task)
    const text = data && statsMarkdown(new Map(Object.entries(data.histories)), current, data.at, e.props.bodyColumns)
    return (
      <Box flexDirection="column">
        {text ? <Markdown text={text} /> : <Text dimColor>Loading…</Text>}
        <Box marginTop={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refreshStats($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const text = await read($, label)
    if (text === null) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `… ${text}` } })
  })

  on('command.run', { command: 'load' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'stats') {
      await openStats($)
      return { text: 'Opened load stats. Esc closes it.' }
    }
    if (arg === 'done') {
      const closed = await finish($, 'done', { kind: 'manual', prUrl: null, command: '/load done' })
      if (closed === null) return { text: 'No open task.' }
      toExplain = closed
      return { text: `Closed "${closed.summary ?? closed.trigger}" as done.` }
    }
    if (arg === 'drop') {
      const dropped = await finish($, 'abandoned', null)
      if (dropped === null) return { text: 'No open task.' }
      return { text: `Dropped "${dropped.summary ?? dropped.trigger}"; it will not count toward estimates.` }
    }
    return { text: await report($) }
  })
}
