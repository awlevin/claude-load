/** One estimate the model gave, in agent-active milliseconds from task start. */
export type LoadEstimate = {
  /** Wall-clock time the estimate was made. */
  at: number
  /** Agent-active time already spent when the estimate was made. */
  agentMsAtAsk: number
  /** Median total agent-active time, after calibration. */
  p50Ms: number
  /** 90th-percentile total agent-active time, after calibration. */
  p90Ms: number
  /** The model's own median, before calibration. */
  rawP50Ms: number
  /** The calibration factor applied (1 with too little history). */
  factor: number
}

/** How a task ended. */
export type LoadEnd = {
  kind: 'push' | 'pr' | 'manual'
  prUrl: string | null
  command: string
}

/**
 * One task: from the first edit or commit to the push that makes it ready for
 * review. Written to disk as JSON, one file per task. Every field is plain
 * data and portable: no transcripts, no machine-local paths in the keys.
 */
export type LoadTask = {
  v: 1
  id: string
  sessionId: string
  /** Normalized origin remote (`github.com/owner/repo`), or `local/<dir>`. */
  repo: string
  model: string
  status: 'open' | 'done' | 'abandoned'
  startedAt: number
  endedAt: number | null
  /** What opened the task, such as `Edit register.ts`. */
  trigger: string
  /** A few words naming the task, from the model. */
  summary: string | null
  /** Agent-active time folded so far (turns running). */
  agentMs: number
  /** Time spent waiting for the person (between turns). */
  humanMs: number
  /** Set while a turn runs: when the current active stretch began. */
  activeSince: number | null
  /** Set while waiting for the person: when the wait began. */
  idleSince: number | null
  estimates: LoadEstimate[]
  end: LoadEnd | null
  /** The model's 1-2 line explanation of the residual. */
  explanation: string | null
}

/** Every repo's records, as the stats pane loaded them. */
export type StatsData = {
  histories: Record<string, LoadTask[]>
  /** When they were loaded. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    load: {
      task: LoadTask | null
      /** The text the spinner and status line show; null shows nothing. */
      label: string | null
      /** When the running main-loop turn began; null between turns. */
      turnStartedAt: number | null
      /** The working tree's signature when the turn began, to spot shell edits. */
      treeBaseline: string | null
      /** When each agent of the session was spawned, by agent id. */
      agentStarts: Record<string, number>
      /** What the stats pane draws, loaded when it opens or refreshes. */
      statsData: StatsData | null
    }
  }
}
