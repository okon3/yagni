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
so rather than leaving the user wondering why no date moved.

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

The grid carries the **inputs** and nothing else: name, resource, effort and start.
Duration and end date are derived, so they live in the per-row details dialog behind
the button at the end of the row, together with progress and colour — a computed
figure in an editable-looking cell only invites an edit the engine discards.

Task names sit **beside** their bar, never inside it: the inside belongs to the
allocation profile, and a one-day bar has no room for a name anyway. Non-working
days are shaded and today's column is marked, both only while a timeline cell is
one day wide — at week or month scale a single cell spans working and non-working
days alike. The calendar answers which days those are, so a four-day week and a
company shutdown shade the same way as a weekend.

The allocation profile is drawn as a single SVG path inside the bar — `addTaskLayer`,
the natural mechanism for it, is a PRO feature.

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

Resource View with a load histogram, undo/redo, CSV/Excel import-export, several
resources on one task, and per-task fixed or capped allocation — the extension point
for the last one is `src/scheduler/allocation.ts`.
