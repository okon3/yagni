# File format and exports

## `.gantt` (JSON, version 2)

- **Inputs alone decide the schedule** — computed dates are recomputed on load,
  so a file can never contradict its own premises.
- Dates: local wall-clock `YYYY-MM-DDTHH:mm` (`toISOString` would shift an 08:00
  start to the previous day). Calendar days (holidays, override bounds):
  `YYYY-MM-DD` strings, never `Date`s (a `Date` carries time+zone that can push
  a holiday onto the neighbouring day).
- A save also writes the solved schedule as a **report**: `solved` per task
  (start, end, effort, elapsed, contention) and per project (`projectStart`,
  `projectEnd`, `solvedAt`). Same solve as the inputs beside it, **ignored
  entirely on load** — it exists for an agent reading the file without the app
  (`start` = what was asked, report = where it landed, `solvedAt` = snapshot
  date).
- Undo history, draft and the `dirty` comparison use the **input-only**
  serialization (a report in a snapshot is noise; `dirty` would compare
  mismatched shapes). The file is written compact (no indentation) — agents
  parse it, pretty-printing only pads it.
- A row with children is written **without `resourceId`** (the engine ignores a
  summary's, but nothing in the file would say the field is inert).
- **Task list order = row order**, written back on reorder (the list was always
  read in written order).
- `disabled: true` marks placeholder work (semantics:
  [scheduling.md](scheduling.md)). Optional and additive — v2 stays v2. Written
  only where it is set: the flag is inherited by the subtree, so a child under a
  disabled group carries nothing of its own.
- Version 1 still loads: `daysOff` → availability overrides at zero.

## Strict parsing

Refuses rather than repairs: unknown resources, duplicate ids, dangling
predecessors, circular hierarchy, availability outside 0..1, colour not
`#rrggbb`, `disabled` not a boolean, future versions. Parse before load — a bad
file leaves the open project untouched.

A written `disabled: false` is accepted and **normalized to absent**: two
spellings of the default would make one project serialize two ways, and `dirty`
compares text.

**A gap in strictness is not a bad error message, it is the open project.**
`loadProject` writes onto `projectRef` and *then* solves: a file that parses but
can't be scheduled (last case: a person left at zero capacity) throws `Scheduler
stalled` with the model already replaced — stale grid, edits dying on unknown
tasks, next save overwriting the user's work. Hence `validateResources` runs on
**every** path in: load, dialog, agent API.

## CSV export

`.gantt` is the project; **CSV is the schedule** — one row per task in grid
order with the derived dates/durations the project file deliberately omits. No
CSV import (results are not premises).

Dialect for the app's locale: `;` separator, decimal comma, CRLF, UTF-8 BOM,
dates `DD/MM/YYYY HH:mm`. `Livello` = outline depth; `Riepilogo` marks summaries
(their effort is the children's rollup — summing without the flag double-counts);
`Contesa` = stretched by sharing, vs part-time/absence; `Disattivata` marks a
placeholder the effort column would otherwise sum in as committed work (appended
last, so a sheet built on the earlier column order still reads). Dates come from
the schedule's own `Date`s, never re-converted from working minutes (milestone
lands on its diamond's instant).

## PNG and print

- `PNG` **draws** the plan (outline, people, calendar axis, every bar) rather
  than capturing the chart: only in-view rows are in the DOM and the data area
  is a viewport. The figure grows with the plan, shades weekends/shutdowns,
  marks today, keeps summary shading and milestone diamonds.
- `Stampa` / Ctrl+P prints that figure: A4 landscape, 24 rows per page, title
  and axis repeated, one shared time scale (browsers won't break an image across
  pages — unpaged = cropped). *Save as PDF* in the print dialog **is** the PDF
  export.
