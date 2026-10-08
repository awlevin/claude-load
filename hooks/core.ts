// Pure logic: no `$`, so every function here is testable on its own.
import type { LoadEstimate, LoadTask } from '../types'

export const MINUTE = 60_000
/** Re-estimates allowed per task before the label says it is overdue. */
export const MAX_REESTIMATES = 3
/** Past tasks given to the model as reference, newest first. */
export const HISTORY_IN_PROMPT = 40

// ---- Task boundaries -------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// A command segment: start of text, or after a shell separator.
const SEGMENT = String.raw`(?:^|[;&|(\n]\s*)`
const GIT = String.raw`git\s+(?:-C\s+\S+\s+)?`
const PUSH = new RegExp(`${SEGMENT}${GIT}push\\b`)
const PR_CREATE = new RegExp(`${SEGMENT}gh\\s+pr\\s+create\\b`)
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/

/**
 * What opens a task before the call runs, or null: an edit tool writing inside
 * the repo. Edits under `.claude/` (memory, plans, settings) do not count,
 * except in `.claude/worktrees/`, where subagents implement. Shell edits
 * (`sed -i`, heredocs, scripts) are caught after the call instead, by a change
 * in the working tree (`TREE_SIGNATURE`).
 */
export function editTrigger(tool: string, input: Record<string, unknown>, repoRoot: string): string | null {
  if (!EDIT_TOOLS.has(tool)) return null
  const path = String(input.file_path ?? input.notebook_path ?? '')
  const isInRepo = path.startsWith(repoRoot + '/')
  const isTooling = /\/\.claude\/(?!worktrees\/)/.test(path.slice(repoRoot.length))
  return isInRepo && !isTooling ? `${tool} ${basename(path)}` : null
}

export function isEditTool(tool: string): boolean {
  return EDIT_TOOLS.has(tool)
}

/**
 * A shell script whose output changes when the working tree or HEAD does:
 * compared at turn start and after each shell call. `--no-optional-locks`
 * keeps it from taking the index lock the agent's own git commands need.
 */
export const TREE_SIGNATURE =
  'git rev-parse HEAD 2>/dev/null; git --no-optional-locks status --porcelain=v1 --untracked-files=normal; git --no-optional-locks diff HEAD --shortstat 2>/dev/null'

/** Whether a Bash command ships the work: `pr` wins over a plain `push`. */
export function shipKind(command: string): 'pr' | 'push' | null {
  if (PR_CREATE.test(command)) return 'pr'
  if (PUSH.test(command) && !/--dry-run\b/.test(command)) return 'push'
  return null
}

export function findPrUrl(text: string): string | null {
  return PR_URL.exec(text)?.[0] ?? null
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// ---- Repo identity ---------------------------------------------------------

/**
 * A remote URL as a stable, shareable key: `github.com/owner/repo` for
 * `git@github.com:owner/repo.git`, `https://user@github.com/owner/repo`, ...
 */
export function normalizeRemote(remote: string | null, root: string): string {
  if (remote === null || remote.trim() === '') return `local/${basename(root)}`
  if (/^(\/|file:\/\/)/.test(remote)) return `local/${basename(remote.replace(/\.git\/?$/, ''))}`
  let rest = remote.trim().replace(/\.git$/, '').replace(/\/$/, '')
  rest = rest.replace(/^[a-z+]+:\/\//, '') // scheme
  rest = rest.replace(/^[^@/]+@/, '') // user@
  rest = rest.replace(/^([^/:]+):(\d+)\//, '$1/') // host:port/
  rest = rest.replace(/^([^/:]+):/, '$1/') // scp-style host:path
  return rest.toLowerCase()
}

/** A directory name for a repo key. */
export function repoSlug(repo: string): string {
  return repo.replace(/[^a-z0-9._-]+/gi, '_')
}

// ---- Clocks ----------------------------------------------------------------

export function newTask(args: {
  id: string
  sessionId: string
  repo: string
  model: string
  trigger: string
  /** When implementation began: the start of the turn the trigger came in. */
  startedAt: number
}): LoadTask {
  return {
    v: 1,
    id: args.id,
    sessionId: args.sessionId,
    repo: args.repo,
    model: args.model,
    status: 'open',
    startedAt: args.startedAt,
    endedAt: null,
    trigger: args.trigger,
    summary: null,
    agentMs: 0,
    humanMs: 0,
    // A task opens on a tool call, so a turn is running.
    activeSince: args.startedAt,
    idleSince: null,
    estimates: [],
    end: null,
    explanation: null,
  }
}

/** A main-loop turn began: any wait for the person ends. */
export function turnStarted(task: LoadTask, now: number): LoadTask {
  if (task.activeSince !== null) return task
  const waited = task.idleSince === null ? 0 : Math.max(0, now - task.idleSince)
  return { ...task, humanMs: task.humanMs + waited, idleSince: null, activeSince: now }
}

/** A main-loop turn ended: active time folds in, the wait for the person begins. */
export function turnEnded(task: LoadTask, now: number): LoadTask {
  if (task.activeSince === null) return task
  const worked = Math.max(0, now - task.activeSince)
  return { ...task, agentMs: task.agentMs + worked, activeSince: null, idleSince: now }
}

export function agentElapsed(task: LoadTask, now: number): number {
  const running = task.activeSince === null ? 0 : Math.max(0, now - task.activeSince)
  return task.agentMs + running
}

/** Folds both clocks and ends the task. */
export function closeTask(
  task: LoadTask,
  now: number,
  status: 'done' | 'abandoned',
  end: LoadTask['end'],
): LoadTask {
  const folded = turnEnded(turnStarted(task, now), now)
  return { ...folded, idleSince: null, status, endedAt: now, end }
}

// ---- Estimates -------------------------------------------------------------

/** Done tasks of one repo that have an estimate, newest first. */
export function doneWithEstimate(history: readonly LoadTask[]): LoadTask[] {
  return history
    .filter(t => t.status === 'done' && t.estimates.length > 0 && t.agentMs > 0)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return NaN
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * How much to scale the model's raw estimate in this repo: the geometric
 * median of actual ÷ first raw estimate over the last 20 done tasks. 1 until
 * three exist; clamped to [0.25, 4] so one bad streak cannot run away.
 */
export function calibrationFactor(history: readonly LoadTask[]): number {
  const ratios = doneWithEstimate(history)
    .slice(0, 20)
    .map(t => Math.log(t.agentMs / t.estimates[0]!.rawP50Ms))
    .filter(Number.isFinite)
  if (ratios.length < 3) return 1
  return Math.min(4, Math.max(0.25, Math.exp(median(ratios))))
}

export type ModelAnswer = { summary: string | null; p50Minutes: number; p90Minutes: number }

/** Reads the model's JSON answer; null when it gave none usable. */
export function parseEstimate(text: string): ModelAnswer | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (json === undefined) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const p50 = Number(o.p50_minutes)
  const p90 = Number(o.p90_minutes)
  if (!(p50 > 0) || !Number.isFinite(p50)) return null
  const summary = typeof o.summary === 'string' && o.summary.trim() !== '' ? o.summary.trim().slice(0, 80) : null
  return {
    summary,
    p50Minutes: p50,
    p90Minutes: Number.isFinite(p90) && p90 >= p50 ? p90 : p50 * 2,
  }
}

/** The model answers in remaining minutes; this stores totals from task start. */
export function toEstimate(
  answer: ModelAnswer,
  agentMsAtAsk: number,
  factor: number,
  now: number,
): LoadEstimate {
  return {
    at: now,
    agentMsAtAsk,
    p50Ms: agentMsAtAsk + answer.p50Minutes * MINUTE * factor,
    p90Ms: agentMsAtAsk + answer.p90Minutes * MINUTE * factor,
    rawP50Ms: agentMsAtAsk + answer.p50Minutes * MINUTE,
    factor,
  }
}

// ---- Prompts ---------------------------------------------------------------

function historyLines(history: readonly LoadTask[]): string {
  const lines = doneWithEstimate(history)
    .concat(history.filter(t => t.status === 'done' && t.estimates.length === 0))
    .slice(0, HISTORY_IN_PROMPT)
    .map(t => {
      const est = t.estimates[0] ? ` (estimated ${formatDuration(t.estimates[0].p50Ms)})` : ''
      return `- ${formatDuration(t.agentMs)}${est}: ${t.summary ?? t.trigger}`
    })
  return lines.length > 0 ? lines.join('\n') : '(none yet)'
}

const ANSWER_SHAPE =
  'Reply with only this JSON and nothing else: ' +
  '{"summary": "<at most 8 words naming the task>", "p50_minutes": <number>, "p90_minutes": <number>}'

export function estimatePrompt(task: LoadTask, history: readonly LoadTask[], now: number): string {
  return [
    '[load plugin: a background timing question. It is not from the user. Do not continue the task or call tools; answer only as asked.]',
    '',
    'You have started implementing a task in this conversation. Estimate how much more of your own active working time it needs until the work is committed and pushed (or a PR is open), ready for review.',
    'Count only time you spend working: your turns, tool runs, builds, tests, and CI you wait on. Do not count time spent waiting for the user.',
    'You are an AI agent: estimate at your pace, not a human engineer\'s. Base the estimate on the past tasks below when any are similar.',
    '',
    `Active time spent so far: ${formatDuration(agentElapsed(task, now))}.`,
    '',
    'Past tasks in this repository (actual active time, newest first):',
    historyLines(history),
    '',
    'Give the remaining time as a median (p50) and a pessimistic 90th percentile (p90), in minutes.',
    ANSWER_SHAPE,
  ].join('\n')
}

export function reestimatePrompt(task: LoadTask, now: number): string {
  const last = task.estimates.at(-1)
  return [
    '[load plugin: a background timing question. It is not from the user. Do not continue the task or call tools; answer only as asked.]',
    '',
    `The task "${task.summary ?? task.trigger}" has used ${formatDuration(agentElapsed(task, now))} of your active time.`,
    last ? `The earlier estimate was ${formatDuration(last.p50Ms)} in total, so it is taking longer than expected.` : '',
    'Look at where the work stands now and estimate the remaining active time until the work is pushed and ready for review.',
    ANSWER_SHAPE,
  ].join('\n')
}

export function explainPrompt(task: LoadTask): string {
  const est = task.estimates[0]
  return [
    '[load plugin: a background question. It is not from the user. Do not call tools; answer only as asked.]',
    '',
    `The task "${task.summary ?? task.trigger}" is finished: the work is committed and pushed. It took ${formatDuration(task.agentMs)} of your active time` +
      (task.humanMs > MINUTE ? ` (plus ${formatDuration(task.humanMs)} waiting for the user)` : '') +
      (est ? `; the first estimate was ${formatDuration(est.p50Ms)}.` : '.'),
    'In one or two short sentences, say what made it take that long, or why it went faster than estimated. Plain text only.',
  ].join('\n')
}

// ---- Display ---------------------------------------------------------------

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 1) return '<1m'
  if (minutes < 90) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** `~8m`, but `<1m` with no tilde. */
function about(ms: number): string {
  const text = formatDuration(ms)
  return text.startsWith('<') ? text : `~${text}`
}

export function progressBar(fraction: number, width = 8): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export type Overrun = 're-estimate' | 'say-overdue'

export type View = {
  /** Short text for the spinner, such as `~8m left`. */
  spinner: string
  /** The status line under the prompt. */
  status: string
  /** Whether the latest estimate has run out. */
  isOver: boolean
}

/** What to show for a task; null when there is no open task. */
export function view(
  task: LoadTask | null,
  now: number,
  args: { isEstimating: boolean; overrun: Overrun },
): View | null {
  if (task === null || task.status !== 'open') return null
  const name = task.summary ?? task.trigger
  const elapsed = agentElapsed(task, now)
  const paused = task.activeSince === null ? ' · paused' : ''
  const last = task.estimates.at(-1)
  if (last === undefined) {
    const text = args.isEstimating ? 'estimating…' : 'no estimate yet'
    return { spinner: text, status: `${progressBar(0)} ${text} · ${name}`, isOver: false }
  }
  const left = last.p50Ms - elapsed
  const isOver = left <= 0
  if (isOver) {
    const canReestimate = args.overrun === 're-estimate' && task.estimates.length <= MAX_REESTIMATES
    const text = args.isEstimating && canReestimate ? 're-estimating…' : 'taking longer than expected'
    return {
      spinner: text,
      status: `${progressBar(1)} ${text} · ${formatDuration(elapsed)} so far${paused} · ${name}`,
      isOver,
    }
  }
  const bar = progressBar(elapsed / last.p50Ms)
  const remaining = about(left)
  return {
    spinner: `${remaining} left`,
    status: `${bar} ${remaining} left · est ${formatDuration(last.p50Ms)}${paused} · ${name}`,
    isOver,
  }
}

// ---- Accuracy --------------------------------------------------------------

export type Accuracy = {
  n: number
  /** Median |log(actual / estimate)|, shown as a multiplier (1.0 is perfect). */
  modelError: number | null
  /** The same for the baseline: the median of the repo's earlier tasks. */
  baselineError: number | null
  /** Share of tasks that finished within the p50 estimate (target ~50%). */
  withinP50: number | null
  /** Share of tasks that finished within the p90 estimate (target ~90%). */
  withinP90: number | null
}

/**
 * Whether the estimates beat the simplest baseline: guessing the median of
 * the repo's earlier tasks. If they do not, the plugin is not worth shipping.
 */
export function accuracy(history: readonly LoadTask[]): Accuracy {
  const done = doneWithEstimate(history).reverse() // oldest first
  const model: number[] = []
  const baseline: number[] = []
  let inP50 = 0
  let inP90 = 0
  done.forEach((t, i) => {
    const est = t.estimates[0]!
    model.push(Math.abs(Math.log(t.agentMs / est.p50Ms)))
    if (t.agentMs <= est.p50Ms) inP50 += 1
    if (t.agentMs <= est.p90Ms) inP90 += 1
    const earlier = done.slice(0, i).map(e => e.agentMs)
    if (earlier.length >= 3) baseline.push(Math.abs(Math.log(t.agentMs / median(earlier))))
  })
  const n = done.length
  return {
    n,
    modelError: n > 0 ? Math.exp(median(model)) : null,
    baselineError: baseline.length > 0 ? Math.exp(median(baseline)) : null,
    withinP50: n > 0 ? inP50 / n : null,
    withinP90: n > 0 ? inP90 / n : null,
  }
}
