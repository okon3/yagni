# YAGNI — Yet Another Gantt, Now Improved

A single-user Gantt planner with an effort-splitting scheduler. Everything lives
in the page: no backend, no accounts, no storage. A project is a `.gantt` file
the browser downloads and reads back.

**Effort and start date are inputs; the end date is always derived.** Nothing can
write an end date. Give a task an effort in days and an earliest start, assign a
person, and the engine works out when it actually finishes: two tasks on the same
person at the same time each run at half rate, and someone at 50% or away on
holiday stretches them further. The time axis is working minutes, so nights,
weekends and company shutdowns never appear in a duration.

## Driving it from a script

`window.yagni` is the whole surface, in both dev and production builds.
`yagni.help()` returns this text. Every call is synchronous: `getPlan()` right
after a write already reflects the new schedule.

Three differences from clicking the buttons:

- **Nothing is confirmed.** Where a button asks, an argument says so instead —
  `removeResource(id, { releaseTasks: true })`.
- **Errors throw**, naming the id, rather than returning silently.
- **Patches are partial**; the fields you leave out keep their current value.

**Your rollback is `toText()` + `loadText()`.** Snapshot before a move, restore
if it made things worse. The app has an undo of its own — Ctrl+Z, and your writes
land on the same stack as the user's edits — but it is not on this surface: a
snapshot you chose beats whichever step happens to be on top of that stack.

```js
const before = yagni.toText();
const id = yagni.addTask({ name: 'Analisi', nominalDays: 5, resourceId: 'r1' });
yagni.getPlan().tasks.find((t) => t.id === id);
yagni.loadText(before); // changed my mind
```

## Reading

| Call | Returns |
| --- | --- |
| `getPlan()` | `{ projectStart, projectEnd, tasks[] }` — the solved schedule |
| `getTask(id)` | one task in full, derived figures included |
| `getCriticalChain()` | float and criticality per row. **Expensive** — see below |
| `getResourceLoad()` | the plan per person: what is booked on them, and what is free |
| `getResources()` | `Resource[]`, `availability` as a fraction `0..1` |
| `getCalendar()` | `{ workingDays, windows, holidays? }` |
| `toText()` | the project as `.gantt`, byte for byte what Save downloads |
| `getFilename()`, `isDirty()` | what the toolbar shows |

A `getPlan()` task:

```json
{ "id": "t1", "name": "Analisi", "parentId": null, "depth": 0, "isSummary": true,
  "start": "2026-09-07T08:00", "end": "2026-09-16T17:00",
  "effortDays": 8, "elapsedDays": 8, "shared": false,
  "resourceId": null, "predecessors": [] }
```

- `parentId` is the only structural truth; `depth` is there to print an outline.
- `isSummary` — has children. Its effort, dates and resource roll up from the
  leaves and it is never scheduled, so those fields cannot be written on it.
- `effortDays` is the declared effort on a leaf, the sum of the leaves on a
  summary. `elapsedDays` is the working days actually spanned, and exceeds
  `effortDays` whenever the task ran below full rate.
- `shared` is true when the stretching came from splitting a person with another
  task. That distinguishes contention — move one task, or reassign it — from
  part-time and absence, which need the person changed instead.
- **Tasks come back in tree order** (a parent immediately before its own
  subtree) and identically between calls, so two snapshots diff row by row.
  Dragging a row on screen reorders siblings visually but not in the model, so
  the screen order may differ.
- An `end` is the **last worked minute** — 17:00 of the day the work finished,
  not 08:00 of the next. A task with no effort spans nothing, so its `end` is
  its `start`; which instant that is, see milestones below.
- **Dates are `YYYY-MM-DDTHH:mm` local wall clock**, never `Date` objects and
  never UTC. Pass them back in the same form. `new Date('…T08:00Z')` moves an
  08:00 start to the previous day.

Allocation segments are deliberately absent: they exist to draw a bar, and
`shared` answers the same question. Groups are not a concept here — "one
person's tasks" or "this subtree" is a filter over the flat list.

## The plan per person

```json
{ "resourceId": "r1", "committedDays": 5, "idleDays": 7,
  "stretches": [
    { "start": "2026-09-07T08:00", "end": "2026-09-10T17:00",
      "committed": 1, "capacity": 1,
      "tasks": [{ "id": "1", "rate": 0.5 }, { "id": "2", "rate": 0.5 }] },
    { "start": "2026-09-11T08:00", "end": "2026-09-21T17:00",
      "committed": 0, "capacity": 1, "tasks": [] } ] }
```

`getResourceLoad()` returns one of these per resource, in `getResources()` order,
and it is cheap: it reads the schedule already solved.

- **`committed` can never exceed `capacity`.** The engine divides a person rather
  than overbooking them, so there is no such thing as over-allocation to look
  for. The signal is `idleDays` and the room between the two figures.
- `capacity` is a fraction of a full working day: `1` full time, `0.5` part time
  or an override at a half, `0` an absence. A stretch at `committed: 0.5,
  capacity: 0.5` is somebody working flat out, not somebody half idle.
- **`stretches` tile the plan end to end**, so a gap in the work is a stretch
  with an empty `tasks`, and the first and last stretch reach the plan's own
  edges. A resource with nothing assigned still gets a lane, with one stretch at
  zero.
- `rate` is the same figure the bar's allocation profile draws — the fraction of
  a full-time person that task is getting right then.
- A **summary contributes nothing** (it is never scheduled, and counting it would
  book its children twice) and an **unassigned task appears nowhere**, since it
  never contends for anybody's capacity.
- Two stretches are one stretch when they are contiguous in *working* minutes:
  the wall-clock dates of a single stretch cross nights, weekends and shutdowns,
  which are no time at all on the engine's axis.

This is the one reading that cannot be assembled from `getPlan()`, which leaves
the allocation segments out. The chart shows the same thing under *Carico
risorse* in the status bar.

## Why the end date is what it is

```json
{ "id": "t3", "isCritical": true, "floatDays": 1, "contendedOn": "r2" }
```

`getCriticalChain()` returns one of these per row, in `getPlan()`'s order.

- `floatDays` — working days the task can **start later** before the plan
  finishes later. Measured, not derived: the start is pushed out a day at a time
  and the plan re-solved.
- `isCritical` — the plan's end moves when the task starts a day later **or when
  a day of work is added to it**. Both are asked, and they differ: somebody
  booked solid from day one lets any one of their tasks start later and catch up
  alone, so it has float, while a day more work on any of them pushes the end
  out. Such a task is critical *and* has float — it can be moved, not grown.
- `contendedOn` — the resource whose capacity this task had to share, when
  sharing is what makes it critical, else null. That is the difference between
  *take it off Marco* and *cut the chain it sits on*. Same notion as `shared` in
  `getPlan()`.
- A summary is never scheduled: it takes the tightest float under it, is
  critical as soon as any leaf is, and names a contention only when every
  critical leaf under it shares the same person.

**This is the one expensive call.** Every probe is a re-solve of the whole plan,
so the cost is a simulation per task plus a doubling search per task with float:
milliseconds at ten tasks, a few hundred at fifty, seconds past a hundred. It is
deliberately not folded into `getPlan()`, which is read after every write.

Past forty tasks the chart stops measuring its marking with every edit and waits
to be asked from the status bar, keeping the last answer dashed in the meantime.
This call has no such threshold and always measures: a script has no frame to
miss, and the figures are the point of it.

Classic CPM does not apply here and its answer would be wrong, not approximate:
a dependency-only backward pass calls a task that merely shares a person free,
which is exactly the task a planner has to move.

## Writing — tasks

| Call | Notes |
| --- | --- |
| `addTask(patch?) → id` | `{ name, nominalDays, start, resourceId, color, parentId }`, all optional. The start is normalised to 08:00. |
| `updateTask(id, patch)` | Any subset of `{ name, nominalDays, start, resourceId, color, progress }`. Throws on `nominalDays`, `start` or `resourceId` for a summary. |
| `deleteTask(id)` | Takes the subtree with it and clears dependencies on any of it. |
| `setParent(id, parentId \| null)` | `null` moves it to the top level. Refuses a parent from inside `id`'s own subtree. |
| `link(from, to)` | Finish-to-start. **Refuses a cycle before mutating.** |
| `unlink(from, to)` | |

**`nominalDays: 0` is a milestone**: a date the plan reaches, not work it does.
It closes as soon as whatever it waits on does, cascades into any milestone
chained after it, takes no capacity from whoever it is assigned to, and is drawn
as a diamond. There is nothing else to set and nothing extra in the file —
writing an effort back above zero makes it an ordinary task again — and a summary
is never one, whatever its children sum to. `getPlan()` returns its `start` and
`end` equal, on the finish of whatever it closes, or on the morning of the date it
was given when nothing runs into it. Reading one back is `effortDays === 0 &&
!isSummary`, not `start === end`, which a summary holding a single milestone
satisfies too.

`resourceId: null` unassigns, and an unassigned task never contends: it runs at
full rate. **An id no resource carries is refused before anything is written**,
like a cyclic `link`: assigned to a person the project does not have, a task
would be scheduled against no capacity at all. `color` is `#rrggbb` and only a
top-level task owns one — a subtask inherits its parent's, so the whole subtree
stays one visual block.

## Writing — people

| Call | Notes |
| --- | --- |
| `addResource(patch) → id` | `{ name, availability?, availabilityOverrides? }` |
| `updateResource(id, patch)` | |
| `removeResource(id, { releaseTasks })` | `releaseTasks: true` is **required** while tasks are still assigned; their assignment is dropped. |
| `setAvailability(id, overrides)` | Replaces the whole ordered list. |

`availability` is a fraction of a working day, `0..1` — not a percentage. The
percentage belongs to the form; the model and the file both use the fraction.

An override is `{ from, to, availability, label? }` with `YYYY-MM-DD` days. It
**replaces** the default rather than multiplying it: somebody at 50% with a
period at 25% works at 25%. **Where two overlap, the last declared wins**, so a
narrow exception goes after the broad period it carves out of — which is why the
list is handed over whole rather than a period at a time. `availability: 0` is an
absence; there is no separate concept.

## Writing — project and calendar

| Call | Notes |
| --- | --- |
| `setCalendar(spec)` | The whole `CalendarSpec`. Holidays are company-wide shutdowns, removed from the axis like weekends. |
| `newProject()` | No discard question. Clears the undo history, as the button does. |
| `loadText(text, filename?)` | Parses first: a malformed file leaves the open project untouched and throws `ProjectFileError`. Replaces the document, so the undo history goes with it. |
| `setFilename(name)` | |

Parsing refuses rather than repairs — unknown resources, duplicate ids, dangling
predecessors, circular hierarchy, availability outside `0..1`, a future format
version.

## Navigation

`select(id)`, `reveal(id)`, `zoomIn()`, `zoomOut()`, `zoomToFit()`,
`collapseAll()`, `expandAll()`, `showToday()`. Not plan data: they exist so the
user's eye lands where the script is talking about, and so a screenshot of it is
legible.

A collapsed branch is drawn as its summary alone, so `collapseAll()` is how a
deep plan fits in one screenshot and `expandAll()` is what makes every row
readable in the grid. Neither changes the plan: `getPlan()` returns the whole
tree either way, and nothing here marks the file dirty.

`reveal(id)` opens whatever branches hide the row before scrolling to it, so a
leaf under a collapsed summary does land on screen. There is no `find`: the names
are in `getPlan()`, and matching them is a line of your own followed by
`reveal` + `select`.

## Two things that will bite

`isDirty()`, `getFilename()` and the status bar are React state and settle one
frame after a write. `getPlan()` does not — it is read straight from the engine.

Undo is the user's, not yours: `toText()` + `loadText()` is the rollback you can
reason about. And there is no batching — you already have a script, and a loop is
cheaper than an API for it.
