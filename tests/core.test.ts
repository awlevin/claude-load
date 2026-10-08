import { describe, expect, test } from 'claude-code/testing'

import {
  MINUTE,
  accuracy,
  agentElapsed,
  calibrationFactor,
  closeTask,
  findPrUrl,
  formatDuration,
  newTask,
  normalizeRemote,
  parseEstimate,
  shipKind,
  toEstimate,
  turnEnded,
  turnStarted,
  view,
  editTrigger,
} from '../hooks/core'
import type { LoadTask } from '../types'

const ROOT = '/repo'

function task(now = 0): LoadTask {
  return newTask({ id: 't', sessionId: 's', repo: 'github.com/a/b', model: 'm', trigger: 'Edit x.ts', startedAt: now })
}

function done(agentMinutes: number, rawP50Minutes: number, endedAt: number): LoadTask {
  const est = toEstimate({ summary: 's', p50Minutes: rawP50Minutes, p90Minutes: rawP50Minutes * 2 }, 0, 1, 0)
  return { ...task(), status: 'done', agentMs: agentMinutes * MINUTE, endedAt, estimates: [est] }
}

describe('task boundaries', () => {
  test('edit tools inside the repo open a task', () => {
    expect(editTrigger('Edit', { file_path: '/repo/src/a.ts' }, ROOT)).toBe('Edit a.ts')
    expect(editTrigger('Write', { file_path: '/repo/.claude/worktrees/x/a.ts' }, ROOT)).toBe('Write a.ts')
    expect(editTrigger('NotebookEdit', { notebook_path: '/repo/n.ipynb' }, ROOT)).toBe('NotebookEdit n.ipynb')
  })

  test('edits outside the repo, to tooling files, or by other tools do not', () => {
    expect(editTrigger('Edit', { file_path: '/other/a.ts' }, ROOT)).toBe(null)
    expect(editTrigger('Write', { file_path: '/repo/.claude/settings.json' }, ROOT)).toBe(null)
    expect(editTrigger('Write', { file_path: '/repository/a.ts' }, ROOT)).toBe(null)
    expect(editTrigger('Read', { file_path: '/repo/a.ts' }, ROOT)).toBe(null)
    expect(editTrigger('Bash', { command: 'sed -i "" s/a/b/ a.ts' }, ROOT)).toBe(null)
  })

  test('push and PR creation ship the work', () => {
    expect(shipKind('git push -u origin feat')).toBe('push')
    expect(shipKind('cd wt && git push')).toBe('push')
    expect(shipKind('git push && gh pr create --fill')).toBe('pr')
    expect(shipKind('git push --dry-run')).toBe(null)
    expect(shipKind('git status')).toBe(null)
    expect(shipKind('echo git push')).toBe(null)
  })

  test('finds a PR URL in output', () => {
    expect(findPrUrl('Creating pull request\nhttps://github.com/awlevin/x/pull/12\n')).toBe(
      'https://github.com/awlevin/x/pull/12',
    )
    expect(findPrUrl('Everything up-to-date')).toBe(null)
  })
})

describe('repo identity', () => {
  test('remotes normalize to one key', () => {
    const key = 'github.com/awlevin/claude-load'
    expect(normalizeRemote('git@github.com:awlevin/claude-load.git', ROOT)).toBe(key)
    expect(normalizeRemote('https://github.com/awlevin/claude-load.git', ROOT)).toBe(key)
    expect(normalizeRemote('https://token@github.com/AWLevin/claude-load/', ROOT)).toBe(key)
    expect(normalizeRemote('ssh://git@github.com:22/awlevin/claude-load.git', ROOT)).toBe(key)
    expect(normalizeRemote(null, '/x/my-app')).toBe('local/my-app')
    expect(normalizeRemote('/tmp/e2e/remote.git', ROOT)).toBe('local/remote')
  })
})

describe('clocks', () => {
  test('agent time stops while waiting for the person', () => {
    let t = task(0)
    t = turnEnded(t, 5 * MINUTE) // worked 5m
    expect(agentElapsed(t, 30 * MINUTE)).toBe(5 * MINUTE)
    t = turnStarted(t, 30 * MINUTE) // waited 25m
    expect(t.humanMs).toBe(25 * MINUTE)
    expect(agentElapsed(t, 32 * MINUTE)).toBe(7 * MINUTE)
  })

  test('turn events are idempotent', () => {
    const t = turnStarted(task(0), 1 * MINUTE)
    expect(t).toEqual(task(0))
    const ended = turnEnded(task(0), MINUTE)
    expect(turnEnded(ended, 2 * MINUTE)).toEqual(ended)
  })

  test('closing folds the running stretch', () => {
    const closed = closeTask(task(0), 4 * MINUTE, 'done', null)
    expect(closed.agentMs).toBe(4 * MINUTE)
    expect(closed.activeSince).toBe(null)
    expect(closed.idleSince).toBe(null)
    expect(closed.endedAt).toBe(4 * MINUTE)
  })
})

describe('estimates', () => {
  test('parses the model answer, tolerating prose around it', () => {
    expect(parseEstimate('Sure: {"summary": "add x", "p50_minutes": 12, "p90_minutes": 30}')).toEqual({
      summary: 'add x',
      p50Minutes: 12,
      p90Minutes: 30,
    })
    expect(parseEstimate('{"p50_minutes": 10, "p90_minutes": 4}')?.p90Minutes).toBe(20)
    expect(parseEstimate('no idea')).toBe(null)
    expect(parseEstimate('{"p50_minutes": 0}')).toBe(null)
  })

  test('estimates are totals from task start', () => {
    const est = toEstimate({ summary: null, p50Minutes: 10, p90Minutes: 20 }, 5 * MINUTE, 2, 0)
    expect(est.p50Ms).toBe(25 * MINUTE)
    expect(est.p90Ms).toBe(45 * MINUTE)
    expect(est.rawP50Ms).toBe(15 * MINUTE)
  })

  test('calibration needs three tasks, then scales by the geometric median', () => {
    expect(calibrationFactor([done(20, 10, 1), done(20, 10, 2)])).toBe(1)
    expect(calibrationFactor([done(20, 10, 1), done(20, 10, 2), done(40, 10, 3)]).toFixed(6)).toBe("2.000000")
    expect(calibrationFactor([done(500, 1, 1), done(500, 1, 2), done(500, 1, 3)])).toBe(4)
  })

  test('accuracy compares with the repo-median baseline', () => {
    const history = [done(10, 10, 1), done(10, 10, 2), done(10, 10, 3), done(30, 10, 4)]
    const a = accuracy(history)
    expect(a.n).toBe(4)
    expect(a.withinP50).toBe(0.75)
    expect(a.withinP90).toBe(0.75)
    expect(a.baselineError?.toFixed(6)).toBe("3.000000")
  })
})

describe('display', () => {
  test('durations', () => {
    expect(formatDuration(20_000)).toBe('<1m')
    expect(formatDuration(8 * MINUTE)).toBe('8m')
    expect(formatDuration(120 * MINUTE)).toBe('2h')
    expect(formatDuration(135 * MINUTE)).toBe('2h 15m')
  })

  test('counts down, pauses, and never goes negative', () => {
    const est = toEstimate({ summary: 'add x', p50Minutes: 10, p90Minutes: 20 }, 0, 1, 0)
    const t = { ...task(0), summary: 'add x', estimates: [est] }
    expect(view(t, 2 * MINUTE, { isEstimating: false, overrun: 're-estimate' })?.spinner).toBe('~8m left')
    expect(view(t, 9.8 * MINUTE, { isEstimating: false, overrun: 're-estimate' })?.spinner).toBe('<1m left')
    const idle = turnEnded(t, 2 * MINUTE)
    expect(view(idle, 9 * MINUTE, { isEstimating: false, overrun: 're-estimate' })?.status).toContain('paused')
    const over = view(t, 11 * MINUTE, { isEstimating: false, overrun: 'say-overdue' })
    expect(over?.isOver).toBe(true)
    expect(over?.spinner).toBe('taking longer than expected')
    expect(view(t, 11 * MINUTE, { isEstimating: true, overrun: 're-estimate' })?.spinner).toBe('re-estimating…')
  })

  test('shows nothing without an open task', () => {
    expect(view(null, 0, { isEstimating: false, overrun: 're-estimate' })).toBe(null)
    expect(view(closeTask(task(), 1, 'done', null), 2, { isEstimating: false, overrun: 're-estimate' })).toBe(null)
  })
})
