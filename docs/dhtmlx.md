# dhtmlx-gantt traps

Community build (MIT). Every entry cost real debugging time. Read before
touching `src/gantt` code that talks to the library.

## Licence boundary

- **Typings don't distinguish Community from PRO**: `addTaskLayer` compiles and
  doesn't exist at runtime. No compiler help at the boundary.
- **What ships is a runtime question and `plugins()` answers in silence** (no
  throw, no warning for a missing extension). Probe: `plugins({x: true})` then
  read `gantt.ext`. Measured on 10.0.2 — present: `tooltip`,
  `keyboard_navigation`, `quick_info`, `drag_timeline`, `fullscreen`,
  `export_api`. Absent: `click_drag`, `marker`, `undo`, `multiselect`,
  `grouping`, `overlay`, `auto_scheduling`, `critical_path`.
- **A config for an unregistered extension does nothing, silently.**
  `config.keyboard_navigation = true` with only `{tooltip}` in `plugins()` left
  every key unbound (Tab from an editor landed on the grid scrollbar). The app
  binds `inlineEditors.editNextCell/editPrevCell` itself (they take
  `canChangeRow` and save the cell they leave) instead of loading a mode that
  would claim arrows and Del, which App owns.
- **One gantt instance per app** (no `getGanttInstance()` in Community).
- **Never `gantt.destructor()`** in cleanup — kills the singleton; StrictMode
  remount then re-inits a dead instance (`cannot read tasksStore`). Use
  `clearAll()`.

## Styling

- **Bar colours = CSS custom properties** (`--dhx-gantt-task-background`), set
  inline per task. A stylesheet `background` silently beats a task's colour; set
  the variable instead. A colourless bar falls back to dhtmlx blue: fix the
  default by setting the variable in a rule (inline still wins).
- **A CSS rule beats an SVG presentation attribute** — the allocation profile's
  colour is an inline `style` on the path, not a `fill` attribute.
- **Milestone bar element is `visibility: hidden`**: what paints is
  `.gantt_task_content` rotated 45°. Decoration goes on the *content* (the
  critical ring rotates into a diamond there; an outline on the line paints
  nothing). Content inherits the line's `border-radius` — restate it or the app's
  pill radius rounds the diamond into a blob. `.gantt_milestone` repoints
  `--dhx-gantt-task-background` at dhtmlx violet with the same specificity as
  the app default — hence the default is restated on both classes rather than
  left to import order.
- **`gantt.templates.scale_cell_class` was dropped in v6** and still compiles.
  Scale-cell classes go through `css` on the scale config. `timeline_cell_class`
  lives but shades whole cells — above day scale one cell spans working and
  non-working days, which is why non-working time is drawn as `posFromDate`
  bands instead.

## Rendering lifecycle

- **`onGanttRender` fires before rows are sized** — one render behind for height
  measurements. `onDataRender` fires after rows are in the DOM (today line
  listens to both).
- **dhtmlx rewrites the innards of `$task_bg` and `$bars_area` every render** —
  our elements inside them vanish. `$task_data` is the stable parent; children
  paint in DOM order (before `$bars_area` = under bars, after = over).
  `$task_bg`'s *height* is the full-rows height (the data area itself is only
  viewport-tall and scrolls).
- **Hand-set row classes don't survive a redraw** — classes must come from
  templates. (Also: a re-render replaces the node under the pointer, killing
  hover.)
- **Smart rendering: only bars in view exist in the DOM.** Counting
  `.gantt_task_line` nodes undercounts silently. Read the task data, or
  `showTask(id)` then `getComputedStyle`.
- **Nothing `gantt.init()` depends on may change identity per render** — a
  parent callback baked into the init effect tore down and rebuilt the chart per
  state change (and `ext.zoom.init()` reset the level). Callbacks go into refs;
  init deps stay empty.

## Timeline range and zoom

- **Range is computed at render time only.** `refreshData` redraws bars but
  never scales → a task outside the range is simply not drawn (empty chart, row
  in grid). `zoomToFit` pins the range in `config.start_date/end_date` and the
  pin outranks data — clearing both is part of widening. `fitRangeToPlan` does
  this; `fit_tasks` honours the pin and misses exactly the case that matters.
- **A too-fine zoom level silently crops**: `zoomToFit` clamps anchored at the
  end; no scrollbar, no warning. Coarsest level must fit the longest expected
  plan (month columns ≈ 10 months max). Quarters are custom (`<unit>_start` +
  `add_<unit>`, dhtmlx ships neither).
- **Zoom ext's `useKey` is dead**: binds `mousewheel`, which Chromium no longer
  fires. The app binds `wheel` itself (`passive: false` to stop page zoom;
  `useKey` stays out or Firefox zooms twice). Wheel flicks and pinches arrive as
  bursts → one step per gesture.
- **That wheel listener must be capture-phase and stop propagation**: dhtmlx's
  own handler consumes the event when it scrolls, lets it through only at scroll
  ends — a bubble listener works only at the two extremes. Verification trap: a
  synthetic `wheel` reproduces none of this, and a node cached before a zoom is
  detached by the redraw.
- **`zoomToFit` must run after a load, not inside it**: called inside
  `loadProject` it leaves the ext's level index at `-1`, from which
  `zoomIn/zoomOut` are dead. Invisible in the config; shows only in
  `ext.zoom.getCurrentLevel()`. Fit sits in `App` after `loadProject` returns —
  also right, since undo shares `loadProject` and keeps its viewport.

## Tooltip

- **`tooltip` extension is in Community**; `plugins()` is idempotent (StrictMode
  needs that). It auto-attaches on `onGanttReady` over
  `[data-task-id]:not(.gantt_task_row)` — grid rows included. Replacing it =
  `detach` on that exact selector string (listeners keyed by it), then your own
  `tooltipFor`. The app's is on `.gantt_task_line` only — no tooltip in the grid
  is design (avatars carry native `title`).
- **`tooltip_timeout` > `tooltip_hide_timeout` cancels the tooltip** on a
  bar-to-bar move (hide fires first). Real pointers re-arm via `mousemove`; a
  single synthetic hover doesn't. **Test hovers with two events a pixel apart**;
  a hover onto the pixel already under the pointer fires nothing.
- **Tooltip node lives on `document.body`** (outside dhtmlx's `border-box`
  scope), opens below-right of the pointer; `pointer-events: none` keeps it from
  describing the bar the pointer already left.

## Grid and editors

- **`grid_width` is a budget**: new columns shrink existing resizable ones
  toward `min_column_width`, silently (name column went 230→152px). Compute
  `grid_width` from the columns' widths so the timeline pays instead.
- **`select_task` doesn't select from grid clicks** (only bars). App adds a
  `click` listener calling `selectTask` — on the **bubble** phase: selecting
  re-renders the row, and dhtmlx's delegated handlers only fire while the
  clicked node is still in `$grid`; capture-phase select swallowed clicks on the
  expand arrow and `+`.
- **Inline editors open on a single click**, focus and select — regardless of
  `keyboard_navigation*` configs. Guards on our own dblclick listener were
  bypassed by dhtmlx's click (a summary offered its raw effort 1 next to the
  rolled-up 5). **Editing rules go on
  `inlineEditors.attachEvent('onBeforeEditStart')`** — every way in passes
  through it.
- `resource` is reserved in the task type; the custom field is `resource_id`.
- **`moveTask(id, -1, parent)` appends** (dhtmlx's own indent convention;
  typings just say `tindex: number`).
- **A parent that was a leaf renders collapsed** — set `$open` before
  adding/moving a child under it, or the new row is invisible.
- **`gantt.addTask` returns the id it actually used** (grid `+` hands out a
  timestamp). Use the return value.

## Drag and events

- **`round_dnd_dates` defaults to true and rounds to the finest on-screen scale
  cell** — a few pixels at month scale moves a task to the 1st of the next
  month. Off here; `constraintStart` snaps to the working day instead — **after**
  deciding the start is a constraint at all (else a 13:00 solved start rounds to
  08:00 and reads as a move nobody made).
- **One drag fires `onAfterTaskDrag` and `onAfterTaskUpdate`**, and by the
  second, `applySolution` has already written the solved start onto the row.
  Unconditional pull-back turns derived into input (constraint creeps; drag
  lands twice in undo). `pullFromView` accepts a start only while ≠ solved.
- **`onAfterTaskMove` reports only the new parent**, not sibling reorders — read
  order back off the grid (`getChildren`, not `eachTask`: closed branches still
  have an order), or the reorder dies at the next save/undo.
- **`$task_data` moves with the scroll — don't add the scroll to it.** Pointer →
  date is `dateFromPos(clientX - $task_data.getBoundingClientRect().left)`,
  nothing else (measured rects 673/613/549 at scrolls 0/60/125). Adding
  `getScrollState().x` double-counts — invisible until scrolled. The load lanes
  *do* add it and aren't a precedent: they draw in their own panel.
- **`onGanttScroll`'s `left` argument is stale** in 2 of the 3 firings per
  scroll. `gantt.getScrollState().x` is correct in all three (what the lanes
  read).
- **`ResizeObserver` never fires in the embedded browser** (not even the initial
  callback). dhtmlx measures its container at `init` and window resize only —
  anything of ours changing the chart's height (e.g. the load panel) must call
  `gantt.setSizes()` itself.
- **Refuse links in `onBeforeLinkAdd`**: by `onAfterLinkAdd`, `syncLinks()` has
  written the predecessors and `solve()` throws with the model already mutated.
  `rejectionForLink` is the guard; mouse and script both go through it.
