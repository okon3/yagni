# YAGNI — Yet Another Gantt, Now Improved

A Gantt chart editor in the spirit of [onlinegantt.com](https://www.onlinegantt.com/#/gantt),
plus the feature that tool does not have: when several tasks assigned to the same
person overlap, that person's capacity is split evenly between them and the tasks
stretch accordingly.

Two tasks in parallel run at 50% each, three at 33%, and so on.

## The scheduling model

Effort and start date are **inputs**; the end date is always **derived**.

- **Effort** is what the user estimates: the duration the task would take with the
  resource fully dedicated to it.
- **Start** is chosen by the user, and can be pushed later by dependencies.
- **End** comes out of the simulation and is never typed or dragged.

Stretching a task changes the window in which it is active, which changes what it
overlaps with, which changes the stretching — so the schedule cannot be solved by
a formula. `src/scheduler` runs a **discrete-event simulation**: at each event
(a task becoming ready, a task completing) it recomputes who is active on each
resource, divides that resource's capacity between them, and advances the clock to
the next event.

The time axis is **working minutes**, not wall-clock time. Collapsing nights,
weekends and lunch breaks out of the axis is what makes capacity constant by
construction: the simulation loop contains no calendar logic at all.

### Consequences worth knowing

- **A task with nobody assigned never contends.** It runs at full rate alongside
  any number of other unassigned tasks, since there is no capacity to share. A new
  project starts with no people at all, so this is the state everything begins in.
- **Allocation varies within a single task.** A task can run alone at 100%, drop to
  50% when a second task starts, then to 33%, then climb back. Bars therefore show
  a per-regime profile rather than one flat rate.
- **Partial staffing compounds with the split.** Somebody staffed at 50% who is
  running two tasks gives each of them 25%. The rates granted on a resource never
  exceed its availability.
- **Contention is distinguishable from part-time.** Both stretch a task beyond its
  effort, but they call for different moves — reassign a task, or change the
  person. Each segment therefore records the rate the task *would* have had with
  the resource to itself, and `isContended` compares the two.
- **A summary task is never scheduled.** If it were, it would contend with its own
  children for the same person and halve their rate. Its effort and dates roll up
  from its leaves instead, and its elapsed time can exceed the sum of its
  children's when they do not run back to back.
- **Dependencies cross the hierarchy.** A dependency declared on a summary is
  pushed down to its leaves; a predecessor that is itself a summary expands into
  its leaves, since finish-to-start against the latest of those is exactly
  finish-to-start against the summary.
- **Bar colour is inherited.** It is set on the top-level task and applies to the
  whole subtree, so moving a branch recolours it. Any colour goes: the details
  dialog offers the browser's own picker, with the palette beside it as shortcuts.

### Time off and changing availability

**Company shutdowns** (`calendar.holidays`) apply to everyone, so they leave the
axis entirely, exactly like a weekend. Tasks move later, their effort does not
change. This is what breaks the tidy week arithmetic: holidays are held as a
sorted index and subtracted with a binary search, and the inverse mapping settles
by fixed point instead of walking day by day, because that path runs on every
event.

**Per-person availability** cannot leave the axis — the rest of the team keeps
working — so it becomes capacity that varies with time. Each resource has a
default `availability` plus `availabilityOverrides`: periods that replace it for
their duration.

An **absence is just an override at zero**, not a separate mechanism. Holiday and
a spell at 25% are the same thing to the engine, which is why there is one notion
here instead of two that could disagree about a day covered by both.

Three rules worth knowing:

- An override **replaces** the default, it does not multiply it. Somebody on 50%
  with a period at 25% works at 25% for that period, not 12.5%.
- Where two overrides overlap, **the last one declared wins**, so a narrow
  exception can be carved out of a broad period — a fortnight at 50% with a day
  of leave inside it.
- The split between concurrent tasks still applies on top: half a person shared
  between two tasks gives each a quarter.

Override edges are events like any other, and the allocation policy receives a
capacity that is already resolved, so it never has to know about calendars. A
period at zero **pauses** every task sharing that person without redistributing
their share, and appears as a gap in the allocation profile.

A period falling on a weekend or inside a shutdown costs nothing, and the UI says
so rather than leaving the user wondering why no date moved. A day covered by both
a shutdown and an absence is shaded as the shutdown, which is the reason that
already accounts for it.

Both the simulation and the timeline shading resolve a person's capacity for a
given day through the same function, or the chart could show an absence the
schedule does not honour.

What is still global is the **working week and the daily hours**: one person cannot
have different working hours from another. That would break the shared axis and
need conversions between per-resource axes at every event.

## Layout

| Path | Contents |
| --- | --- |
| `src/scheduler` | The engine. No framework, no UI imports, fully unit-tested. |
| `src/gantt` | The view: dhtmlx wiring, file format, dialogs, rendering. |

The engine does not know the view exists, so the rendering library can be replaced
without touching the scheduling logic.

## Rendering

The view wraps [dhtmlx-gantt](https://dhtmlx.com/docs/products/dhtmlxGantt/) Community
(MIT), which is used **only for rendering**. Two things to keep in mind when
working on it:

- **Its type definitions do not distinguish Community from PRO.** Calls such as
  `addTaskLayer` compile without a warning and then do not exist at runtime, because
  the Community build deletes them. Expect no help from the compiler at the licence
  boundary.
- **Bar colours go through CSS custom properties** (`--dhx-gantt-task-background`),
  set inline per task. Overriding `background` directly in a stylesheet silently
  wins over a task's own colour. When checking a colour, read `getComputedStyle`,
  not the attribute or the data field.

Four zoom levels were not enough: each one names the band above its columns —
days, weeks, months, quarters — and the coarsest drew a column per month, which
tops out at about ten months of plan. Beyond that `zoomToFit` cropped the
timeline from the start and smart rendering simply stopped drawing the rows that
fell outside, with no scrollbar to suggest anything was missing. A fifth level
with quarter columns carries a multi-year plan; quarters are a custom scale unit,
since dhtmlx ships none.

Not drawing what falls outside the range is also why **the timeline is widened
whenever the plan no longer fits it**. dhtmlx works out the range when it renders,
and Adatta pins it in the configuration, where it then outranks the data — so the
first task added to a fresh project, whose range is three days around today, and a
file opened while Adatta's range was still pinned, both left an empty chart with
the row sitting in the grid. The window now grows to hold the plan, at whatever
zoom is showing, and only when it has to: a redraw of the whole chart on every
edit is not worth it. It only ever grows — a plan that shrinks leaves the window
where it was, and Adatta is what tightens it again.

The grid carries the **inputs** and nothing else: name, resource, effort and start.
Duration and end date are derived, so they live in the per-row details dialog behind
the button at the end of the row, together with progress and colour — a computed
figure in an editable-looking cell only invites an edit the engine discards. That
dialog is also where a task is deleted — as is <kbd>Del</kbd> on the selected row —
which takes its subtree with it and clears any dependency on the tasks that go.
Only a task with subtasks asks for confirmation, since that is the deletion whose
extent is not on screen. Confirmations are dialogs of the app's own: an embedded
browser suppresses `window.confirm`, which would turn every guarded action into a
silent no-op.

One person's work can be **highlighted**, and highlighting is not filtering: their
rows, bars and links keep their opacity while the rest of the plan fades to a
quarter of it. Nothing is hidden, because what one looks for is precisely how a
person's work sits inside everyone else's — and a summary counts as theirs as soon
as anyone below it is, so a highlighted leaf never hangs under a faded parent. A
link is kept whenever either of its ends is theirs: what gates their work, and what
their work gates, is part of reading it. The avatars in the toolbar pin a person
until they are unpinned; hovering an avatar — there, or in the grid's resource
column — borrows the highlight for as long as the pointer stays on it. Nothing is
spared, the selected row included: one row left bright in somebody else's colour
reads as part of the highlight rather than as a selection.

That is a stylesheet rule rather than a class per highlighted row. Every row already
carries one class per person working on it or anywhere below it, and highlighting
someone injects a single rule that dims whatever does not carry theirs — so changing
who is highlighted costs no redraw. Which matters twice over: dhtmlx rebuilds its
rows on every redraw and would drop a class set by hand, and redrawing on hover
would replace the very node the pointer is on.

Task names sit **beside** their bar, never inside it: the inside belongs to the
allocation profile, and a one-day bar has no room for a name anyway.

Today is a vertical line, exact at every zoom level, plus a pill on the scale cell
holding it — the day at day scale, the week at month scale, the month at quarter
scale.

The time nobody works is shaded in two registers. **Non-working days** are grey and
strictly background: the calendar answers which days those are, so a four-day week
shades the same way as a weekend. Days when **nobody works although the calendar
says they should** are red instead — a company shutdown across every row, a
person's absence only on the rows assigned to them, the same shading for both,
and which row it is on says whose day off it is. Only a period at zero counts as
time off; reduced availability is a rate, and it reads in the allocation profile
instead.

Both are bands positioned in pixels rather than shaded cells, which is what makes
them survive the coarser scales: a band covers the exact span at every zoom level,
down to a few pixels for a week of leave seen at quarter scale. Time off is painted
twice, the tint under the bars and the hatch over them, because a bar crossing an
absence has to show both its own colour and the reason it is stretched.

Non-working days are the one thing that can be dropped, and the test is **width**,
not the zoom level: below ten pixels a band reads as a hairline, and a chart striped
with hairlines on every column is noise rather than information — which is fair,
since a weekend is ambient regularity nobody zooms out to look for. Being geometric,
the test follows the calendar on its own: a weekend measures 7px once a column is a
month and disappears, while a three-day working week measures 13px at the very same
scale and stays, which is exactly where half the calendar being unworked is worth
seeing. Time off has no such floor — a span the plan turns on must not vanish on
zooming out.

The width compared against the threshold is **one pixels-per-day for the whole
timeline** times the length of the run in days, never the band's own width. A month
column is one width but holds 28 to 31 days, so measuring each band on its own put
the same weekend on either side of the threshold from one month to the next, and the
chart showed bands blinking in and out along its length as the viewport changed
size. The run is also measured before it is clipped to the rendered range, so a
weekend the range cuts in half is judged as the weekend it is rather than as the
sliver drawn.

The allocation profile is drawn as a single SVG path inside the bar — `addTaskLayer`,
the natural mechanism for it and for the time-off bands, is a PRO feature. Both
place their own elements instead, and in the data area rather than inside the
layers dhtmlx rewrites on every render.

## Explaining it in the app

The one thing this Gantt shows that an ordinary one does not is a bar whose fill
rises and falls, and nobody guesses what that means on their own. A help dialog says
it, reachable from the `?` in the header and from the empty state — the two moments
someone goes looking: in front of a plan they cannot read, and in front of nothing
at all.

Its diagram is **drawn rather than screenshotted**. A screenshot would be a binary
in the repository that goes stale on the first change of a colour or a radius, and
it could not be as legible either: the real chart carries a grid, a scale and a
toolbar that are all noise to the point being made. The SVG uses the geometry
`segmentBar.ts` computes and the colours `gantt.css` sets, and pairs the profile
with the only comparison that matters — five days of effort against eight days of
calendar.

The empty state used to carry that explanation itself, as five numbered steps and a
paragraph on effort. It was read once, by somebody who had not yet seen a bar, and
from then on it stood between that person and the two things they actually came for:
a first task, or a file. What is left is the app's name, one line saying what kind
of tool it is, those two buttons, and a way into the dialog. Naming the absence
instead — "Nessuna attività", "Un piano vuoto" — tells somebody staring at an empty
screen the one thing they already know.

## File format

Projects are saved as `.gantt` (JSON). Open them from the toolbar or by dragging the
file onto the window.

The file stores **inputs only**: computed end dates and durations are left out and
recomputed on load, so a file can never hold a schedule inconsistent with its own
premises. Dates are written as local wall-clock time; `toISOString` would shift them
to UTC and move an 08:00 start to the previous day.

Parsing is strict — unknown resources, duplicate ids, dangling predecessors, a
circular hierarchy, an availability share outside 0..1, a colour that is not a
`#rrggbb` triplet and future versions are all rejected, and the open project is
left untouched when a file fails to load.

The current version is **2**. Version 1 files still load: their `daysOff` are read
as availability overrides at zero, which is what they always meant.

## Not losing work

Every change to the model is undoable: <kbd>Ctrl</kbd>+<kbd>Z</kbd>, and
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> or <kbd>Ctrl</kbd>+<kbd>Y</kbd>
forward again, plus the two arrows in the toolbar — greyed when there is nothing
to take back, and each naming the step it would take: *Annulla: eliminazione di
«Requisiti»*. The shortcuts stay out of the way of a field being edited and of an
open dialog, where those keys belong to whatever holds the focus.

A step is a **whole-project snapshot** — the same text a file holds, restored
through the same path a file takes. A log of commands with an inverse each would
have to describe every way the project can change, a drag, an inline edit, a
dialog and a script alike, and would silently miss the next one added; an undo
that skips an edit is worse than no undo. A plan is a few kilobytes of JSON, so
fifty of them cost nothing, and coverage becomes a property of the code rather
than a list to keep up to date: the chart reports every model change through one
callback, and the snapshot is taken there.

Opening a file or starting a new project **clears the history**, and keeps the
discard question it already asked. A Ctrl+Z that resurrected the previous project
over the one just opened would not be an undo but a different file appearing in
the window.

What is restored is the same plan seen from the same place: the zoom level, the
scroll position and the selected row survive it. The filename, the unsaved marker
and the task count are read back out of the restored project rather than assumed,
and *unsaved* is the difference between what is on screen and what was last
saved — so undoing back to the saved state clears the marker instead of leaving
it on for the rest of the session.

Unsaved work also survives the tab. The plan is written to `localStorage` a
second after it stops changing, and a reload **asks** before taking it back —
*Riprendo la bozza non salvata di «progetto.gantt» (ieri 18:42)?* Never
silently: a file opened from disk would otherwise come back as something that is
neither the file nor what was last on screen. Only the current project is kept,
never the stack, which would spend the origin's whole quota on states nobody
asked to survive a reload; a storage that refuses the write drops what is in
there instead, since a draft older than the plan on screen is worse than none.
The draft goes on save and on a new project, and while anything is unsaved the
browser's own question guards a reload.

## Driving it from a script

`window.yagni` reads the solved plan and edits it without going through the grid
or the dialogs — the surface an agent uses to work on a project. It is registered
in production too: there is no backend and no secret in the page.

```js
yagni.help();                                    // the whole surface, as Markdown
const before = yagni.toText();                   // a snapshot of its own
const id = yagni.addTask({ name: 'Analisi', nominalDays: 5, resourceId: 'r1' });
yagni.getPlan().tasks;                           // tree order, dates as text
yagni.loadText(before);                          // changed my mind
```

It is an adapter over the same `GanttHandle` the buttons use, so no rule lives in
two places, and it departs from them in exactly three ways: nothing is confirmed
(a `<dialog>` awaiting a click would hang a script, so `removeResource` takes
`{ releaseTasks: true }` instead of asking), errors throw rather than returning
silently, and patches are partial.

`undo` and `redo` are deliberately not on it. A script's writes land on the same
stack as anybody else's, so Ctrl+Z steps back through them without an API for
it, and a script that wants to roll back its own move already has `toText()` and
`loadText()` — which is the more useful primitive anyway, being a snapshot the
script chose rather than whatever step happens to be on top.

`yagni.help()` and `/llms.txt` are the same file served two ways:
[`src/gantt/agentApi.help.md`](src/gantt/agentApi.help.md), which a Vite plugin
serves in dev and emits into the build. Two copies would drift.

## Development

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

`npm run lint` runs oxlint. The scheduler's tests are the place to start reading:
they document the semantics above, including the invariant that the sum of
`rate × duration` over a task's segments equals its effort.

## Not implemented

Resource View with a load histogram, CSV/Excel import-export, several resources on
one task, and per-task fixed or capped allocation — the extension point for the
last one is `src/scheduler/allocation.ts`.
