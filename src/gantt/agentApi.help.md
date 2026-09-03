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
- **Dates are `YYYY-MM-DDTHH:mm` local wall clock**, never `Date` objects and
  never UTC. Pass them back in the same form. `new Date('…T08:00Z')` moves an
  08:00 start to the previous day.

Allocation segments are deliberately absent: they exist to draw a bar, and
`shared` answers the same question. Groups are not a concept here — "one
person's tasks" or "this subtree" is a filter over the flat list.

## Writing — tasks

| Call | Notes |
| --- | --- |
| `addTask(patch?) → id` | `{ name, nominalDays, start, resourceId, color, parentId }`, all optional. The start is normalised to 08:00. |
| `updateTask(id, patch)` | Any subset of `{ name, nominalDays, start, resourceId, color, progress }`. Throws on `nominalDays`, `start` or `resourceId` for a summary. |
| `deleteTask(id)` | Takes the subtree with it and clears dependencies on any of it. |
| `setParent(id, parentId \| null)` | `null` moves it to the top level. Refuses a parent from inside `id`'s own subtree. |
| `link(from, to)` | Finish-to-start. **Refuses a cycle before mutating.** |
| `unlink(from, to)` | |

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

## Two things that will bite

`isDirty()`, `getFilename()` and the status bar are React state and settle one
frame after a write. `getPlan()` does not — it is read straight from the engine.

Undo is the user's, not yours: `toText()` + `loadText()` is the rollback you can
reason about. And there is no batching — you already have a script, and a loop is
cheaper than an API for it.
