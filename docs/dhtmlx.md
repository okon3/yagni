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
- **`--dhx-gantt-task-border` is a whole `border` shorthand, in the same rule
  as `box-sizing: border-box`.** A bare colour paints nothing (`border-style:
  none`) while `borderColor` still reports it — a border that never existed
  can measure as a colour. Once it paints, it eats the content box (24px bar →
  22px, summary 10px → 8px): anything sized against the bar's inner height
  moves. `.gantt_milestone{border:none}` outranks the variable (0,2,0 vs
  0,1,0), so a milestone never gets a ring.
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
- **The built-in dark theme is an attribute, not a media query**:
  `:root[data-gantt-theme=dark]` re-points ~20 `--dhx-gantt-base-colors-*`. Our
  JS sets it (`theme.ts`, from `prefers-color-scheme`) — and so does dhtmlx
  itself, next bullet — and its canvas is `#141414`, nothing like the app's
  surface, so `gantt.css` re-points those base colours at the palette. Two
  traps in one rule there: a bare
  `:root[data-gantt-theme=dark]` of ours only **ties** with dhtmlx's, leaving the
  winner to Vite's bundling order (`html:root[…]` outranks it), and keying on the
  attribute alone would leave the chart light if a `change` event went missing —
  hence the media query beside it.
- **dhtmlx writes that attribute back, on a 100ms poll**: `setSkin` calls
  `_addThemeClass()` → `documentElement.setAttribute('data-gantt-theme', skin)`,
  while a `setInterval(…, 100)` on `gantt.$root` reads `--dhx-gantt-theme` and
  calls `setSkin` whenever it differs from `gantt.skin`. Every theme's block
  declares that variable to its own name, so attribute → variable → poll →
  attribute is a fixed point and a clean load writes nothing (value already
  equals skin). Three consequences. **Forcing the attribute in a verification
  measures a state the app never produces**: forcing `dark` latches
  `gantt.skin`, so removing it afterwards makes the poll write `terrace` back —
  an agent that reads `terrace` on a light page produced it itself (`theme.ts`
  is right, absent is the default). Nothing ever sets `material`, which is why
  its 16px link handle cannot appear — but `gantt.setSkin('material')` would
  silently widen the label padding that consumes it. And `contrast-white` /
  `contrast-black` both declare the variable as plain `contrast`, which has no
  block of its own, so the poll rewrites the attribute to an inert value.
- **The splitter-drag veils are literal light greys, not variables** — during a
  layout resize both panes take `.gantt_resizing` (`#f2f2f2`, opacity .7) and
  other resizes paint `.gantt_grid_resize_area`/`.gantt_row_grid_resize_area`
  (`#e7e7e780`); no theme or base-colour re-pointing reaches them, so in dark
  they flash as bright bars for the length of the drag. Overridden in
  `gantt.css`'s dark block. Synthetic note: the drag state arms on
  `pointerdown` + `pointermove` (plain `mousedown` does nothing), and a
  synthetic `pointerup` does not fully disarm it — reload after emulating.
- **`gantt.templates.scale_cell_class` was dropped in v6** and still compiles.
  Scale-cell classes go through `css` on the scale config. `timeline_cell_class`
  lives but shades whole cells — above day scale one cell spans working and
  non-working days, which is why non-working time is drawn as `posFromDate`
  bands instead.
- **The link handle's geometry is on `:root`, so other rules can reuse it**:
  `.gantt_link_control.task_right` is `right: 0` plus `translate(100%)` and
  `offset + size` wide, and its dot is `flex-end`-aligned inside — so the dot
  occupies the **outer `size`** of that span (8px to 18px past the bar's
  padding box, at today's values), not the whole of it. Both
  `--dhx-gantt-link-handle-offset` and `--dhx-gantt-link-handle-size` are
  declared on `:root` (size 10px; the 16px variant lives under
  `:root[data-gantt-theme=material]`, which `theme.ts` never sets, so it is
  10px in both our schemes) and therefore inherit into
  `.gantt_side_content.gantt_right` — which is why the label's `padding-left`
  clears the dot with `calc()` on those two variables instead of a copied
  pixel count. The label shares the dot's origin, so the arithmetic is exact.
- **A rule of ours stacked over the bars can steal the link handle's pointer** —
  and one did. `.gantt_side_content.gantt_right` carries `z-index: 2` (`be35a75`,
  to clear the time-off hatch) and shares the dot's origin, so it covered the
  right handle whole. Measured on a task with no link: the dot reachable on 0 of
  10 px, the handle receiving the pointer on 1 px of its 24 — and a mousedown on
  the drawn dot dragged the bar instead, rewriting a declared start.
  `.gantt_link_control { z-index: 3 }` puts the handle back on top (12/12 rows
  sampled, linked and linkless). Anything of ours above a bar must still let the
  pointer reach the handles.
- **`.gantt_side_content.gantt_link_crossing { margin-top: -10px }` is a vendor
  rule**: dhtmlx lifts the label 10px on a task with an outgoing link. Measured,
  not optical — and it is why the handle is partly reachable once a link exists
  and almost unreachable before.

## Rendering lifecycle

- **`onGanttRender` fires before rows are sized** — one render behind for height
  measurements. `onDataRender` fires after rows are in the DOM (today line
  listens to both).
- **dhtmlx rewrites the innards of `$task_bg` and `$bars_area` every render** —
  our elements inside them vanish. `$task_data` is the stable parent; children
  paint in DOM order (before `$bars_area` = under bars, after = over).
  `$task_bg`'s *height* is the full-rows height (the data area itself is only
  viewport-tall and scrolls).
- **`$grid.offsetWidth` is not the timeline's x origin** — two borders sit
  between them, the layout root's own left border and the grid cell's
  `gantt_layout_cell_border_right` (2px here, and `config.grid_width` counts
  the second one while `$grid` does not). The resizer cell is not one of them:
  its `offsetLeft` equals the timeline cell's, so it overlays the timeline's
  first pixel and takes no horizontal space. For an overlay of ours that must
  start where the bars do, measure `$task`'s left against `$root` —
  scroll-invariant, unlike `$task_data`'s, which slides by the scroll offset.
  `$task` is in the typings at the same tier as `$grid` and `$root`.
- **At the horizontal scrollbar's maximum `getScrollState().x` can over-report
  the translation dhtmlx actually applied to `$task_data` — at some device
  pixel ratios, and never by a whole pixel in any condition measured.** The
  cause is measured: the timeline cell's `clientWidth` is the integer rounding
  of a fractional CSS width, so the scroller's maximum and the timeline's
  disagree by that rounding. Worst obtained **0.665px at dpr 1.5**; at dpr
  1.25 ≤0.003px, and at the maximum itself 0; at dpr 1 exactly 0. Only dpr 1,
  1.25 and 1.5 were ever measured — nothing here says what 1.75, 2 or an OS
  zoom do, so a whole-pixel offset on a 175% display does not rule this
  mechanism out. Breadth, per ratio: at dpr 1, 701 grid widths, 101 fractional
  container widths, five zoom levels, the collapsed-grid states, a native
  scrollbar-thumb drag and programmatic overshoot; at dpr 1.5, 221 grid
  widths; at dpr 1.25, three. An earlier note here claimed 1px (2245 against
  2244) and no measured condition reproduces it: a fractional pair printed as
  integers. Read the applied translation instead of asking for it,
  **unrounded** —
  `$task.getBoundingClientRect().left - $task_data.getBoundingClientRect().left`.
  The translation is fractional exactly where it diverges, so rounding it puts
  the overlay off by up to 0.4px in states where `getScrollState().x` was
  exact.
  **The recipe has a CSSOM ceiling**: an inline `left` serialises to six
  significant digits, so the fraction survives only while the offset is small
  — measured, `-1708.8337` kept `-1708.83px` but `-34178.6667` became
  `-34178.7px`, and a seven-digit offset rounds to whole pixels. Under the
  device pixel today; a long enough timeline eats the exactness the unrounded
  read buys.
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
  **That rule is about React identity, not about talking to the library**:
  `gantt` is a module singleton (*Licence boundary*), so code under
  `src/gantt/` that touches no ref may import it directly — only
  `useCallback`/ref values reaching the init effect are constrained.
- **Every registration on `gantt`, `document` or the container returns its own
  detach**, and the init effect's cleanup calls it. StrictMode mounts twice: a
  module that registers without handing back how to undo it leaks a listener
  per remount.
  **A configuration slot is not a registration**: `gantt.templates.*` and
  `config.columns` are single-valued fields the init effect overwrites, so a
  remount replaces them instead of stacking them and there is nothing to undo
  — measured on `gridColumns.ts`, whose six templates are the same function
  objects across a remount and run once per visible row. A module that fills
  slots is named `install*`, one that registers `attach*`/`mount*`; only the
  second owes a detach.

## Timeline range and zoom

- **Range is computed at render time only.** `refreshData` redraws bars but
  never scales → a task outside the range is simply not drawn (empty chart, row
  in grid). `config.start_date/end_date` pin it and outrank the data;
  `fitRangeToPlan` re-pins on the plan plus the widest task name, `zoomToFit`
  pins on the plan alone. `fit_tasks` honours the pin and misses exactly the
  case that matters.
- **Both keys or neither**: the pin is read only when `start_date` **and**
  `end_date` are set — `end_date` alone does nothing.
- **The library's own padding is one column, conditionally.** Pinned, it floors
  the end to the column and adds one *only* if the end fell mid-column: land on
  a boundary and the margin is zero. Unpinned, the range comes from the data
  padded by ±1 column of the level's finest scale (`scales[1]`, so `day` and
  `week` levels pad identically). A margin that has to hold something — a name
  beside the last bar — is counted in `config.min_column_width`, the narrowest a
  column ever renders at: columns stretch to fill the timeline and give that
  stretch back as their number grows, so the width on screen comes out short.
- **`zoomToFit` preserves a pin it finds**: `rangeMode` defaults to `preserve`
  as soon as both config keys are set, so Fit then only picks a level. Worse, it
  saves the pin on its first run and restores it on every later one — a range
  the plan has since outgrown comes back, and the bars past it are drawn clamped
  on the timeline's edge, lying about their dates. The app spells
  `rangeMode: 'target'` out. Measured without it: one Fit, then a plan grown to
  3 Nov, then Fit again → `max_date` back to 19 Oct, last bar clamped. Fit's own
  pin does not survive either way — the `onAfterZoom` below replaces it as soon
  as the level lands — but under `target` the level is applied against the
  plan's range instead of the restored one, and the scroll centres on the plan
  rather than on wherever the viewport happened to be.
- **`onAfterZoom` is where a pin measured in pixels is re-measured**: the same
  two dates are worth fewer of them once the columns are coarser. Recomputed
  there from plan and level, never repaired against the standing pin — widening
  only would keep every widening the coarse levels needed and ratchet the range
  up over a zoom out and back (measured: `day` reached straight, 2470px past the
  last bar; the same plan reached via `Years`, 10590px). `render()` inside that
  handler does not recurse — the event is fired by `_applyChartConfig` and by
  `_applyState` (`resetZoom`, `_abortFit`, neither reachable from this app),
  both of which render *before* firing it and neither of which `render` goes
  through (measured: one event per zoom step, widening or not). It fires
  **after** the extension's own render and its scroll, so a widening there is a
  second render landing on the centring just done — measured harmless, the
  visible date held on every step. A step that leaves the pin where it is costs
  one render, a step that moves it two. Nothing fires before `gantt.init()`:
  `_applyChartConfig` guards on `$root`.
- **A range narrower than the plan crops silently**: the bars past it pile on
  the timeline's right edge, and when the range is narrow enough that the
  timeline no longer overflows the viewport there is no scrollbar either —
  nothing says a bar is missing. Measured: a 20-year plan pinned to Sep–Dec 2026
  → 556px of timeline against a 556px viewport, max scroll 0, all 20 bars on the
  edge. **No path in the app reaches that state.** `fitRangeToPlan` and the
  `onAfterZoom` repin above pin a range that holds the plan, so even `zoomToFit`
  called with the library's default `rangeMode` lands on the canonical one —
  measured on that plan, both routes gave the same pin, 6090px of timeline
  against a 541px viewport, a scrollbar, no bar on the edge. The coarsest level
  does **not** fit an arbitrarily long plan, and what that costs is scrolling,
  not bars: [view.md](view.md).
- Quarters are a custom scale unit (`<unit>_start` + `add_<unit>`, dhtmlx ships
  neither).
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
- **Three ordering constraints in the init sequence**, none of them visible in
  a config: `plugins()` before `init()`; the custom quarter unit registered
  before `ext.zoom.init()`; the grid/`$grid` width gap measured right after
  `init()`. Getting the order wrong fails silently, not loudly.

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
- **Tooltip carries `z-index: 50`** — a fixed-position surface of ours near the
  chart needs more (`.rowmenu`: 60), and an open popup should also suppress it
  (`suppressTooltip` prop: hover re-opens it over whatever sits there).

## Grid and editors

- **`grid_width` is a budget**: new columns shrink existing resizable ones
  toward `min_column_width`, silently (name column went 230→152px). Compute
  `grid_width` from the columns' widths so the timeline pays instead.
- **The grid/timeline divider does keep `config.grid_width` in step with a real
  drag** — dhtmlx's own internal `onGridResizeEnd` handler writes the new width
  back into `config.grid_width` (measured: 706/705 before a 150px drag,
  856/855 after, same 1px gap both times). No handler in this app's own code
  attaches to that event, and nothing here should start depending on the
  internal one firing reliably in every case (touch input, programmatic
  resize, a future dhtmlx version) — `toggleGridCollapsed`
  (`GanttChart.tsx`) still measures `$grid.offsetWidth` fresh rather than
  trusting `config.grid_width`, and that choice costs nothing since the two
  agree here anyway.
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
- **Refreshing the resource dropdown finds its column by `name ===
  'resource_id'`** — renaming that column silently stops the options ever
  updating, with no error anywhere.
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
- **Dragging from the *left* handle creates a type-1 (start-to-start) link**,
  and `syncLinks` reads every link as finish-to-start source→target: drawn SS,
  scheduled FS, redrawn FS after a reload (the file carries no `type`). Refuse
  non-FS in `onBeforeLinkAdd` — the type is a view concept, so the rule belongs
  in the handler, not in `rejectionForLink`.
- **A synthetic link drag must start on `.gantt_link_point`, not on the
  `.gantt_link_control` centre**: a press a few pixels off the point creates
  nothing and reports no error. Measured while verifying T47 — the first
  attempt, at the control's centre, silently produced no link.
- **`onLinkDblClick` fires in the Community build, and `return false` suppresses
  the vendor modal.** Deletion is dhtmlx's own `gantt.confirm`, not
  `window.confirm` — see [verification.md](verification.md).
- **`onAfterTaskMove` reports only the new parent**, not sibling reorders — read
  order back off the grid (`getChildren`, not `eachTask`: closed branches still
  have an order), or the reorder dies at the next save/undo.
- **`$task_data` moves with the scroll — don't add the scroll to it.** Pointer →
  date is `dateFromPos(clientX - $task_data.getBoundingClientRect().left)`,
  nothing else (measured rects 673/613/549 at scrolls 0/60/125). Adding
  `getScrollState().x` double-counts — invisible until scrolled. The load lanes
  *do* add it and aren't a precedent: they draw in their own panel.
- **`onGanttScroll`'s `left` argument is stale in some firings, and the
  firing count depends on the gesture** — measured: a `scrollTo` that moves
  fires 4 times, 2 with a stale `left`; a `scrollTo` to the position already
  held fires 3 times, none stale; a real thumb drag fires once per mouse-move
  step, `left` stale every time. Never dedupe on a count. Read the position
  back instead of taking the argument (the lanes measure it off
  `$task`/`$task_data`; `getScrollState().x` is right too except at the
  maximum at some device pixel ratios — 0.665px at dpr 1.5, 0 at 1.25 and at
  1, above).
- **`ResizeObserver` never fires in the embedded browser** (not even the initial
  callback). dhtmlx measures its container at `init` and window resize only —
  anything of ours changing the chart's height (e.g. the load panel) must call
  `gantt.setSizes()` itself.
- **Refuse links in `onBeforeLinkAdd`**: by `onAfterLinkAdd`, `syncLinks()` has
  written the predecessors and `solve()` throws with the model already mutated.
  `rejectionForLink` is the guard; mouse and script both go through it.
