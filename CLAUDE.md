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
- **A derived start is never taken as a constraint.** Every view shows the
  solved start, and every save hands it back, so `constraintStart` in
  `project.ts` accepts a start only while it differs from the solved one — the
  rule `pullFromView` had for the drag, applied to every write. Without it a
  rename walks the declared start forward to wherever the plan currently puts
  the task, and the plan changes on the day the predecessor holding it goes.
- **A declared start is a working day, not an instant.** One accepted as a
  constraint is snapped to that day's opening, and a closed day moves on to the
  next open one — the calendar owns the hours, so the only part of a start
  anyone chose is which day it is.
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

A **milestone is one such value seen from both sides at once**: it starts and ends
on the same minute, so the engine reports 08:00 for its start and 17:00 the day
before for its end. `pinMilestones` in `project.ts` collapses it onto one of the
two before anything downstream sees it — the diamond, the dialog and `getPlan()`
would otherwise disagree, and a lone milestone would read as ending before it
starts. It chooses from the **predecessors**, never from the start constraint:
the constraint says where the milestone was asked to be, and only what closes on
it can say which of the two instants it ended up on. `rollUp` takes a summary's
dates from its children's own for the same reason — converting their extreme
minutes again no longer agrees with them.

So `start` is no longer `fromWorkingMinutes(startWorkingMinutes, 'start')` for
every row, and the general rule follows: **to show or export an instant, read the
`Date` the schedule carries; never convert its minutes a second time.** Whoever
built the schedule has already chosen a side of the boundary, and a second
conversion is free to choose the other one — silently, since both answers are
valid dates. `rollUp` and the load lanes' horizon each cost a debugging session
to this; the lanes read `projectEnd` for the plan's last minute rather than
converting it.

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
- **`onGanttRender` fires before `refreshData` has sized the rows**, so anything
  measuring the chart's height from it is one render behind. `onDataRender` fires
  after the rows are in the DOM; the today line listens to both.
- **The data area is only as tall as the viewport** and scrolls its contents, so
  an overlay stretched to its edges stops at the first screenful.
  `gantt.$task_bg` is the layer sized to hold every row — its *height*, not its
  contents: dhtmlx rewrites the innards of `$task_bg` and `$bars_area` on every
  render, so an element of ours put inside either one is gone by the next one.
  `$task_data` is the stable parent, and its children paint in DOM order: before
  `$bars_area` is under the bars, after it is over them.
- **A class written onto a row by hand does not survive a redraw.** dhtmlx
  rebuilds the grid rows and the bars on `refreshData`, so a class of ours has to
  come from a template — which is why every row carries one per person working on
  it or below it, and highlighting someone is a single injected stylesheet rule.
  Doing it through a re-render would also replace the node the pointer is on, and
  the pointer would then have to move before anything fired again.
- **The timeline range is computed at render time, and nowhere else.**
  `refreshData` redraws the bars from the model but never the scales, so a task
  whose dates fall outside the current range is simply not drawn — an empty chart
  with the row present in the grid. On top of that `zoomToFit` pins the range in
  `config.start_date` / `config.end_date`, and from then on the pin outranks the
  data: clearing both is part of widening the window. `fitRangeToPlan` does this,
  and is deliberately not `fit_tasks`, which honours the same pin and so misses
  exactly the case that matters.
- **A zoom level too fine for the project silently crops it.** `zoomToFit` picks
  the coarsest level that fits and then clamps the range, anchored at the end,
  and smart rendering does not draw a row whose bar falls outside that range —
  so the chart shows a partial plan with no scrollbar and no warning. The
  coarsest level must therefore be coarse enough for the longest plan expected;
  a column per month tops out around ten months. Quarters are a custom unit:
  dhtmlx builds one from `<unit>_start` and `add_<unit>`, and ships neither.
- **The zoom extension's `useKey` is dead on arrival.** `zoom.init({ useKey:
  'ctrlKey' })` binds `mousewheel` on anything that is not Firefox, and Chromium
  no longer fires that event at all — a probe on `document` for both names sees
  only `wheel`. It compiles, it configures, and nothing happens. The app binds
  `wheel` itself, with `passive: false` so `preventDefault` can stop the browser
  zooming the page, and `useKey` stays out of the config or Firefox would zoom
  twice per notch. A wheel flick and a trackpad pinch both arrive as bursts, so
  the handler takes one step per gesture, not per event.
- **That listener has to be on the capture phase**, and stop the propagation.
  dhtmlx scrolls the chart on the wheel from a handler on the data area, and
  when it actually scrolls it consumes the event — when it is already at the
  end of the scroll it returns `true` instead and lets it through. A listener
  on the bubble phase therefore fires only at the two ends: zoom in works at
  the top, zoom out at the bottom, nothing works in between. Which is also a
  warning about the verification: a synthetic `wheel` reproduces none of this,
  and a synthetic one dispatched on a node cached before a zoom reaches nothing
  at all — the redraw replaced the node, and a detached element no longer has
  the container among its ancestors.
- **`zoomToFit` has to run after a load, not inside it.** Called from within
  `loadProject`, between the `parse` and the end of the load, it picks the right
  scale and draws the right range — and leaves the extension's own level index
  at `-1`, from which `zoomIn`/`zoomOut` do nothing at all: the `+` and `−`
  buttons are dead until something sets a level again. The configuration is
  identical either way, so this is invisible in the config and only shows in
  `gantt.ext.zoom.getCurrentLevel()`. Fitting on open therefore sits in `App`,
  after `loadProject` returns, which is also where it belongs — an undo shares
  `loadProject` and must keep its viewport.
- **The `tooltip` extension *is* in Community**, unlike `addTaskLayer` — the bundle
  lists it among the built-in extensions, so `gantt.plugins({ tooltip: true })`
  works, and `plugins()` is idempotent, which StrictMode's second mount needs. It
  attaches a tooltip of its own on `onGanttReady`, over
  `[data-task-id]:not(.gantt_task_row)` — the **grid rows** as much as the bars.
  Replacing it means `detach` on that exact selector string, since the listeners
  are keyed by it, and then a `tooltipFor` of one's own. **The app's replacement
  is on `.gantt_task_line` only**, so the rich tooltip exists on the bars and
  nowhere in the grid — where the idiom is the native `title` the avatars carry.
  Hovering a grid cell and finding nothing is the design, not a broken hover.
- **`tooltip_timeout` above `tooltip_hide_timeout` cancels the tooltip** on a move
  from one bar straight to another: leaving schedules the hide, entering schedules
  the show, and the hide fires first and cancels it. A real pointer keeps firing
  `mousemove` and every one of them re-arms the show, so a person never sees this —
  a single synthetic `hover` sees nothing else. **Two hovers a pixel apart is the
  cheapest way to make a hover test mean anything**, and a hover onto the very
  pixel the pointer already sits on fires no event at all.
- **The tooltip node lives on `document.body`**, so it is outside the
  `box-sizing: border-box` dhtmlx sets for `.gantt_container *`, and it opens
  below-right of the pointer — over whatever the pointer is heading for.
  `pointer-events: none` is what stops it going on describing the bar the pointer
  has already left.
- **`grid_width` is a budget, not a total.** The grid holds it and shrinks its
  resizable columns towards `min_column_width` to fit, so a new column is paid for
  by the ones already there — adding two took the name column from 230px to 152px,
  in silence and with no horizontal scrollbar to show for it. Computing
  `grid_width` from the columns' own widths is what makes the timeline pay instead.
- **`gantt.templates.scale_cell_class` no longer exists** — dropped in v6, and it
  still compiles. A class on a scale cell goes through `css` on the scale itself
  (`gantt.config.scales` / a zoom level's `scales`). `timeline_cell_class` is
  still live, but it can only shade a whole cell: above day scale one cell spans
  working and non-working days alike, which is why non-working time is drawn as
  bands positioned with `posFromDate` instead.
- **A bar with no colour falls back to dhtmlx's own blue, not ours.** Setting
  `--dhx-gantt-task-background` in a rule fixes the default without breaking a
  task that carries a colour: dhtmlx sets that variable inline, which outranks
  the rule.
- **A milestone's bar element is `visibility: hidden`.** `type:
  gantt.config.types.milestone` exists in Community and does the whole job —
  position, width, link routing — but what it paints is the `.gantt_task_content`
  inside the line, rotated 45°, with the line itself hidden. So anything meant to
  be seen has to sit on the *content*: the critical ring goes there, where it
  rotates into a diamond of its own, and an outline left on the line paints
  nothing at all. The content also inherits the line's `border-radius`, so the
  pill radius this app puts on every bar rounds the diamond into a blob until it
  is restated — and `--dhx-gantt-task-background` is repointed at dhtmlx's own
  violet by `.gantt_milestone`, a rule of the same specificity as the app's
  default on `.gantt_task_line`, which is why the default is restated on two
  classes rather than left to the order the stylesheets are imported in. A task
  that carries a colour still wins over both: dhtmlx sets that variable inline.
- **When verifying anything visual, read `getComputedStyle`** — not the attribute,
  not the data field. Both of the bugs above were invisible from the code.
- **Only the bars in view exist in the DOM.** Smart rendering leaves a bar out of
  `$bars_area` until its row and its dates are on screen, so counting
  `.gantt_task_line` nodes to check a class of ours undercounts in silence — the
  mark is on the task, the element is not there to carry it. Read the field off
  the task data, or `showTask(id)` first, then `getComputedStyle`.
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
- **`select_task` does not select from the grid.** Clicking a bar selects the
  row, clicking a grid cell does not — which leaves a keyboard action like Del
  with nothing to act on. A `click` listener calling `gantt.selectTask` covers
  it, but it has to sit on the **bubble** phase: selecting re-renders the row,
  and dhtmlx dispatches its own delegated handlers only while the clicked node
  is still a descendant of `$grid`. Selecting first detaches it and the click is
  swallowed, and the expand/collapse arrow and the `+` button of a row that is
  not already selected then need a second click.
- **The keyboard navigation extension is not in Community.** `gantt.ext` holds
  `inlineEditors`, `zoom` and `tooltips` but no `keyboardNavigation`, so
  `keyboard_navigation` and `keyboard_navigation_cells` configure nothing that
  ships here and every key it would have bound is unbound: inside an open
  editor, Tab fell through to the browser and landed on the grid's *scrollbar*
  with the editor still open behind it, and Enter did nothing at all — the only
  way to commit a typed value was to click elsewhere. The moves themselves are
  on `inlineEditors` (`editNextCell`/`editPrevCell`, which take a
  `canChangeRow`, and each saves the cell it leaves), so binding them is a
  listener, not a reimplementation.
- **An inline editor opens on a single click**, focuses its field and selects
  its text, with no help and no configuration — `keyboard_navigation` and
  `keyboard_navigation_cells` both `false` at init change none of it. So a
  double-click listener of ours was a second way to the same thing, and worse
  than redundant: the guard it carried against editing a summary's rolled-up
  columns was one dhtmlx's own click walked straight past, which is how a
  summary came to offer an editor holding its raw effort of 1 beside a cell
  reading the 5 its children sum to. **A rule about editing goes on
  `inlineEditors.attachEvent('onBeforeEditStart')`**, which every way in passes
  through — the click, Tab arriving from the cell before, a script, and the
  double click a person makes out of the first of those.
- `resource` is a reserved field name in the task type; the custom field is
  `resource_id`.
- **`moveTask(id, -1, parent)` appends** at the end of the new parent's children.
  That is the convention dhtmlx's own shift+right indent uses; the typings only
  say `tindex: number`.
- **A parent that was a leaf until a moment ago renders collapsed**, so a row
  created or moved under it is invisible. Set `$open` on the parent first.
- **`gantt.addTask` returns the id it actually used**, which is not always the one
  supplied — the grid's `+` hands out a timestamp. Use the return value.
- **`round_dnd_dates` defaults to `true`**, and what it rounds to is the cell of
  the *finest scale currently on screen* — not a day. So the same gesture means
  something different at every zoom: 23/09 11:37 lands on 23/09 by day, on
  Monday 21/09 by week and on **1 October** by month or quarter, which is where
  a plan long enough to need those views is always sitting. A nudge of a few
  pixels then moves a task eight days, in silence, on every task and not only on
  milestones. It is off here, and `constraintStart` snaps the raw instant to the
  working day instead — **after** deciding the start is a constraint at all, or
  the 13:00 solved start of a task held by a predecessor rounds to 08:00 and
  reads as a move nobody made.
- **One drag is reported twice**, as `onAfterTaskDrag` and `onAfterTaskUpdate`,
  and by the time the second one arrives `applySolution` has already written the
  *solved* start onto the row. Pulling `start_date` back in unconditionally
  therefore turns a derived value into an input — the constraint creeps forward
  to the scheduled date on its own, and the drag lands in the undo history twice,
  the first Ctrl+Z appearing to do nothing. `pullFromView` accepts the row's
  start only while it differs from the solved one.
- **`onGanttScroll`'s `left` is not where the chart is.** One scroll fires the
  handler three times, and two of the three report the position the chart has
  just left rather than the one it reached — so anything following the timeline
  from the argument settles wherever the last stale report happened to land, off
  by the length of the scroll. `gantt.getScrollState().x` is already correct in
  all three, and is what the load lanes read.
- **`ResizeObserver` never fires in the embedded browser**, not even the initial
  callback the spec mandates — a probe on a plain div resized by hand sees
  nothing. So the observer that calls `gantt.setSizes()` when the container
  changes size does nothing there, and dhtmlx measures its container at `init`
  and on a window resize only. Anything of ours that changes the chart's height,
  such as opening the load panel under it, has to call `setSizes()` itself:
  otherwise the layout keeps the height it had, and the horizontal scrollbar sits
  below the container where it cannot be reached.
- **A link has to be refused in `onBeforeLinkAdd`.** By `onAfterLinkAdd`,
  `syncLinks()` has already written the predecessors into the model, so `solve()`
  throws inside the handler and leaves the project holding a schedule it cannot
  solve — with only an uncaught error to show for it. `rejectionForLink` is the
  guard, and both the mouse and the script go through it.

## The agent API

`window.yagni` (`src/gantt/agentApi.ts`) is an **adapter, not a feature**: every
operation delegates to the same `GanttHandle` the buttons use, so a rule must
never exist in both. It mounts in `App`, because `filename`, `dirty` and the task
count are `App` state; the object is built once and reads them through a ref, as
a value closed over would go stale on the first rename.

It departs from the buttons in exactly three ways, each because a script cannot
do what a person does: nothing is confirmed (a `<dialog>` awaiting a click would
hang it), errors throw instead of returning silently, and patches are partial.

Not everything the buttons do belongs on the surface. The test is reach, not
parity: expose an operation when a script cannot reach the same outcome by
composing what is already there, and leave it out when it is a shortcut for a
sequence an agent can already write. Either way the surface only exists as far as
`agentApi.help.md` describes it, so weigh that file on every change that moves it.

`yagni.help()` and `/llms.txt` are one file — `agentApi.help.md`, imported with
`?raw` and emitted by a Vite plugin. Do not add a second copy.

The engine is the source of truth. The flow is: edit → pull into the model →
`solve()` → write the results back onto the dhtmlx tasks → `refreshData()`. That
last call redraws without firing the update events that would bounce straight back
into the handler; an `applying` flag guards the rest.

## Confirmations

`window.confirm` is unusable here: the app runs inside an embedded browser that
suppresses native dialogs — the call returns `false` in no time at all and shows
nothing. Every guarded action then becomes a silent no-op: a deletion that never
happens, a file that never opens. Ask through `ConfirmDialog` instead, which App
owns and hands out as a promise; a nested `<dialog>` stacks correctly above the
one that asked.

**`window.print()` is the exception, and it blocks.** Where `confirm` returns
`false` and shows nothing, `print()` opens the real print dialog — modal, and
invisible while the browser pane is hidden. Every script on the tab then hangs
until it is dismissed, which cannot be done from here: the tab has to be closed
and reopened. So the print path is verified by dispatching `beforeprint` on
`window`, which is what the browser itself dispatches and what `printPlan`
listens to; the sheet of paper needs a person.

And **a React-controlled field cannot be filled from the browser tool's own
scripting context**: the value tracker ignores a plain assignment, and calling
`HTMLInputElement.prototype`'s native setter from there throws *Illegal
invocation*. Injecting a `<script>` element with that same code runs it in the
page's context, where the setter works and the `input` event reaches React —
which is how the details dialog's date field gets driven in a verification.

**A key pressed by the browser tool carries no `keyCode` and no `code`.** The
event is trusted and `event.key` is right, but `keyCode` and `which` are `0` and
`code` is empty — so a handler of ours reading `event.key` sees the keystroke
while dhtmlx's own, which still reads `keyCode`, does not. Escape closing an
inline editor is exactly that: it works under a real keyboard and cannot be made
to work from here, which is why it took a person to settle. Nor is the tool's key
naming the DOM's: `Return` arrives with an **empty** `key` and does nothing at
all, while `Enter` arrives as `Enter`. A key that appears to do nothing is
therefore two questions, not one.

## Undo and the draft

`history.ts` holds whole-project snapshots (`serializeProject` text), and `App`
records one **in the chart's `onChange`** — the single funnel every model change
already goes through, from a dialog to a script. An edit path that does not end
in `applySolution` is an edit outside the undo history: route it there rather
than pushing a snapshot of its own.

`dirty` is **derived**: the present snapshot against the text last saved. Do not
reintroduce a `setDirty` — an edit that changes nothing then stops claiming it
did, and undoing back to the saved state clears the marker.

Restoring goes through `loadProject`, which is also how a file is opened; only
the viewport handling differs, and the zoom survives because it lives in the
extension rather than in the data.

The autosaved draft is read at the **first render**, not in an effect: the effect
that keeps storage in step clears it as soon as nothing is unsaved, which on
mount is the case. And it must not clear while the question about it is on
screen — until it is answered, storage holds the only copy of that work.

## File format

`.gantt` is JSON, currently **version 2**, and stores **inputs only** — computed
ends and durations are recomputed on load, so a file can never hold a schedule
inconsistent with its own premises.

Parsing is deliberately strict and refuses rather than repairs: unknown resources,
duplicate ids, dangling predecessors, circular hierarchy, availability outside
0..1, future versions. Parse before loading, so a bad file leaves the open project
untouched. Version 1 files still load, their `daysOff` read as overrides at zero.

**A gap in that strictness is not a bad error message, it is the open project.**
`loadProject` writes the incoming project onto `projectRef` and *then* solves, so
a file that parses but cannot be scheduled — a person the file leaves at zero
capacity was the last way in — throws `Scheduler stalled` with the model already
replaced: the grid still shows the old rows, every further edit dies on a task
dhtmlx does not have, and the next save writes the malformed project over the
user's work. Hence the people list goes through `validateResources` here as well
as in the dialog and the agent API: one gate, checked on every path in.

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
  commit — it documents the scheduling semantics and must not drift. So does
  `agentApi.help.md` when the commit moves the agent surface: it is all the
  documentation an agent gets, and a stale one is worse than none.
- Before committing: `npm test`, `npm run build`, `npm run lint` all clean.
- Verify UI work in the browser, not by asserting it works. Several bugs here
  were only visible at runtime.
