# View decisions

The view wraps dhtmlx-gantt Community, **rendering only** — the engine doesn't
know it exists. Library traps: [dhtmlx.md](dhtmlx.md). This file records the
*decisions* and their reasons.

Icons are lucide only (`lucide-react` in components, `lucide-static` strings
in dhtmlx templates) — except the critical-chain/dirty CSS dots, the logo and
the HelpDialog diagram, none of which are icons. The `→` between a period
row's two dates is one more exception: it's the word "to" set as an arrow,
not an interactive control, and a grey svg arrow there would imply affordance
that isn't there.

## Colour scheme

- **Follows the system, with no switch of its own.** A per-app theme is one more
  piece of state to persist, to expose in the file or in `localStorage`, and to
  disagree with the desktop around it. `prefers-color-scheme` already answers.
- One palette, two sets of values: the dark scheme redefines the same variables
  in `index.css` and no rule knows which one it is in. Accents *lighten* on
  emphasis there — on a dark surface that is what "stronger" looks like.
- **`--band-nonworking`** (chart bands, help diagram — one variable, two
  consumers, both painted *under* their content) is derived in light, flat in
  dark: a share of `--line-strong` there, `rgb(0 0 0 / 18%)` here. A share of
  the line grey lightens over dark rows, and a weekend that lightens stops
  reading as background — so dark stops tracking `--line-strong` on purpose,
  and a later retune of the line grey will not reach it.
- **`--band-nonworking-over`** is the load lane's own veil, since that one
  paints *over* its content instead: the same light grey there would wash a
  saturated fill out rather than read as a weekend over it. Black at low alpha
  in both schemes — `rgb(0 0 0 / 18%)` in dark, same figure as its sibling;
  a separately tuned low alpha in light, since a shared value would have to
  serve two different jobs.
- **Task, avatar and swatch colours do not change.** They are the user's (or
  keyed to a person's name); a palette that shifted with the desktop would make
  the same plan two different pictures.
- **`COLOR_OPTIONS`'s 14 tints (`colors.ts`) are distinguished by hue *and*
  luminance, not hue alone** — the only way to keep this many apart on a 12px
  bar, and it degrades gracefully for colour-blind users (minimum CIEDE2000
  ΔE00 across every pair: 13.87). Chroma is not capped: clearing 3:1 on both
  rows confines lightness to a narrow band, and inside it separation can only
  come from chroma — the two most chromatic tints (`#9f2cdd`, `#dc28af`, OKLab
  C ≈ 0.25) sit above every Material 500 tone. A deliberate trade, chosen
  against a soberer set with fewer tints.
  Every tint clears 3:1 (WCAG's non-text floor) against **both** chart
  row backgrounds — white in light scheme, `#1b1e24` in dark — since a tint
  never changes with the scheme but the row under it does.
- **A bar's outline is a darker mix of its own fill, not a fixed line colour**
  (`--dhx-gantt-task-border`, `gantt.css`): 14 tints instead of 7 put
  neighbouring tints close enough that two adjacent bars merge without a
  separator, and one fixed grey would fight half the palette. Same 0.72
  multiplier as `shade()` (`colors.ts`), spelled in CSS because only there can
  it read the fill dhtmlx sets inline per task. It costs 2px of the bar's
  content box — [dhtmlx.md](dhtmlx.md) for what that moves.
- **The `seg-pct` badge's ink adapts to the tint it sits on, rather than the
  palette being capped to stay legible for one fixed ink.** `needsDarkInk`
  (`colors.ts`) compares a tint's contrast against white and against a
  near-black (`--bar-fill-ink-dark`, same figure as dark-mode `--on-accent`,
  invariant for the same reason) and picks whichever wins; `segmentBar.ts`
  reads it once per fill and emits `seg-pct--dark` beside the existing
  `seg-pct--above`. Every tint clears 4.5:1 against whichever ink it gets.
  Without this, no single fixed ink can stay legible across a palette that
  also has to clear 3:1 against both rows — the two floors leave a band of
  tints where a single ink reads at neither.
- **`AVATAR_COLORS` is kept clear of the task palette** by neither a lightness nor
  a chroma band (the task set now spans both, to read on both rows) but by a
  verified CIEDE2000 floor: 11.2 between avatars, 11.8 against every tint —
  on par with the tints' own 13.87 — so an avatar never reads as a task
  colour.
- **Dark `--on-accent` is near-black (`#0a0c12`), not white.** Accents lighten
  in dark (above), so white label ink loses AA on them (≈3.4:1); the near-black
  clears 4.5:1 with margin (≈5.6:1 at rest, ≈7.6:1 on the `--accent-strong`
  hover). Every accent-filled button — `.dialog__btn--primary`,
  `.toolbar__primary`, `.empty__primary` — reads its ink from that variable;
  none hardcodes a colour on an `--accent` background.
- dhtmlx's own dark theme is taken for the parts we don't skin, with its base
  colours re-pointed at the palette — [dhtmlx.md](dhtmlx.md) for how, and why the
  rule is written twice.
- **Paper stays light**: `planFigure` carries its own literals and `@media print`
  puts the page back to white. A dark plan is a screen, not a document.

## Zoom and timeline range

- Five zoom levels (days → quarters). Month columns top out ~10 months of plan;
  quarters carry multi-year. Quarters are a custom scale unit (dhtmlx ships
  none).
- Ctrl+wheel (and trackpad pinch — same gesture) zooms: app-bound `wheel`
  listener, one step per gesture burst.
- **The window widens whenever the plan no longer fits** (dhtmlx computes range
  at render; a pinned range outranks data → empty chart with rows in the grid).
  An edit only ever grows it; a zoom or *Fit* recomputes it. Not per-edit — a
  full redraw per edit isn't worth it.
- **The widened window is pinned, on the plan plus the widest task name**, so
  that the room past the last bar is the app's answer rather than the path's:
  a plan reached by editing gets what the same plan reached by opening its file
  gets. Left to the data, the margin is one column — 90px against a name that
  renders 214, and a name sliced mid-word there is unreachable at any scroll,
  since the timeline ends where the range does. The trailing space an edit gains
  is the price and is deliberate.
- **Wide enough is decided in pixels, at the scale on screen** — a pin is two
  dates, and dates go short on their own: coarser columns buy fewer pixels for
  the same pin, and a plan grown to just inside it keeps one column. So a change
  of scale asks the question again, and the answer is the widest name measured
  off the stylesheet, kept against the names it was measured on (a third of the
  edit it rides on, on 300 rows; rebuilding the key is free).
- **A change of scale recomputes the window from the plan, it does not repair
  it**: an edit may only widen — the room a user is looking through is not taken
  back from under a keystroke — but a zoom that only widened would keep every
  widening the coarse levels needed, and the same plan at the same level would
  end up wider for having been zoomed out and back. Plan and level decide the
  window; the route there does not.
- *Fit* picks the level for the plan alone and the margin goes back on top, so
  the margin is what Fit leaves off screen. **Bars can be off screen too**, and
  not because of the margin: columns never render narrower than dhtmlx's
  `min_column_width`, so a plan too wide for the window at the coarsest level
  cannot be on screen whole — 9 tasks over four years in a 1264px window fit to
  *Years* and still spill 264px left and 251px right of the view. Off screen,
  not lost: the timeline scrolls to them. The limit is the library's, with the
  margin or without it ([dhtmlx.md](dhtmlx.md)).
- **An opened plan is collapsed and fitted at once**: shape first, leaves one
  click away. Status-bar count is the plan's, not the screen's. Collapsing never
  changes the dates spanned; open branches are view state — none of it marks the
  file dirty.
- Every way in (toolbar, drag-drop, draft, `loadText`) shares one call; fit runs
  after the load. **Undo is not an opening**: same restore path, but keeps
  viewport, zoom, closed branches.

## Grid

- Columns: inputs (name, resource, effort, start) + derived **end and duration**
  — faint italic, **no editor declared** (nothing to open; the model has no end
  field anyway). A summary's effort/resource/start are refused the same way.
- **Summary resource column** shows up to 4 overlapping faces of everyone below
  + `+n`; native `title` names them all in face order; the summary bar carries
  the same list. Those faces don't highlight (a sliver isn't a choice; `+n` has
  no face); a single-person branch draws a normal avatar, which does.
- The two derived columns cost 146px, paid by the **timeline**, not the name
  column (a truncated name is the one cell you can't guess; the timeline scrolls
  and re-scales).
- Editor keys: Tab/Shift+Tab walk editable cells across rows saving each on
  leave; Enter saves+closes; Esc closes without saving. Focused field carries
  the app's violet focus ring.
- **Collapse to zero width, toolbar toggle** (`toggleGridCollapsed`), so the
  chart alone can fill the window. Remembers the width to restore by measuring
  `$grid.offsetWidth` at the moment of collapsing, not `config.grid_width` —
  not because the config value is known stale (dhtmlx's own internal listener
  does keep it in step with a real drag, [dhtmlx.md](dhtmlx.md)), but
  defensively: no handler in this app's own code observes that drag, so
  nothing here depends on an internal side effect it doesn't own. Not
  persisted — it does not survive a reload, and it is view state only: no
  undo entry, no dirty flag.

## Right-click add

- Context menu on grid row, bar, or a bar's empty lane: task below, subtask
  inside, milestone below. (Before: only *append*, then drag into place.)
- **Where you click decides the start**: on the timeline, the day under the
  pointer (rounded to first working day, like a drop); in the grid, the target
  row lends its start (summary → rolled-up earliest). **Never today** — an
  unchosen date next to a March plan would drag the plan's start back.
- Menu names its row; closes on Esc or outside click, and that click does
  nothing else (it would open an inline editor). Del and Ctrl+Z are held off
  while open, as inside dialogs.

## Details dialog

- Holds float (measured per row on open — a column would be a search per row per
  edit), progress, colour, and delete (with subtree + dependency cleanup).
- Only a task **with subtasks** confirms deletion — the one whose extent isn't
  on screen. The opener button names its task (identical unnamed buttons defeat
  keyboard users stepping between rows).
- **Row heights are stable, not incidental** (`TaskDialog.tsx`, `.taskinfo__*`
  in App.css). Numbers measured in the browser, never derived: this dialog's
  `.dialog__control` renders at 27px for text/number, 29px for select/date —
  a browser sizing quirk, not a stylesheet difference — so anything matching a
  control's height uses the taller, 29px, from one `--dialog-control-h: 29px`
  custom property on `.dialog` (`dialog.css`). The floor lives on the three
  row-matching rules below, not on `.dialog__control` itself: a row whose only
  control is text/number (no select/date sibling to already hold it at 29px)
  has nothing else to absorb the difference, so putting the floor on the
  primitive grows that row by ~2px instead of leaving it stable.
  - **The "0 = milestone" hint is always rendered**, hidden with
    `visibility: hidden` (`.taskinfo__hint--reserved`) rather than removed, on
    a leaf whose effort isn't 0 and on a summary's Effort cell (never a
    milestone) — its slot holds the row's height instead of the row shrinking
    mid-edit.
  - **`.taskinfo__derived` carries only the semantics** (italic, `--ink-faint`)
    — it is shared with the Float em-dash in the Computed `dl`, which must stay
    a plain inline span. The height rule (`display: inline-flex; align-items:
    center; min-height: var(--dialog-control-h)`) is the modifier
    `.taskinfo__derived--cell`, applied only to the spans standing in for a
    grid cell (`fromChildren`, the colour row's "inherited from the parent
    task"). `.taskinfo__checkbox` gets the same `min-height` directly.
    `.taskinfo__amount` also gets it, since its native 27px would otherwise
    leave a leaf's row 2px short of the same row on a summary (whose Effort
    cell shows the 29px derived span).
  - **The intro hint (`p.dialog__hint.taskinfo__intro`) reserves a min-height**
    for its normal/milestone text swap — both variants measure 48px at this
    dialog's width.
  - **Computed (`.taskinfo__readonly`) is a fixed 4-track grid**
    (`grid-template-columns: repeat(4, 1fr)`), not the flex row it was —
    entries no longer drift with their content. Tracks measure 128px over the
    512px content box; the widest strings (header `Total effort`, data
    `31/12/2026`/`999.75 d`) fit inside a track with room to spare. `dt`/`dd`
    stay the sole descendant exception (semantic structure, no primitive
    reached); order and inks (`tabular-nums`, `gantt-stretched`,
    `.taskinfo__critical`, the Float em-dash) unchanged.
  - **Notes (`.taskinfo__notes`) are a region with a reserved minimum, not a
    fixed band.** `min-height` is one real two-line `.taskinfo__note`,
    measured at this width (12px font: 16px × 2 = 32px) — not derived from
    line-height. A short one-line note still reserves that floor; a second
    note or a longer wrap grows the region past it. Accepted trade-off:
    `task`/`slack` are fixed at mount (the dialog remounts per open), so this
    height only ever varies task-to-task, never mid-edit — cross-task pixel
    parity isn't worth a permanent blank band under a one-line note, but a
    note must never clip. Spacing between notes is the region's own
    `gap: var(--space-2)`, not a per-note margin (a UA default `<p>` margin
    would otherwise sneak back in if a per-note margin were reintroduced).
  - **The colour preview (`.taskinfo__preview`) is a fixed 56×14px pill**, not
    the elastic `flex: 1` it stretched to. `margin-left: auto` sends leftover
    row width into the gap before it rather than into the pill.
    `.taskinfo__colors` takes `flex-wrap: wrap` with `row-gap: var(--space-2)`
    so a wider palette degrades to a second line instead of overflowing the
    512px content box — at today's 14-swatch palette, picker + swatches +
    preview still fit one line with margin to spare (measured: the row holds
    at 28px, the picker button's own height — swatches are the shorter 20px
    circles beside it). Picker/swatch geometry (34×28, 20px circles, `--on`
    ring) untouched.

## Bar tooltip

- Hover answers: dates, effort vs elapsed, person and share, and (while marked)
  criticality and reason. Reports only what is already computed — never asks the
  engine (float figure = a re-solve per day probed; click price, not hover
  price). Where the marking is dashed the tooltip says in words it predates the
  last edit — ring and sentence must not disagree.
- Uses dhtmlx's own tooltip extension (in Community, unlike `addTaskLayer`):
  one delegated listener, task looked up by id — survives redraws and smart
  rendering.

## Highlight (person)

- **Highlighting is not filtering**: their rows/bars/links keep opacity, the
  rest fades to 25%. A summary counts as theirs if anyone below is; a link is
  kept if either end is theirs. Selected row is not spared (a bright row in
  someone else's colour would read as highlight).
- Toolbar avatars pin; hovering an avatar (toolbar or grid) borrows the
  highlight. Load lanes follow.
- Implementation: every row already carries a class per person below it;
  highlighting injects **one stylesheet rule** dimming the rest — no redraw
  (dhtmlx drops hand-set classes on redraw, and a hover redraw would replace the
  node under the pointer).

## Search

- Status-bar box: marks matches in grid and timeline, shows count; Enter walks
  (opening branches, scrolling, selecting), Shift+Enter backwards, wraps.
  Ctrl+F focuses the box (beats the browser's find); Esc empties it.
- **Marks and walks, never filters** (same argument as highlight; on a tree,
  filtering either drops the hierarchy or shows non-matches). Nothing hidden =
  nothing to undo.
- A closed summary hiding matches carries a **fainter mark** (a pointer to where
  to open, not a result; the walk lands on real matches).
- Case- and accent-insensitive both ways (*analysis* ↔ "Analysis"). Marks come
  from a row template asking one query (no per-row class copies). Matches
  re-measured after every edit; the current match keeps its place while it still
  matches.

## Disabled tasks

- Toggled from the row menu (leaf or summary — *Disable*/*Enable*, label
  read off the row's own flag), from the details dialog's *Disabled*
  checkbox, and from a red ban-icon button in its own grid column (title
  flips *Enable*/*Disable*, stays at full opacity once off so the state is
  discoverable without hovering). All three go through `updateTask`'s
  `TaskPatch` — no pathway of their own, so undo and the dirty check come free.
- What is drawn is the **effective** state (`solved.disabledIds`): a leaf's own
  flag or one inherited from a disabled ancestor. The row menu and the dialog
  show the row's **own** flag instead — a child inside a disabled group renders
  dimmed with its own checkbox still unticked, since the group is what carries
  the flag.
- Bar dimmed (opacity + desaturating filter, so a coloured bar fades too — bar
  colours are inline, see [dhtmlx.md](dhtmlx.md)); grid name in the existing
  muted ink. Milestones share `task_class`, so the diamond dims for free.
- Never coexists with critical or shared (the engine guarantees it), so the
  three classes are independent — no ordering rules needed between them.

## Bar decorations

- **Critical chain = outline, never fill** (bar colour is the user's; a
  background rule silently beats the inline variable). **Off by default** — a
  ring on every load reads as a warning before any question was asked; toggle in
  the status bar. Links are never drawn as the chain (a dependency between two
  critical tasks needn't be why either is critical).
- Task names sit **beside** bars (inside belongs to the allocation profile).
- **Milestone = diamond** (dhtmlx milestone type): same colour, same ring (on
  the diamond), same dimming; grid dot becomes a diamond; dialog heading flips
  to *Milestone* at effort 0.
- Milestone day placement: its start and end are the same working minute = two
  instants. One that closes something is drawn where that thing was drawn (else
  the diamond sits a weekend past the bar, beyond the plan's end where dhtmlx
  draws nothing); one nothing runs into sits on the morning of its given date.
  Decided from **predecessors**, never the start constraint.
- Today: exact vertical line at every zoom + a pill on the scale cell holding it.

## Non-working time shading

- Two registers: **non-working days** grey (calendar-driven — a 4-day week
  shades like a weekend); **time off** red — shutdown on every row, absence only
  on that person's rows. Only zero periods count as time off; reduced
  availability reads in the profile.
- Bands positioned in **pixels**, not shaded cells → exact at every zoom. Time
  off paints twice: tint under bars + hatch over them (a bar crossing an absence
  shows both its colour and the reason it stretched).
- Only non-working days can be dropped, and by **width** (< 10px reads as a
  hairline), not zoom level: a weekend at month scale (7px) disappears, a
  3-day-week's off days (13px) stay. Time off has no floor.
- Width test = one pixels-per-day for the whole timeline × run length in days —
  never the band's own width (month columns vary 28–31 days → bands blinked
  along the chart). Runs measured before clipping to the rendered range.
- Allocation profile = single SVG path inside the bar. Both it and the bands
  place own elements in the data area (`addTaskLayer` is PRO; dhtmlx rewrites
  its own layers every render).

## Resource load lanes (*Resource load*)

- One lane per person under the chart, same time axis. **Over-allocation cannot
  happen** (the engine divides, never overbooks) — the signal is **unclaimed
  capacity**: dashed ceiling = what they have (follows part-time, overrides,
  absences), solid band = what the plan booked, gap = the answer.
- Lanes tile the plan end to end; everyone gets one even with nothing booked (an
  empty lane is what you came to find). Label: days booked + days free. Hovering
  a lane names the tasks and rates at that point; hovering the avatar borrows
  the chart's highlight.
- **A summary contributes nothing** (double-count); an unassigned task appears
  in no lane (no capacity involved).
- Aggregation is the engine's (`load.ts`), from the same allocation segments the
  bars draw, keyed by resource. Contiguity in *working* minutes merges
  stretches; capacity is taken from what the simulation granted, not re-resolved
  (a lane disagreeing with its schedule is worse than none).
- X positions from the chart's `posFromDate`, following its horizontal scroll;
  the lane starts at the timeline's measured origin, not at the grid's width,
  which stops two borders short of it;
  weekends shaded with the same runs and threshold as the timeline, but with
  `--band-nonworking-over` and **over the plot, not under it**: the lane's axis
  is working minutes, so a weekend is no time at all there, and a fill spanning
  one crosses it at full height.
- **`.loadlane__label` carries no padding or border**, unlike a typical labelled
  box, so it can render at any width `toggleGridCollapsed` drives it to,
  including 0 — `paintLoad`'s `timelineOffset` is otherwise correct at every
  width, collapsed included. Two independent floors had to go, not one:
  a flex item's implicit `min-width: auto` ignores an inline `width` in favour
  of its content's own minimum (fixed with `min-width: 0`), and, separately, a
  `box-sizing: border-box` element can never render narrower than its own
  padding plus border, whatever `min-width` says (a negative content area
  clamps to 0, not to the requested total) — measured on an empty clone: 21px
  rendered against a requested 1px, exactly the label's 2×10px padding + 1px
  border. Spacing moved to `margin` on the label's first/last child, and the
  divider that was `border-right` is now an inset `box-shadow` (paints without
  adding to the box, and stays inside it regardless of `overflow: hidden` —
  an outset shadow would be clipped by it). At a fully collapsed grid the
  avatar and name simply clip away (nothing to label); the lane's origin
  still lines up with the chart's bars exactly, as pinned by T30/T31.

## In-app help

- Reached from `?` and from the empty state — the two moments someone looks.
  Explains the rising/falling fill and why critical-with-float isn't a
  contradiction.
- Diagram **drawn, not screenshotted**: SVG using `segmentBar.ts` geometry and
  `gantt.css` colours (a screenshot is a stale binary and carries UI noise).
  Pairs the profile with the one comparison that matters: 5 days effort vs 8
  days calendar.
- Empty state is minimal (name, one line, two buttons, help link) — the old
  5-step explainer stood between the user and their first task.
- Header version badge: the top `CHANGELOG.md` entry, clickable to open the
  changelog dialog. The last version seen lives in `localStorage`
  (`yagni.seenVersion`); on startup, if the top entry differs from it, the
  dialog opens on its own, once, and closing it (however opened) records the
  current version. First-ever visit (nothing stored) records silently instead
  of greeting a new user with release notes. Waits for the unsaved-draft
  question to be settled first — never stacks on that dialog.

## Dialogs

- `Dialog` (`src/gantt/Dialog.tsx`) owns the `<dialog>` chrome for every modal:
  `showModal`, the focus/scroll fallback, and the header/body/footer skeleton.
  Content and buttons stay per-dialog. Mounted only while open, like before —
  it never takes an `open` prop, so a draft still initialises from props on
  mount rather than through an effect.
- **`.dialog__body` is the only scroll container.** Header, error slot and
  footer are `flex: none`, so a scrolled-past error or a title never leaves
  view, and the footer's buttons are always reachable without scrolling.
- **Width is fixed per dialog, never content-driven** — no `min-width`
  anywhere in a dialog rule; a `min-width` next to content pressure is what
  let an expanded row resize a dialog before. Height is content-driven up to a
  cap, past which the body scrolls.
- No header close button. Esc and the footer button both dismiss through the
  same path — a real Escape fires the native `cancel` event and then `close`
  right after, both wired to `onDismiss`, which is latched to run at most once
  per mount.
- **Focus on open rests on the safe option, not the one that acts.** A real
  Escape and a stray Enter must not perform a confirmation's destructive or
  irreversible action, so `ConfirmDialog`'s Cancel button — not its confirm
  button — carries a literal `autofocus` HTML attribute, applied through
  `setAutofocus` (`src/gantt/autofocus.ts`; its own module because a
  non-component export costs `Dialog.tsx` its Fast Refresh). React's
  `autoFocus` prop cannot supply this: it only calls `.focus()` at mount,
  while the dialog is still closed (`showModal` runs later), which does
  nothing. `Dialog`'s own fallback looks
  for that same literal attribute to decide whether to focus the dialog itself
  instead. TaskDialog's name field carries it the same way, through
  `setAutofocus` (`src/gantt/TaskDialog.tsx`).
- CSS: `src/dialog.css`, imported in `App.tsx` before `App.css` — an
  equal-specificity per-dialog override in App.css then wins by source order,
  which is how later migrations drop `!important` without a specificity war.
  Every `.dialog__*` primitive is reached by an explicit class on its own
  element — never by a per-dialog descendant selector, for the same reason. A
  combinator between two primitives inside dialog.css itself
  (`.dialog__header + .dialog__body`) is not that case: nothing outside the
  file is reaching in, so no per-dialog override is outranked.
  Everything about the chrome lives in that one file, the backdrop's dark alpha
  included — it sits beside the light one rather than in App.css's block of
  alpha veils, because a light/dark pair split across two files drifts apart.
- **`.dialog` states the base size, 13px.** `.dialog__control` and
  `.dialog__btn` are `font: inherit`: with no base they resolved against the
  UA's 16px, which every content block corrected for itself (`.people__table`,
  `.ranges`, `.taskinfo__field`, `.calendar__day`) and the footer buttons never
  did. A field dropped straight into `.dialog__body` now comes out at 13 like
  the rest. Sizes that are a deliberate step off it stay explicit: title 16,
  confirm message 14, hints and errors 12.
- **A descendant rule outranks a primitive.** A block rule reaching a control
  by element — `.block__row button` (0,1,1) — beats `.dialog__btn` /
  `.dialog__control` (0,1,0) whatever the source order, so the control keeps
  the block's styling and every per-dialog override of the primitive is inert
  too. No dialog control is styled that way any more: give it an explicit
  class instead (`.people__pct`, `.ranges__date`, `.taskinfo__amount` — same
  element, same specificity, App.css later, so it wins by order alone). Grep
  for what else selects a control before assuming its class styles it.
- **Period-row lists (`.ranges__row`: Calendar shutdowns, People absences)
  share one CSS grid template**: fixed date/count/remove tracks (`120px 12px
  120px 1fr 88px 28px`), plus a `--pct` modifier that inserts a 68px
  percentage track between the dates and the label (`AvailabilityList`).
  Count is `white-space: nowrap` — 88px is "no working days" (measured 87px, the
  widest string either list produces) rounded up to the `--space-*` grain;
  a fixed track whose content wraps would change that one row's height
  silently, which nowrap turns into a visibly wrong string instead. **The
  label is the only elastic (`1fr`) track** — free text is the one thing that
  can absorb leftover width, so dates, counts and remove buttons stay aligned
  down the list whatever the label or count text is. A field's unit (`%`)
  sits inside the field (`.dialog__field`/`.dialog__suffix`, dialog.css), so
  the fixed track carries the whole field and not a bare input with a span
  beside it. Same primitive in `TaskDialog`'s Effort ("days") and Progress
  ("%") fields (`.taskinfo__amount`), outside any period-row list.
- **The People table (`.people__table`) is `table-layout: fixed` with a
  `<colgroup>`**, so no cell's content can move a column: Name auto (≈260 at
  the dialog's 592px content box) · Availability 88 · Periods 160 · Tasks 48 ·
  Remove 36 — all measured against both the header string and the widest cell
  content (`scrollWidth <= clientWidth`), not derived on paper. In the
  Availability and Tasks columns the widest content is the header string
  itself, not the data. The expanded absences panel (`.people__offPanel`)
  spans the table's content box — zero horizontal padding on `.people__offRow
  td` plus the panel's own padding — so it reads as part of the row above
  rather than a separate block.
- **`.dialog__subhead` is the one grammar for a section subhead inside a
  dialog body** (12px/600/uppercase/`letter-spacing: 0.06em`/`--ink-faint`) —
  Calendar's "Working days"/"Shutdowns" and Task info's "Computed" share it;
  one that opens a body straight under its hint adds
  `.dialog__subhead--flush` (the hint's own bottom margin already spaces it)
  rather than forking the grammar or reaching for a descendant selector.
- **`.dialog__hint` caps its measure at 58ch**, which keeps a caption from
  outrunning the fields below it. A hint that is the dialog's whole prose adds
  `.dialog__hint--wide` (`max-width: none`) — Help's opening paragraph, whose
  body has no field grid to measure against.
- **`Dialog` takes an optional `bodyClassName`, appended to `.dialog__body`.**
  The sanctioned per-dialog body override: an explicit class ties specificity
  at (0,1,0) with the primitive and wins by App.css source order, rather than
  a descendant selector that would outrank it and start the specificity war
  above. `ConfirmDialog`'s `.confirm__body` is the case in hand — it trims the
  body's bottom padding to `--space-2` so the message-to-buttons gap is 24px
  (8 + the footer's 16) instead of the primitive's 40.

## Undo and the draft

- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y + toolbar arrows, greyed when empty, each
  naming its step (*Undo: deleted "Requisiti"*). Inactive while a
  field or dialog holds focus.
- A step is a **whole-project snapshot** (same text a file holds, restored
  through the file path). A command log would have to describe every edit path
  and would silently miss the next one; snapshots make coverage a property of
  the code — the chart reports every change through one callback, the snapshot
  is taken there. Fifty snapshots of a few KB cost nothing.
- Open/new **clears history** (Ctrl+Z resurrecting the previous project is not
  an undo). Restore keeps zoom, scroll, selection; filename/dirty/count are read
  from the restored project. *Unsaved* = diff against last-saved text, so
  undoing back to saved clears the marker.
- **Draft**: plan written to `localStorage` 1s after it stops changing; a reload
  **asks** before taking it back (never silently). Only the current project,
  never the history stack (quota). A refused write drops the stored draft (an
  older draft is worse than none). Draft cleared on save and new project; while
  dirty, the browser's own beforeunload question guards a reload.
