import { gantt } from 'dhtmlx-gantt';
import type { Schedule } from '../scheduler';

/** The last width measured, against the names it was measured on. */
let measuredLabels: { key: string; width: number } | null = null;

/**
 * How much room past its bar the longest task name in the plan asks for.
 *
 * Measured on a throwaway row rather than on the rendered ones: smart rendering
 * gives a node only to what is on screen, and a name that runs off the end of
 * the plan belongs to a row as likely to be scrolled away as any other. Off the
 * DOM a chart that renders nothing answers zero — and that is precisely the
 * chart whose range has to grow.
 *
 * Every edit asks this, so the answer is kept against the names it was measured
 * on: on a plan of 300 the layout the probe forces comes to about a third of the
 * edit it rides on — the absolute figures move with the machine, that ratio did
 * not — while reading the names back is a tenth of a millisecond. The key is
 * rebuilt on every call rather than dropped on the edits that ought to move it —
 * there is no invalidation to forget. What else the width rests on is a
 * stylesheet the build fixes: the size, the padding, a summary's capitals.
 */
export function widestLabelWidth(): number {
  const names: { text: string; summary: boolean }[] = [];
  gantt.eachTask((task) => {
    names.push({ text: String(task.text ?? ''), summary: Boolean(task.is_summary) });
  });
  const key = names.map((name) => `${name.summary ? '1' : '0'}${name.text}`).join('\n');
  if (measuredLabels?.key === key) return measuredLabels.width;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0';
  const labels = names.map((name) => {
    const label = document.createElement('div');
    label.className = 'gantt_side_content gantt_right';
    label.textContent = name.text;
    // A summary's name is set in smaller tracked-out capitals, so which bar the
    // name hangs off decides its width as much as the text does.
    const row = document.createElement('div');
    row.className = name.summary ? 'gantt_task_line gantt-bar--summary' : 'gantt_task_line';
    row.append(label);
    probe.append(row);
    return label;
  });
  // One subtree, attached once: every width is then read out of a single layout.
  gantt.$task_data.append(probe);
  const width = labels.reduce((widest, label) => Math.max(widest, label.offsetWidth), 0);
  probe.remove();
  measuredLabels = { key, width };
  return width;
}

/**
 * The range to pin for a plan at the scale on screen: the plan, a column of
 * lead-in, and room past the last bar for the longest name in it.
 *
 * A function of those two alone — same plan, same level, same dates, whatever
 * was pinned before.
 */
function planRange(schedule: Schedule, wanted: number): { from: Date; to: Date } {
  const { unit, step } = gantt.getScale();
  // Counted in columns of the narrowest width one can render at, never in the
  // width on screen: dhtmlx stretches columns to fill the timeline and takes
  // that back as their number grows, so a count measured before the render
  // would come out short once the extra columns share the room.
  //
  // One column over the count, because the plan's end sits partway through a
  // column and only the rest of that one is past the bar. What the library then
  // rounds on top is welcome but never relied on: it adds a whole column only
  // when the pinned end falls mid-column, and nothing at all when it lands on a
  // boundary.
  const columns = Math.ceil(wanted / gantt.config.min_column_width) + 1;
  return {
    from: gantt.date.add(schedule.projectStart, -step, unit),
    to: gantt.date.add(schedule.projectEnd, columns * step, unit),
  };
}

function pinRange({ from, to }: { from: Date; to: Date }): void {
  gantt.config.start_date = from;
  gantt.config.end_date = to;
  gantt.render();
}

/**
 * Widens the timeline until it holds the whole plan and the names beside it,
 * and does nothing when it already does.
 *
 * dhtmlx computes the range at render time only, and `zoomToFit` pins it in
 * `config.start_date` / `config.end_date`, where it outranks the data from then
 * on. A plan that grows past the range is then not drawn at all — smart
 * rendering skips a row whose bar falls outside it — which showed as an empty
 * chart twice over: after the first task added to a fresh project, whose range
 * is three days around today, and after opening a file while the range was
 * pinned by Fit. `refreshData` redraws the bars but never the scales, hence
 * the render, and only when the plan no longer fits: `render()` is the whole
 * chart, on every edit.
 *
 * The widened range is pinned rather than handed back to the data, so that the
 * room past the last bar is the app's answer and not the path's: a plan reached
 * by editing gets what the same plan reached by opening its file gets. Left to
 * the data, dhtmlx pads by one column, which a name longer than that is simply
 * cut off by — the timeline ends where the range does and no scroll reaches
 * past it.
 *
 * What counts as holding it is measured in pixels, which is what a name is
 * measured in. Held in dates, a range that was wide enough goes short on its
 * own: the same two dates buy fewer pixels at a coarser scale, and a plan that
 * grows to just inside the pin keeps a margin of one column. Which is why the
 * zoom asks the question over — the level is half of the answer.
 *
 * An edit that leaves the range adequate leaves it alone, wider than the plan
 * asks for or not: the window a user has been given is not to be taken back
 * from under a keystroke.
 */
export function fitRangeToPlan(schedule: Schedule): void {
  // An empty project has nothing to fit, and its start still resolves to a date.
  if (schedule.tasks.size === 0) return;
  const { min_date: from, max_date: to } = gantt.getState();
  const holdsPlan =
    from instanceof Date &&
    to instanceof Date &&
    schedule.projectStart >= from &&
    schedule.projectEnd <= to;
  const wanted = widestLabelWidth();
  if (holdsPlan && gantt.posFromDate(to) - gantt.posFromDate(schedule.projectEnd) >= wanted) {
    return;
  }
  pinRange(planRange(schedule, wanted));
}

/**
 * Puts the range back on what the plan asks for at the level just switched to.
 *
 * Recomputed, not repaired: a predicate that only ever finds a pin too narrow
 * widens on the way out to the coarser levels and keeps every one of those
 * widenings on the way back, so the same plan at the same level would end up
 * wider for having been zoomed out and in again. Measured before this: `day`
 * reached straight, 2470px past the last bar; reached via `Years`, 10590. What
 * the timeline holds is a question about the plan and the scale, and the route
 * is not part of it.
 */
export function repinRangeToScale(schedule: Schedule): void {
  if (schedule.tasks.size === 0) return;
  const range = planRange(schedule, widestLabelWidth());
  const { start_date: pinnedFrom, end_date: pinnedTo } = gantt.config;
  // A level that asks for the range already pinned must not cost a render.
  const unchanged =
    pinnedFrom instanceof Date &&
    pinnedTo instanceof Date &&
    +pinnedFrom === +range.from &&
    +pinnedTo === +range.to;
  if (unchanged) return;
  pinRange(range);
}

// `getScrollState().x` reports what the chart was asked to scroll; at some
// device pixel ratios it over-reports what dhtmlx actually drew, by a
// fraction of a pixel at the scrollbar's maximum (docs/dhtmlx.md has the
// ratios and the ceiling on this recipe). `$task` stays put while
// `$task_data` carries the real translation, so their difference is the
// applied offset rather than the claimed one. Deliberately not rounded:
// the applied translation is itself fractional there, and rounding it is
// what puts the lane off.
export const appliedScrollX = () =>
  gantt.$task.getBoundingClientRect().left - gantt.$task_data.getBoundingClientRect().left;
