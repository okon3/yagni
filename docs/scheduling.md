# Scheduling model

**Effort and start are inputs; end is always derived.** Nothing writes an end
date into the model.

`simulate.ts` is a discrete-event simulation: at each event (task ready, task
complete, override edge) it recomputes who is active on each resource, divides
that capacity between them, and advances to the next event. No formula can solve
this: stretching a task changes what it overlaps, which changes the stretching.

Time axis = **working minutes**. Nights, weekends, lunch breaks, shutdowns are
collapsed out, so capacity is constant by construction and the loop has no
calendar logic. `WorkingCalendar` owns every conversion.

## Consequences

- **Unassigned task never contends** — full rate, always. A new project has no
  people, so this is the initial state of everything.
- **Allocation varies within one task** (100% → 50% → 33% → back), so bars draw a
  per-regime profile, not a flat rate.
- **Partial staffing compounds with the split**: 50% person on two tasks → 25%
  each. Granted rates never exceed availability.
- **Contention ≠ part-time**: each segment records the rate the task would have
  had solo; `isContended` compares the two. Different fixes: reassign the task
  vs change the person.
- **Effort 0 = milestone.** Closes the moment it is reachable, cascades into a
  following milestone, consumes no capacity. No separate concept, nothing extra
  in the file; a summary is never one.
- **Solved start is shown everywhere and handed back on save**, so a start is
  accepted as a constraint only when it differs from the solved one
  (`constraintStart` in `project.ts`). Otherwise a rename walks the constraint
  forward to wherever the plan currently puts the task, and the plan changes the
  day the predecessor holding it goes. Dropping a bar where it already sits
  declares nothing.
- **A declared start is a day, not an instant**: snapped to the working day's
  opening; a closed day moves to the next open one. Only the day is the user's
  choice — hours belong to the calendar.
- **A summary is never scheduled** (it would contend with its own children).
  Effort/dates roll up from leaves; elapsed can exceed the sum when children
  don't run back to back.
- **Dependencies cross the hierarchy**: declared on a summary → pushed to its
  leaves; a summary as predecessor → expands into its leaves.
- **Bar colour is owned by the top-level task** and inherited by the subtree;
  moving a branch recolours it.

## Disabled tasks

A row can be marked **disabled**: placeholder work, positioned but weightless.
One line: **the live plan does not see disabled tasks; disabled tasks see
everything.**

- **Inherited down the tree** like the bar colour — a flag on a group disables
  its subtree. A **summary is disabled once every leaf under it is**; it carries
  no state of its own.
- **No capacity**: passed to the engine as unassigned, which is the existing
  no-owner path — full rate, nobody's capacity spent, absent from the load lanes.
  **Effort is still conserved** (every segment at rate 1).
- **Dependencies, asymmetric**: an enabled leaf drops disabled predecessors
  (after the summary→leaves expansion, so a link from a disabled summary
  contributes nothing); a disabled leaf keeps them all, so placeholders chain
  among themselves and follow the live plan.
- **Roll-up counts enabled children only** — a placeholder's effort under a
  summary would read as committed. A summary with nothing enabled left rolls up
  from all of its children (it is disabled itself; its parent is the one that
  skips it).
- **Out of the critical chain**, and out of the end the chain is measured
  against: never critical, never contended, never `shared`. Disabling the task
  that set the date moves the chain onto whatever sets it now.
- Milestones follow the same rules; `pinMilestones` needs nothing of its own.

## Float — measured, not derived

Classic CPM is **wrong here, not approximate**: a task can set the end date with
no dependency path to it, purely by sharing a person. `float.ts` perturbs and
re-solves, per task:

- **later**: push start out a working day at a time; float = max delay that
  leaves the end unchanged.
- **longer**: add a day of effort; if the end moves, the task is **critical**.

Probes start from where the task *landed*, not its declared start.

- **Critical with float is legitimate** (person booked solid: any task can slide
  and catch up, but any extra day pushes the end). Flag and figure are reported
  separately: movable, not growable.
- The **reason** is `isContended` — same notion the profile draws, never a second
  definition. Contended-critical → take it off that person; else → cut its chain.
- **Summary**: tightest float of its leaves; critical if any leaf is; names a
  contention only when *every* critical leaf shares the same person.
- The doubling search assumes end is monotone in delay. Where a delay *unshares*
  a resource, that fails — but every reported figure was actually simulated, so
  the plan understates float rather than promising room that isn't there.

### Cost and UI policy

Each probe is a full re-solve; the simulation is quadratic. Criticality across
the plan: 7 ms @ 20 tasks, 41 @ 40, 162 @ 60, 267 @ 100 — plus a search per task
for exact figures.

- ≤ 40 tasks: marking re-measured on every edit (~40 ms vs 13 with it off).
- \> 40: measured only on request (*Calcola catena critica* in the status bar).
- \> 40 after an edit: stale marking stays **dashed** (declares itself old)
  instead of vanishing — never looks measured when it isn't.
- Undo counts as an edit: re-measure inside the limit, keep dashed past it.
  Opening a file / draft / new project **drops** the marking (different plan).
- The float *figure* is measured per row when its details open, inside the limit
  only (a summary costs a search per leaf).

## Time off and availability

- **Company shutdowns** (`calendar.holidays`) leave the axis like weekends: tasks
  move, effort unchanged. Held as a sorted index, subtracted by binary search;
  inverse mapping settles by fixed point (runs on every event).
- **Per-person availability** can't leave the axis (others keep working) → it is
  time-varying capacity: default `availability` + `availabilityOverrides` that
  **replace** it for their duration.
- **Absence = override at 0.** One mechanism, so shutdown-vs-absence on the same
  day can't disagree.
- Rules: override **replaces** the default (50% person with 25% period works at
  25%, not 12.5%); **overlapping overrides: last declared wins** (narrow
  exception carved out of a broad period); concurrent-task split applies **on
  top** (half a person on two tasks → quarter each).
- Override edges are ordinary events. The allocation policy receives resolved
  capacity — it never sees calendars. A zero period **pauses** tasks without
  redistributing their share (gap in the profile).
- Override on a weekend/shutdown costs nothing, and the UI says so. Day covered
  by both shutdown and absence shades as the shutdown.
- Simulation and timeline shading resolve capacity through the **same function**,
  or the chart could show an absence the schedule doesn't honour.
- Working week and daily hours are **global** — per-person hours would break the
  shared axis.

## Day-boundary ambiguity

A working-minute on a day boundary = two wall-clock instants: 17:00 that day /
08:00 next working day. Hence `fromWorkingMinutes(minutes, edge)`: bar end uses
`'end'`, start uses `'start'`; wrong edge makes whole-day tasks look a day long.

- `ScheduledTask` exposes both `Date`s and raw working minutes. **Test adjacency
  on working minutes, never dates** — contiguous instants render as different
  dates.
- A **milestone** is one boundary value seen from both sides (engine: start
  08:00, end 17:00 the day before). `pinMilestones` (`project.ts`) collapses it
  before anything downstream — deciding from the **predecessors**, never the
  start constraint: only what closes on it knows which instant it landed on.
  `rollUp` takes summary dates from the children's own `Date`s for the same
  reason.
- **General rule: never convert a schedule's minutes a second time — read the
  `Date` it carries.** The builder already chose a boundary side; a second
  conversion silently picks its own. `rollUp` and the load lanes' horizon each
  cost a debugging session to this (the lanes read `projectEnd`, not a
  conversion).

## Extending

`allocation.ts` is the seam: it receives already-resolved capacity. Per-task
fixed/capped allocation goes there, not in the loop. The scheduler tests document
the semantics, including the invariant Σ(rate × duration) = effort per task.
