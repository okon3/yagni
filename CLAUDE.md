# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server on :5173
npm test           # vitest run
npm run test:watch
npm run build      # tsc -b && vite build
npm run lint       # oxlint
```

Run one file or one case:

```bash
npx vitest run src/scheduler/availability.test.ts
npx vitest run -t "compounds a reduced period"
```

There is no vitest config file: it runs off `vite.config.ts` with the defaults.

After a structural CSS change, **restart the dev server** rather than trusting HMR.
Vite has served stale stylesheets here more than once, which looks exactly like a
layout bug that is not there.

## Architecture

Two layers, and the boundary matters:

| Path | Role |
| --- | --- |
| `src/scheduler` | The scheduling engine. No framework, no UI imports, no dhtmlx. |
| `src/gantt` | The view: dhtmlx wiring, file format, dialogs, bar rendering. |

The engine does not know the view exists. Keep it that way — the rendering library
is the replaceable part, the scheduling semantics are not.

### The core idea

**Effort and start date are inputs; the end date is always derived.** Nothing in
the UI may write an end date back into the model.

Stretching a task changes the window in which it is active, which changes what it
overlaps with, which changes the stretching — so the schedule cannot be solved by
a formula. `simulate.ts` is a **discrete-event simulation**: at each event it
recomputes who is active on each resource, divides capacity between them, and
advances the clock to the next event.

The time axis is **working minutes**, not wall-clock time. Nights, weekends,
lunch breaks and company shutdowns are collapsed out of it, which is what makes
capacity constant by construction — the simulation loop contains no calendar
logic at all. `WorkingCalendar` owns every conversion.

### Invariants that must survive a change

Each of these is pinned by a test; if one starts failing, the semantics changed,
not the test.

- **Effort is conserved.** For every task, the sum of `rate × duration` over its
  segments equals its effort.
- **A summary task is never scheduled.** Only leaves consume capacity. A scheduled
  parent would contend with its own children for the same person and halve their
  rate. Effort and dates roll up from the leaves instead.
- **Dependencies are pushed down to leaves.** A dependency on a summary applies to
  its leaves; a summary used as a predecessor expands into its leaves.
- **An availability override replaces the default, it does not multiply it.**
  Someone at 50% with a period at 25% works at 25%.
- **Where overrides overlap, the last declared wins**, so a narrow exception can be
  carved out of a broad period.
- **A task with no resource never contends** and runs at full rate.
- The split between concurrent tasks applies **on top** of whatever capacity the
  resource has at that moment.

### Where to extend

`allocation.ts` holds the allocation policy, and it is the intended seam. It
receives an **already-resolved capacity**, so a policy never has to know about
calendars, absences or part-time. Per-task fixed or capped allocation belongs
here, not in the simulation loop.

### Dates at a day boundary are ambiguous

A working-minute value landing exactly on a day boundary denotes two wall-clock
instants: 17:00 on the day it completes and 08:00 on the next working day. Hence
`fromWorkingMinutes(minutes, edge)`. A bar's end uses `'end'`, a start uses
`'start'`; getting this wrong makes every whole-day task look a day too long.

`ScheduledTask` therefore exposes both the `Date`s (for display) and the raw
working minutes. **Compare the working minutes, not the dates, to test adjacency** —
two contiguous instants render as different wall-clock dates.

## dhtmlx-gantt traps

The view wraps dhtmlx-gantt Community (MIT). These cost real debugging time:

- **The type definitions do not distinguish Community from PRO.** `addTaskLayer`
  compiles cleanly and does not exist at runtime — the Community build deletes it.
  Expect no compiler help at the licence boundary.
- **Bar colours go through CSS custom properties** (`--dhx-gantt-task-background`),
  set inline per task. Overriding `background` directly in a stylesheet silently
  beats a task's own colour. Set the variables instead.
- **A CSS rule beats an SVG presentation attribute.** The allocation profile's
  colour is an inline `style` on the path for this reason; a `fill` attribute
  would be overridden by any stylesheet rule.
- **`gantt.templates.scale_cell_class` no longer exists** — dropped in v6, and it
  still compiles. A class on a scale cell goes through `css` on the scale itself
  (`gantt.config.scales` / a zoom level's `scales`). `timeline_cell_class` is
  still live.
- **A bar with no colour falls back to dhtmlx's own blue, not ours.** Setting
  `--dhx-gantt-task-background` in a rule fixes the default without breaking a
  task that carries a colour: dhtmlx sets that variable inline, which outranks
  the rule.
- **When verifying anything visual, read `getComputedStyle`** — not the attribute,
  not the data field. Both of the bugs above were invisible from the code.
- **Nothing that `gantt.init()` depends on may change identity per render.** The
  init effect depends on `applySolution`, so a parent callback baked into it
  (`onChange`) tore the chart down and rebuilt it on every state change in `App`
  — and `gantt.ext.zoom.init()` reset the zoom level each time. Parent callbacks
  go into refs; the effect's dependencies stay empty in practice.
- **Never call `gantt.destructor()`** in cleanup. It leaves the singleton unusable
  and StrictMode's mount/unmount/mount then re-inits a dead instance
  (`cannot read tasksStore`). Use `clearAll()`.
- **There is exactly one gantt instance per app.** Community has no
  `getGanttInstance()`, so a second chart is not possible without PRO.
- **Inline editors have no mouse trigger of their own.** Opening them needs
  `keyboard_navigation_cells`, a listener in the **capture** phase (dhtmlx stops
  the dblclick before it bubbles), and taking focus **one frame later** — the
  click settles focus after the handler returns.
- `resource` is a reserved field name in the task type; the custom field is
  `resource_id`.

The engine is the source of truth. The flow is: edit → pull into the model →
`solve()` → write the results back onto the dhtmlx tasks → `refreshData()`. That
last call redraws without firing the update events that would bounce straight back
into the handler; an `applying` flag guards the rest.

## File format

`.gantt` is JSON, currently **version 2**, and stores **inputs only** — computed
ends and durations are recomputed on load, so a file can never hold a schedule
inconsistent with its own premises.

Parsing is deliberately strict and refuses rather than repairs: unknown resources,
duplicate ids, dangling predecessors, circular hierarchy, availability outside
0..1, future versions. Parse before loading, so a bad file leaves the open project
untouched. Version 1 files still load, their `daysOff` read as overrides at zero.

Dates are written as local wall-clock (`YYYY-MM-DDTHH:mm`). `toISOString` would
shift them to UTC and move an 08:00 start to the previous day.

Days off and holidays are `YYYY-MM-DD` strings, not `Date`s: they are calendar
days, and a `Date` carries a time and a zone that can push a holiday onto the
neighbouring day.

## Conventions

- **Code, comments and commit messages in English. The UI is in Italian.**
- Comments carry the *why* — non-obvious behaviour, or a deliberate deviation.
  Never the *what*, never the previous state of the code.
- **One commit per completed, tested feature**, and the README goes in the *same*
  commit — it documents the scheduling semantics and must not drift.
- Before committing: `npm test`, `npm run build`, `npm run lint` all clean.
- Verify UI work in the browser, not by asserting it works. Several bugs here
  were only visible at runtime.
