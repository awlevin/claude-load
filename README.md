# claude-load

**How long will this task take?** A Claude Code mod that estimates the time left on the current coding task, learns from your history, and shows a live countdown in the spinner.

```
✽ Gusting… ~3m left (33s · ↓ 2.9k tokens)
  load: ██░░░░░░ ~3m left · est 4m · Build CLI calculator, tests, commit, push
```

Agent UIs show *working*, *done* or *needs input*. Nothing shows *how long*. `load` adds that.

## Install

In a Claude Code terminal session:

```
/plugin install load --marketplace awlevin/claude-load
```

Answer `y` to add the marketplace, then pick a scope. The plugin is named `load` because plugin names cannot start with `claude-`.

## What it does

- **Task start.** A task opens at the first sign of implementation: an edit tool writing inside the repo, or a shell command that changes the git working tree (`sed -i`, heredocs, scripts, commits). The start is moved back to the beginning of that turn, or to the spawn of the subagent that made the change. Question-and-answer turns open nothing.
- **Task end.** A task closes when the work is ready for review: a successful `git push` or `gh pr create`. If `gh pr create` follows within 15 minutes, its PR URL is added to the task.
- **Two clocks.** Agent time and your time are recorded separately. The agent counts as working while the main turn runs or any background agent of the session runs, so delegated work counts as agent time. The countdown pauses only when nothing is working and the session waits for you.
- **Estimates that cost the agent nothing.** The agent loop never waits. A background `$.model.fork` reads the conversation from the prompt cache and gives a median (p50) and a 90th-percentile (p90) estimate. The prompt includes up to 40 past tasks from the same repo with their actual times.
- **Calibration.** After 3 finished tasks in a repo, estimates are scaled by the median ratio of actual to estimated time for that repo. The scale is limited to between ×0.25 and ×4.
- **When the estimate runs out.** The countdown never goes negative. By default the plugin asks for a new estimate in the background, up to 3 times. After that, or with `onOverrun: say-overdue`, it shows *taking longer than expected*.
- **Explanations.** When a task ends, the model writes 1–2 sentences on why the task took longer or shorter than estimated. They are saved with the record.

## Commands

| Command | What it does |
| --- | --- |
| `/load` | Shows the current task, the accuracy of past estimates in this repo, and recent tasks |
| `/load stats` | Opens the stats pane: overall and per-repo accuracy against the baseline, the open task with each of its estimates, and a table of finished tasks with explanations. `r` refreshes it and Esc closes it |
| `/load done` | Closes the open task as done; use it when the work does not end with a push |
| `/load drop` | Drops the open task, for example when it opened by mistake, so it does not count |

## Is it worth it?

`/load` compares the estimates with a simple baseline: the median time of the repo's earlier tasks. It shows:

```
Estimates were off by ×1.6 (median); guessing the repo median was off by ×2.3 · 52% within p50 · 88% within p90 · n=25
```

If the estimates do not beat the baseline, the plugin is not useful in that repo. A good result is about 50% of tasks within p50 and 90% within p90.

## Data

Records are kept in `~/.claude/load/tasks/<repo>/<task>.json`, one JSON file for each task. Set `CLAUDE_LOAD_DIR` to change the location. The files are designed for sharing:

- **Repo key:** the normalized remote (`github.com/owner/repo`), not a local path.
- **Global pointers:** the PR URL and the push command.
- **No transcripts:** only a short summary, timings, estimates and the explanation.

To share with a team, make the folder a git repo and push and pull it.

## Settings

`/config` → `load.onOverrun`:

- `re-estimate` (default): ask for a new estimate in the background.
- `say-overdue`: show that the task is taking longer than expected.

## Limits

- Plugins cannot draw in the multi-agent session list, and `sessionTitle` can only be set when a prompt is sent. For this reason, the countdown lives in each session's spinner and status line.
- Edits made with shell commands in a subagent's separate worktree are not detected. Edit-tool calls are detected everywhere.
- With no history, models tend to overestimate (they think at human speed). Calibration corrects this after 3 tasks.

## Develop

```sh
claude --plugin-dir .          # load it from this folder; saves hot-reload
claude plugin validate .
claude plugin test .
tsc -p .                       # types are written to .claude-plugin/types on load
```

The logic is in `hooks/core.ts`, as pure functions that are tested in `tests/core.test.ts`. The wiring is in `hooks/register.ts`.

Built against Claude Code 2.1.293's function-hooks API (early access).
