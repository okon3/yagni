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
- **A task with no effort is a milestone.** Zero days of work is not a degenerate
  task but the useful one: a date the plan reaches — a release, a sign-off, a gate
  — rather than work it does. It closes the moment it is reachable, cascades into
  whatever milestone follows it, and takes nothing from the person it is assigned
  to. There is no second concept and nothing extra in the file: effort 0 is the
  whole of it, so a task becomes a milestone and stops being one by editing the
  same number every other task has.
- **The start you set stays the start you set.** Every row, every bar and the
  dialog's date field show the *solved* start, which on a task held by a
  predecessor is later than the date it was given. Saving a task hands that date
  back, so accepting it would let a rename walk the constraint forward to
  wherever the plan currently puts the task — and the plan would then change on
  the day that predecessor is removed. A start is therefore only taken as a
  constraint when it differs from the solved one, which is also why dropping a
  bar exactly where it already sits declares nothing.
- **A start is a day, not an instant.** One that is taken as a constraint is
  taken as the opening of the working day it fell on, and a day the calendar has
  closed moves on to the next open one. The hours a task can run in belong to the
  calendar, so the only part of a start anyone chooses is which day it is —
  a drop carries whatever minute the pointer was over, and a date field carries
  no time at all. It also means the chart never quietly moves a task further
  than the gesture did: dhtmlx would otherwise snap a drop to the cell of the
  scale on screen, which on a plan long enough to be viewed by month is a whole
  month of travel for a nudge of a few pixels.
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

### Float, and why the critical path is not a path

The first question anybody asks a plan is which tasks the end date hangs on. The
textbook answer — a backward pass over the dependency graph — is **wrong here,
not approximate**: a resource's capacity is divided between whatever overlaps on
it, so a task can set the end date with no dependency on it at all, purely
because it shares a person with something that does. A dependency-only float
calls that task free, and it is precisely the task to move.

So float is **measured, not derived**. `src/scheduler/float.ts` perturbs the plan
and re-solves it, one task at a time, asking two questions:

- **later** — push the task's start out by a working day. The largest number of
  days that leaves the end where it was is its **float**.
- **longer** — add a day of effort. If the end moves, the task's *size* sets the
  date, and it is **critical** however freely it may slide.

The probes start from where a task actually landed, not from the start it
declared: one held back by a predecessor has already spent that difference.

**A task can be critical and still have float**, and that is not a contradiction
worth papering over. Somebody booked solid from the first day lets any one of
their tasks start later and catch up alone — so each has float — while one more
day of work on any of them pushes the end out. Both facts are true, and together
they say what to do: the task can be moved, it cannot be grown. Which is why the
figure and the flag are reported separately instead of being collapsed into "zero
float means critical".

The **reason** is `isContended`, the same notion the allocation profile draws:
a critical task that had to share its person is one to take off that person, one
that did not is one to cut out of its chain. Not a second definition of sharing
that could disagree with the first.

A summary is never scheduled, so it has no float of its own: it takes the
tightest float under it, is critical as soon as any leaf is, and names a
contention only when every critical leaf under it shares the same person —
otherwise the reason would explain one leaf and hide the others.

The doubling search assumes the end date is monotone in the delay. It is, except
where a delay *unshares* a resource and brings the end in rather than out. Every
figure reported is a delay that was actually simulated and found free, so such a
plan understates the float rather than promising room that is not there.

**The cost is honest, and what an edit pays for it changes with the plan.** Each
probe is a full re-solve, and the simulation is itself quadratic in the tasks:
measuring criticality across a plan costs 7 ms at 20 tasks, 41 ms at 40, 162 ms
at 60 and 267 ms at 100, and the exact figures cost a search per task on top.
Unacceptable per keystroke, entirely acceptable per click — which is the shape
the feature takes:

- **Up to forty tasks** the marking is measured with every edit and is therefore
  never out of date. An edit costs about 40 ms there, against 13 ms with the
  marking off.
- **Past forty** nothing measures itself. The control in the status bar asks for
  it — *Calcola catena critica* — and one click measures and redraws.
- **Past forty, after an edit**, what was measured stays on screen **dashed**
  rather than vanishing, and the control offers to do it again. Clearing it on
  every keystroke would mean seeing nothing precisely while working on the plan,
  whereas a marking that declares itself old, with one click to refresh it,
  still answers the question it was asked. What it must never do is look
  measured while it is not — hence a change of register, not a fade.

An undo counts as an edit here: inside the limit the marking is measured again
from the plan it restores, past the limit it keeps the one it had, dashed.
Undoing steps back through the same plan rather than bringing a different one,
and dropping the marking there would leave a big plan with nothing marked after
every <kbd>Ctrl</kbd>+<kbd>Z</kbd>. Opening a file, taking back a draft or
starting a new project does drop it: a marking measured against the plan that
was open says nothing about the one that just arrived.

The float *figure* is measured one row at a time, when its details are opened,
and only while the plan is inside the limit: unlike criticality it costs a search
per row, and a summary costs one per leaf under it.

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

The scale changes with <kbd>Ctrl</kbd> and the wheel as well as from the status
bar — a trackpad pinch arrives as the same gesture, so it works too — and one
flick is one step however many events it fires. The library offers this and binds
it to `mousewheel`, which this browser no longer sends, so the app listens for
`wheel` itself and stops the browser zooming the page instead.

Not drawing what falls outside the range is also why **the timeline is widened
whenever the plan no longer fits it**. dhtmlx works out the range when it renders,
and Adatta pins it in the configuration, where it then outranks the data — so the
first task added to a fresh project, whose range is three days around today, and a
file opened while Adatta's range was still pinned, both left an empty chart with
the row sitting in the grid. The window now grows to hold the plan, at whatever
zoom is showing, and only when it has to: a redraw of the whole chart on every
edit is not worth it. It only ever grows — a plan that shrinks leaves the window
where it was, and Adatta is what tightens it again.

**An opened plan is collapsed and fitted at once**, so a file no longer arrives
as a chart of empty weeks: widening the window is enough to draw the bars, not
to put them where they can be read, and a plan a year long opened at week scale
shows its first fortnight. Collapsed, because what one wants of a plan just
opened is its shape — the top level, a handful of bars — and not every leaf of
it at once; the branches are one click from open, and the count in the status bar
is the plan's, not the screen's. Collapsing changes which rows are drawn and
never which dates the plan spans, so the window fitted to is the same either
way, and an open branch is a property of the view: none of this marks the file
as changed.

Every way in goes through the same call — the toolbar, a file dropped on the
window, the unsaved draft, a script's `loadText` — and the fit is the one Adatta
makes, made once the load has finished. An undo is not an opening: it restores
the plan through the same path and keeps the window the user was looking
through, closed branches included.

The grid carries the **inputs** — name, resource, effort and start — and beside them
the two figures a plan is actually read by: **end date and duration**, both derived.
The rule is not that a computed figure has to be hidden, only that it must not *look*
editable. Those two columns are faint and italic on every row, which is the register a
summary's rolled-up effort has always worn, and **no editor is declared on them at
all** — which closes every way in at once rather than one at a time, since a cell
without an editor declared on it has nothing to open. And past all of that, an end
date has nowhere to land: the model has no field for one.

A summary's effort, resource and start are refused the same way, because they are
rolled up from its children: the row shows the figures and no cell on it opens.

The **resource column on a summary** shows the branch rather than the empty field:
the faces of everyone working anywhere below it, overlapping, up to the four the
column holds, and then a `+n` for the rest. The native tooltip on the stack names
them all, the ones behind the `+n` included, in the order the faces are in — and the
summary's bar carries the same list, so the hover answers wherever it happens.

Those faces do **not** highlight, and the highlight elsewhere is unchanged. A face
covered down to a sliver is not one a pointer can claim to have chosen, and the
people past the limit have no face to point at. A branch that one person carries
draws the ordinary avatar instead, and that one highlights like any other: there is
no ambiguity to protect against.

**Right-click** to add a row where you are looking: a new task below that one, a
subtask inside it, or a milestone below it. Adding could only ever *append* before
— to the top level from the toolbar, to a branch from the row's `+` — so putting a
row in its place meant creating it elsewhere and dragging it back.

It works on a grid row, on a bar, and on the empty stretch of a bar's own lane,
and **where you right-click decides the new row's start**. On the timeline that is
the day under the pointer, which is a start said out loud — point at a week in
December and the milestone lands there, rounded to the first working day, exactly
as a drop is. In the grid there is no date axis to point at, so the row the menu is
about lends its own start, a summary's being its rolled-up earliest. Never today: a
date nobody chose, beside a plan that runs in March, would drag the plan's own
start back with it.

Right-click is the only pointer gesture either half of the chart had left — a
single click opens the inline editor and selects, a double click the same, a drag
reorders in the grid and moves the bar in the timeline. The menu names the row it
is about, closes on <kbd>Esc</kbd> or a click outside, and that click does nothing
else: it would otherwise open an editor on the cell it landed on. <kbd>Del</kbd>
and <kbd>Ctrl+Z</kbd> are held off while it is open, for the same reason they are
held off inside a dialog.

Inside an editor, <kbd>Tab</kbd> and <kbd>Maiusc+Tab</kbd> move along the editable
cells of the row and on into the next, saving each cell as they leave it,
<kbd>Invio</kbd> saves and closes, and <kbd>Esc</kbd> closes without saving. The
field it lands in carries the same violet ring the rest of the app puts on a focused
control, since with the keyboard that ring is the only thing saying where the typing
is going.

They cost the grid 146px, and it is the timeline that gives them up rather than the
task name. The grid holds its configured width and squeezes its resizable columns to
fit, which took the name from 230px to 152px — and a truncated name is the one cell
whose content cannot be guessed from what is left of it, while the timeline scrolls
and re-scales.

Float stays in the per-row details dialog behind the button at the end of the row —
which names the task it opens, since the button has no content and a title shared by
every row leaves anyone stepping between them unable to tell whose detail is next —
together with progress and colour, and not because it is derived: it is *measured*,
one row at a time, at the cost of a re-solve of the plan per day probed. A column of
those would be a search per row on every edit. That dialog is also where a task is
deleted — as is <kbd>Del</kbd> on the selected row —
which takes its subtree with it and clears any dependency on the tasks that go.
Only a task with subtasks asks for confirmation, since that is the deletion whose
extent is not on screen. Confirmations are dialogs of the app's own: an embedded
browser suppresses `window.confirm`, which would turn every guarded action into a
silent no-op.

A bar **answers on hover**: its dates, its effort against the duration those dates
span, the person and the share of them it got, and — while the chain is marked —
whether the end date hangs on it and why. The dialog behind the row's button says all
of that too, one row at a time and for a click, but a plan is read by sweeping it. So
the tooltip reports what is already computed and asks the engine for nothing: the
float *figure* costs a re-solve of the plan per day probed, which is a price for a
click and not for a pointer crossing a bar. Where the chart draws the criticality
dashed the tooltip says in words that it predates the last edit, since the ring and
the sentence must not disagree about the same measurement.

It is the library's own tooltip extension, which the Community build does ship —
unlike `addTaskLayer`. That matters for more than the licence: the extension
delegates a single listener on the chart's root and looks the task up by id, so the
hover neither stores anything on a bar to lose at the next redraw nor cares that
smart rendering leaves most of the bars out of the DOM.

One person's work can be **highlighted**, and highlighting is not filtering: their
rows, bars and links keep their opacity while the rest of the plan fades to a
quarter of it. Nothing is hidden, because what one looks for is precisely how a
person's work sits inside everyone else's — and a summary counts as theirs as soon
as anyone below it is, so a highlighted leaf never hangs under a faded parent. A
link is kept whenever either of its ends is theirs: what gates their work, and what
their work gates, is part of reading it. The avatars in the toolbar pin a person
until they are unpinned; hovering an avatar — there, or in the grid's resource
column — borrows the highlight for as long as the pointer stays on it. Not a
summary's stack of faces, though: see the resource column below. Nothing is
spared, the selected row included: one row left bright in somebody else's colour
reads as part of the highlight rather than as a selection. The load lanes below
follow along, so picking a person leaves their row, their bars and their week
standing out together.

That is a stylesheet rule rather than a class per highlighted row. Every row already
carries one class per person working on it or anywhere below it, and highlighting
someone injects a single rule that dims whatever does not carry theirs — so changing
who is highlighted costs no redraw. Which matters twice over: dhtmlx rebuilds its
rows on every redraw and would drop a class set by hand, and redrawing on hover
would replace the very node the pointer is on.

A plan is also **searched**, from the box in the status bar: whatever matches is
marked in the grid and across the timeline, the count says how many there are, and
<kbd>Invio</kbd> walks them one at a time — opening whatever branches hide the next
one, bringing it on screen and selecting it, <kbd>Maiusc</kbd>+<kbd>Invio</kbd>
backwards, ringing round at either end. <kbd>Ctrl</kbd>+<kbd>F</kbd> puts the caret
in the box, so the browser's own find does not open over the plan, and
<kbd>Esc</kbd> empties it.

**It marks and walks; it never filters**, which is the argument highlighting makes
just above. A task lifted out of its tree is a name with no plan around it, and its
phase, its neighbours and what it runs alongside are the reason anybody looked it
up. On a tree the choice is worse than elsewhere: drop the ancestors that do not
match and the hierarchy goes with them, keep them and the filter is showing rows
that do not match. Nothing hidden is also nothing to undo — a marking leaves no
state a user has to remember to get out of.

Matching is blind to case and to accents in both directions, so *attivita* finds
"Attività" and the other way round. The marks come from a row template asking one
query, not from a class written onto each row: dhtmlx would drop a class of ours on
the next redraw, and a copy per row would be a second thing to keep in step. What
matches is measured again after every edit — a rename, a new row, an undo — because
walking onto a row that is no longer there is worse than losing one's place; the
match under the eye keeps it as long as it is still a match.

The critical chain is an **outline** around the bar, never a fill. The bar's
colour belongs to the user and dhtmlx sets it inline through
`--dhx-gantt-task-background`, so a background rule would silently beat it and a
task would lose its own colour for being critical. It is on by default — which
tasks the end date hangs on is the first thing anybody asks of a plan, and a ring
costs the bar nothing it was already showing — and the toggle sits with the other
view switches at the bottom, next to Comprimi and Espandi. Links are left alone:
a dependency between two critical tasks need not be the reason either of them is
critical, and drawing it as the chain would claim more than was measured.

Task names sit **beside** their bar, never inside it: the inside belongs to the
allocation profile, and a one-day bar has no room for a name anyway.

A **milestone is a diamond** on its date rather than a bar of no width, drawn by
dhtmlx's own milestone type and carrying the same colour, the same critical ring
— on the diamond, where positional criticality is exactly the point — and the
same dimming as everything else. The grid says so too, by turning the row's
colour dot into the same shape, and the details dialog changes its heading to
*Milestone* the moment the effort reads zero, so the one concept behind the two
appearances is visible while it is being typed.

Which day a milestone lands on is **not** the ambiguity it looks like. Its start
and its end are the same working minute, and a working minute on a day boundary
is two wall-clock instants — 17:00 that day, 08:00 the next. A milestone that
closes something is drawn where that something was drawn, or the diamond would
sit a weekend away from the bar it marks the end of, and past the plan's own end,
where dhtmlx draws nothing at all; a milestone nothing runs into sits on the
morning of the date it was given, which is the date the grid shows. That is
decided from the predecessors and not from the start date: the start date says
where the milestone was asked to be, and only whatever closes on it can say which
of the two instants it ended up on.

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

## What one person's week looks like

Every question the chart answers is a question about a task: how long does this
take, and why. The other half of the same plan is a question about a person —
when am I working, on what, at what rate, and where is my capacity going unused
— and no row of the grid answers it. *Carico risorse* in the status bar opens a
lane per person under the chart, on the chart's own time axis.

**Over-allocation cannot happen here**, so a lane is not a warning light. The
simulation divides a person's capacity between whatever overlaps on them and
never grants more than they have: two tasks on one person read as one person
fully booked, not as 200%. What a lane can report is the opposite — **the
capacity nobody claimed**. So it is drawn as a ceiling and a fill: the dashed
line is what the person had, the solid band is what the plan booked, and the
room between them is the answer. The ceiling is not flat. It sits at half for
somebody at 50%, follows an override, and drops to the floor for an absence,
which is why a part-timer working flat out reads as full rather than as trouble.

The lanes tile the plan end to end rather than covering only the stretches with
work on them, and everybody gets one whether or not anything is booked on them —
a name with nothing under it is precisely what one comes here to look for. The
label says the days booked and the days left over; hovering a lane says which
tasks make up the level at that point and at what rate, since a level on its own
does not say who is in it. Hovering the avatar beside it borrows the chart's
highlight, exactly as the toolbar's avatars do.

**A summary never contributes.** It is not scheduled and has no allocation of its
own, and counting it would book its children's work a second time under their
parent. A task with nobody assigned appears in no lane at all: it never contends,
so there is no capacity to account for.

The aggregation is the engine's (`src/scheduler/load.ts`) and works on the same
allocation segments the bars draw, keyed by resource instead of by task. Two
segments contiguous in *working* minutes are one stretch however far apart their
wall-clock dates read, and the capacity a person had at a moment is taken back
from what the simulation granted rather than resolved a second time from the
calendar — a lane disagreeing with the schedule it describes would be worse than
no lane.

Every x comes from the chart's own `posFromDate` and the strip follows its
horizontal scroll, so a zoom moves both together and a filled band is exactly as
wide as the bars it accounts for. The weekends it shades are the same runs, with
the same threshold, that the timeline shades.

## Explaining it in the app

The one thing this Gantt shows that an ordinary one does not is a bar whose fill
rises and falls, and nobody guesses what that means on their own. A help dialog says
it, reachable from the `?` in the header and from the empty state — the two moments
someone goes looking: in front of a plan they cannot read, and in front of nothing
at all. It also has to say why a task can be ringed as critical and still show a
margin, since that reads as a contradiction until one knows the person underneath
is the constraint rather than the task.

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

**The order of the task list is the order of the rows**, and dragging a row to
reorder it writes that order back. It is not a new field: the list has always been
read back in the order it was written, so before it was kept in step a reorder
survived exactly until the next save — or until the next undo, which restores a
snapshot through the same path.

Parsing is strict — unknown resources, duplicate ids, dangling predecessors, a
circular hierarchy, an availability share outside 0..1, a colour that is not a
`#rrggbb` triplet and future versions are all rejected, and the open project is
left untouched when a file fails to load. The people list answers to the same
rules as the dialog, so a file that leaves somebody without capacity is refused
rather than stalling the scheduler halfway through the load.

The current version is **2**. Version 1 files still load: their `daysOff` are read
as availability overrides at zero, which is what they always meant.

## Taking the plan out

`.gantt` is the project; **CSV is the schedule.** The `CSV` button writes the solved
plan — one row per task, in the order the grid shows them — with the dates, the
effort and the elapsed duration the engine derived, which the project file
deliberately does not store. There is no CSV import: a file of results is not a set
of premises to schedule from.

The dialect is the one a spreadsheet expects in the locale the application speaks:
`;` between the fields, a comma for the decimals, CRLF, a UTF-8 BOM so accented
names survive the default import, and dates as `DD/MM/YYYY HH:mm`. `Livello` is the
depth in the outline, and `Riepilogo` marks a summary — whose effort is the rollup
of its children's, so a column summed without reading that flag counts every leaf
twice. `Contesa` marks a row stretched by sharing somebody, as opposed to one
stretched by part time or an absence.

The dates are the ones the schedule carries, never converted a second time from the
working minutes, so a milestone lands in the file on the same instant its diamond
is drawn on.

The `PNG` button writes a picture of the same plan: the outline, the people, a
calendar axis and every bar, drawn from the schedule rather than captured from the
chart. It has to be drawn rather than captured because only the rows in view are
in the DOM and the chart's data area is a scrolling viewport — a screenshot of it
is a screenful of a plan, whatever its height. The figure instead grows with the
plan, shows the weekends and the shutdowns behind the bars, marks today when the
plan covers it, and keeps a summary's flatter shade and a milestone's diamond so
it reads like the chart it came from.

`Stampa` — and <kbd>Ctrl</kbd>+<kbd>P</kbd>, which takes the same path — prints
that figure rather than the application: A4 landscape, the rows split over pages
of 24 with the title and the axis repeated on each, and one time scale across all
of them so the bars line up from page to page. A browser will not break an image
over a page boundary, so a plan that is not paged is a plan that is cropped. The
print dialog's *Save as PDF* is therefore also the PDF export; there is no
separate one.

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
yagni.getCriticalChain();                        // float per row, the expensive call
yagni.getResourceLoad();                         // the same plan, one person at a time
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

CSV/Excel import, several resources on one task, and per-task fixed or
capped allocation — the extension point for the last one is
`src/scheduler/allocation.ts`.
