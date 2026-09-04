# CLAUDE.md

Guidance for Claude Code working in this repository.

## Commands

```bash
npm run dev            # Vite dev server on :5173
npm test               # vitest run
npm run test:watch
npm run build          # tsc -b && vite build
npm run build:single   # everything inlined into one index.html
npm run lint           # oxlint
npx vitest run src/scheduler/availability.test.ts   # one file
npx vitest run -t "compounds a reduced period"      # one case
```

No vitest config file: it runs off `vite.config.ts` with defaults.

After a structural CSS change, **restart the dev server** — Vite has served
stale stylesheets here more than once, indistinguishable from a layout bug.

## Architecture

| Path | Role |
| --- | --- |
| `src/scheduler` | Engine. No framework, no UI imports, no dhtmlx. |
| `src/gantt` | View: dhtmlx wiring, file format, dialogs, rendering. |

The engine does not know the view exists — the rendering library is replaceable,
the scheduling semantics are not.

**Effort and start are inputs; end is always derived.** Nothing in the UI may
write an end date into the model. `simulate.ts` is a discrete-event simulation on
a **working-minutes** axis (no calendar logic in the loop; `WorkingCalendar` owns
conversions). Extension seam: `allocation.ts` — receives already-resolved
capacity, never sees calendars. Read [docs/scheduling.md](docs/scheduling.md)
before changing the engine.

## Invariants (each pinned by a test)

If one fails, the semantics changed, not the test.

- **Effort conserved**: Σ(rate × duration) over a task's segments = its effort.
- **A summary is never scheduled** (it would contend with its own children).
  Effort/dates/resource roll up from leaves; the file omits its `resourceId`.
- **Dependencies are pushed down to leaves**, on both ends of a link.
- **An availability override replaces the default** (never multiplies);
  **overlapping overrides: last declared wins**. Absence = override at zero.
- **A derived start is never a constraint.** Everything shows the solved start
  and hands it back on save, so `constraintStart` (`project.ts`) accepts a start
  only while it differs from the solved one — else a rename walks the constraint
  forward.
- **A declared start is a working day**: snapped to its opening; closed day →
  next open one.
- **`project.tasks` order = row order.** `onAfterTaskMove` reports only the new
  parent, so reorders must be read back off the grid (`getChildren`, not
  `eachTask`).
- **A task with no resource never contends** (full rate); the concurrent-task
  split applies **on top** of the resource's current capacity.

## Day-boundary rule

A working-minute on a day boundary = two instants (17:00 / next 08:00) —
`fromWorkingMinutes(minutes, edge)`. **Compare working minutes, not dates, for
adjacency**, and **never convert a schedule's minutes a second time**: read the
`Date` it carries (the builder already chose a boundary side; a second conversion
silently picks its own). `pinMilestones` and `rollUp` exist for this; it has cost
two debugging sessions. Details: [docs/scheduling.md](docs/scheduling.md).

## dhtmlx-gantt

Community build, rendering only. Typings don't distinguish Community from PRO,
and `plugins()` is silent about what the build lacks. **Read
[docs/dhtmlx.md](docs/dhtmlx.md) before touching code that talks to the
library.** Fastest biters:

- Never `gantt.destructor()` — `clearAll()`; StrictMode remounts.
- Bar colours via `--dhx-gantt-task-background` (inline per task); never
  override `background` in a stylesheet.
- Refuse links in `onBeforeLinkAdd` (later is too late — model already mutated).
- Editing rules go on `inlineEditors.attachEvent('onBeforeEditStart')` — every
  way in passes through it.
- Nothing `gantt.init()` depends on may change identity per render — parent
  callbacks go into refs.
- Verify visuals with `getComputedStyle`; off-screen bars have no DOM node.

## Agent API

`window.yagni` (`src/gantt/agentApi.ts`) is an **adapter, not a feature**: every
op delegates to the same `GanttHandle` the buttons use — a rule must never exist
in both. Three deliberate departures: nothing confirmed, errors throw, patches
partial. Expose an op only when a script can't compose it from what exists.
`agentApi.help.md` **is** `yagni.help()` and `/llms.txt` (one file, `?raw` import
+ Vite plugin) — never a second copy; update it in the same commit that moves the
surface.

Data flow: edit → pull into model → `solve()` → write onto dhtmlx tasks →
`refreshData()` (fires no update events; an `applying` flag guards the rest).

## Undo and the draft

`history.ts`: whole-project snapshots, recorded in the chart's `onChange` — the
single funnel for every model change. An edit path not ending in `applySolution`
is outside the undo history: route it there, never push snapshots of your own.
`dirty` is **derived** (snapshot vs last-saved text) — never reintroduce a
`setDirty`. Restore goes through `loadProject`, like a file open; only viewport
handling differs.

The autosaved draft is read at **first render**, not in an effect (the sync
effect clears it on mount), and must not be cleared while its question is on
screen — storage holds the only copy until answered.

## File format

`.gantt` JSON v2 (v1 loads: `daysOff` → overrides at zero). Inputs decide the
schedule; a save adds a `solved` report (ignored on load, for agents reading the
file raw). History/draft/`dirty` use input-only text; the file is written
compact. Dates local wall-clock `YYYY-MM-DDTHH:mm`; calendar days `YYYY-MM-DD`
strings. Parsing strict, refuses rather than repairs, and the gate holds on
**every** path in (`validateResources` included — a parseable-but-unschedulable
file would replace the open project). Details:
[docs/file-format.md](docs/file-format.md).

## Confirmations and verification

`window.confirm` returns `false` instantly in the embedded browser — use
`ConfirmDialog`. Verify UI in the browser, not by asserting it works; read
[docs/verification.md](docs/verification.md) first (print, Escape, hover,
React-controlled fields, `ResizeObserver` — what synthetic input can and cannot
prove).

## Documentation map — keep it current

| File | Contents |
| --- | --- |
| `README.md` | Shop window: features, screenshots, quick start. Sells, doesn't document. |
| `docs/scheduling.md` | Engine semantics: simulation, float, availability, day boundaries. |
| `docs/view.md` | UI decisions and their reasons. |
| `docs/file-format.md` | `.gantt` v2, strict parsing, CSV/PNG/print. |
| `docs/dhtmlx.md` | Library traps — add every new one. |
| `docs/verification.md` | Embedded-browser quirks, verifying UI from an agent. |
| `src/gantt/agentApi.help.md` | Agent surface. **Is** `yagni.help()` and `/llms.txt`. |
| `CHANGELOG.md` | Releases a user cares about. Newest first; the header badge shows the top entry. |

**A commit that changes behaviour described in `docs/` updates the affected file
in the same commit.** Docs are written tersely — keep them that way: every fact,
no prose. README changes only when the feature set changes; retake
`docs/assets/` screenshots when the UI drifts enough to misrepresent them. A
significant feature adds a bullet to `CHANGELOG.md` in the same commit (a new
version heading when a release warrants it) — features a user would notice,
not fixes or plumbing, and never exhaustive: it holds the recent releases
only, oldest entries get pruned. Git history is the full record.

## Conventions

- **Code, comments, commits in English. UI in Italian.**
- Comments: the *why* only — never the *what*, never the previous state.
- One commit per completed, tested feature, docs included.
- Before committing: `npm test`, `npm run build`, `npm run lint` all clean.
