# Changelog

## Unreleased

- People and Calendar dialogs restyled: columns that stay put whatever the
  content, period rows aligned across both dialogs, weekday checkboxes on a
  regular grid.
- Task details dialog restyled: rows that hold their height while you type or
  switch tasks, a computed section that lines up in four steady columns, and a
  colour row that no longer stretches its preview swatch.
- Task colour picker widened from 7 to 14 tints, in English, chosen to stay
  distinguishable from each other and from a person's avatar at a glance.

## v1.1 — 2026-09-05

- Per-row toggle button in the grid to enable/disable a task without opening the row menu or the details dialog.
- Every icon in the app now comes from lucide, replacing the hand-drawn glyphs in the toolbar, status bar, row menu, empty state, help button and grid buttons.
- Dark mode, following the system theme: the whole app including the chart, with task colours and printed plans left as they are.

## v1.0 — 2026-09-04

- First public release: effort-based scheduling engine, critical chain, undo, .gantt save, CSV/PNG/print export, agent API (window.yagni).
- A row or a group can be disabled: it stays marked on the plan as a placeholder but does not weigh on dates, load or the critical chain.
