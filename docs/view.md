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
- **Task, avatar and swatch colours do not change.** They are the user's (or
  keyed to a person's name); a palette that shifted with the desktop would make
  the same plan two different pictures.
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
  It only grows; *Fit* tightens it again. Not per-edit — a full redraw per
  edit isn't worth it.
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
  weekends shaded with the same runs and threshold as the timeline.

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
  `.dialog__control` and `.dialog__btn` (+ `--primary`/`--danger`) are explicit
  classes on each element, never descendant selectors, for the same reason.
  Everything about the chrome lives in that one file, the backdrop's dark alpha
  included — it sits beside the light one rather than in App.css's block of
  alpha veils, because a light/dark pair split across two files drifts apart.
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
  beside it.

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
