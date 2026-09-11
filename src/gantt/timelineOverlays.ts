import { gantt } from 'dhtmlx-gantt';
import { availabilityOnDay, dateOfDay, dayIndexOf, expandRanges } from '../scheduler';
import type { DayRange } from '../scheduler';
import type { Project, SolvedProject } from './project';

/**
 * Pixels below which a run of non-working days is left unshaded.
 *
 * A weekend is 7px wide once a column is a month, and a chart striped with
 * hairlines on every column is noise rather than information — while a weekend
 * is ambient regularity nobody zooms out to hunt for. The threshold is on the
 * width rather than on the zoom level, so it follows the calendar: a three-day
 * working week measures 13px at the same scale, where half the chart being
 * unworked is exactly what one wants to see, and comes back on its own.
 *
 * It is compared against one pixels-per-day for the whole timeline, never
 * against a band's own width, or bands of the same length would disagree from
 * one column to the next.
 *
 * Time off has no such floor. A shutdown or an absence is a span the plan turns
 * on, so it must survive any zoom, however few pixels it gets.
 */
const MIN_NONWORKING_BAND = 10;

/**
 * The days that `matches` accepts, as merged inclusive runs of day indices —
 * one band to draw per run rather than one per day.
 */
function runsOf(days: number[], matches: (day: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  for (const day of days) {
    if (!matches(day)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === day - 1) last[1] = day;
    else runs.push([day, day]);
  }
  return runs;
}

/** Ascending day indices of `ranges`, which may overlap and need not be sorted. */
function daysOf(ranges: DayRange[] | undefined): number[] {
  return [...expandRanges(ranges)].sort((a, b) => a - b);
}

const daysBetween = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(to - from + 1, 0) }, (_, offset) => from + offset);

export interface Overlays {
  todayLine: HTMLElement;
  bandsBelow: HTMLElement;
  bandsAbove: HTMLElement;
  /** Removes the three nodes from `$task_data`. */
  detach(): void;
}

export function mountOverlays(): Overlays {
  // Today as a line rather than a shaded column: a column means a whole month
  // at month scale, while a line is exact at every zoom level. The marker
  // extension would do this, but the Community package ships no codebase/ext.
  // It lives inside the data area, which scrolls with the bars, so only a
  // change of scale moves it.
  const todayLine = document.createElement('div');
  todayLine.className = 'gantt-today';
  gantt.$task_data.appendChild(todayLine);

  // Non-working time is drawn as bands positioned in pixels rather than as
  // shaded timeline cells: above day scale a cell spans a whole week or month,
  // so colouring it would claim days that are worked.
  //
  // Two layers, because time off needs a tint under the bars and a hatch over
  // them - the day an absence is worth looking at is exactly the day a bar
  // crosses it, and the bar must still show its own colour there. Both live
  // in $task_data: dhtmlx rewrites the contents of $task_bg and $bars_area on
  // every render, so nothing of ours may sit inside them.
  const bandsBelow = document.createElement('div');
  bandsBelow.className = 'gantt-bands';
  gantt.$task_data.insertBefore(bandsBelow, gantt.$task_bg.nextSibling);
  const bandsAbove = document.createElement('div');
  bandsAbove.className = 'gantt-bands';
  gantt.$task_data.appendChild(bandsAbove);

  return {
    todayLine,
    bandsBelow,
    bandsAbove,
    detach() {
      todayLine.remove();
      bandsBelow.remove();
      bandsAbove.remove();
    },
  };
}

export function placeTodayLine(overlays: Overlays): void {
  const { todayLine } = overlays;
  const now = new Date();
  const { min_date: from, max_date: to } = gantt.getState();
  const visible = from instanceof Date && to instanceof Date && now >= from && now <= to;
  todayLine.style.display = visible ? '' : 'none';
  if (!visible) return;
  // Outside the rendered range posFromDate extrapolates, which would put the
  // line beyond the timeline and stretch the scrollable area.
  todayLine.style.left = `${gantt.posFromDate(now)}px`;
  // The data area is only as tall as the viewport and scrolls its contents,
  // so a line stretched to its edges would stop at the first screenful. The
  // background layer is the one dhtmlx sizes to hold every row.
  todayLine.style.height = `${gantt.$task_bg.offsetHeight}px`;
}

/** The rendered range in day indices, or null before the first render. */
const renderedDays = (): { firstDay: number; lastDay: number } | null => {
  const { min_date: from, max_date: to } = gantt.getState();
  if (!(from instanceof Date) || !(to instanceof Date)) return null;
  // max_date is the far edge of the last column, so the last day drawn is
  // the one before it.
  return { firstDay: dayIndexOf(from), lastDay: dayIndexOf(to) - 1 };
};

/**
 * The non-working runs as pixel spans, wide enough to be worth shading.
 *
 * The chart's own bands and the load lanes below it both draw from this, or
 * a weekend could be shaded on one and not on the other.
 */
export function nonWorkingSpans(
  calendar: SolvedProject['calendar'],
): { left: number; width: number }[] {
  const range = renderedDays();
  if (!range) return [];
  const { firstDay, lastDay } = range;
  // The threshold becomes a number of days once, off a single
  // pixels-per-day for the whole range. Measuring each band on its own put
  // the same weekend on either side of the threshold from one month to the
  // next — a month column is one width but holds 28 to 31 days — and the
  // chart showed bands blinking in and out along its length.
  const spanDays = lastDay - firstDay + 1;
  const dayWidth =
    spanDays > 0
      ? (gantt.posFromDate(dateOfDay(lastDay + 1)) - gantt.posFromDate(dateOfDay(firstDay))) /
        spanDays
      : 0;
  const minDays = dayWidth > 0 ? MIN_NONWORKING_BAND / dayWidth : Infinity;
  const runs = runsOf(daysBetween(firstDay, lastDay), (day) => {
    const date = dateOfDay(day);
    // A shutdown is not a working day either, and gets the louder band.
    return !calendar.isWorkingDate(date) && !calendar.isShutdownDate(date);
  });
  // Measured before clipping, so a weekend the range cuts in half is still
  // judged as the weekend it is rather than as the sliver drawn.
  return runs
    .filter(([runFrom, runTo]) => runTo - runFrom + 1 >= minDays)
    .map(([runFrom, runTo]) => {
      const left = gantt.posFromDate(dateOfDay(runFrom));
      return { left, width: gantt.posFromDate(dateOfDay(runTo + 1)) - left };
    });
}

export function paintBands(overlays: Overlays, project: Project, solved: SolvedProject): void {
  const { bandsBelow, bandsAbove } = overlays;
  const { calendar } = solved;
  const range = renderedDays();
  if (!range) return;
  const { firstDay, lastDay } = range;
  type Band = {
    left: number;
    width: number;
    top: number;
    height: number;
    kind: 'nonworking' | 'timeoff';
  };
  const bands: Band[] = [];
  const addBands = (
    runs: [number, number][],
    top: number,
    height: number,
    kind: Band['kind'],
  ) => {
    for (const [runFrom, runTo] of runs) {
      // Outside the rendered range posFromDate extrapolates, which would
      // stretch the scrollable area, so a run is clipped to it instead.
      const start = Math.max(runFrom, firstDay);
      const end = Math.min(runTo, lastDay);
      if (end < start) continue;
      const left = gantt.posFromDate(dateOfDay(start));
      bands.push({
        left,
        width: gantt.posFromDate(dateOfDay(end + 1)) - left,
        top,
        height,
        kind,
      });
    }
  };

  // The data area is only as tall as the viewport and scrolls its contents;
  // the background layer is the one dhtmlx sizes to hold every row.
  const fullHeight = gantt.$task_bg.offsetHeight;

  for (const span of nonWorkingSpans(calendar)) {
    bands.push({ ...span, top: 0, height: fullHeight, kind: 'nonworking' });
  }

  addBands(
    runsOf(daysOf(project.calendar.holidays), (day) =>
      calendar.isShutdownDate(dateOfDay(day)),
    ),
    0,
    fullHeight,
    'timeoff',
  );

  const awayByResource = new Map<string, [number, number][]>();
  for (const resource of project.resources) {
    // Only a working day the person cannot work at all. Reduced availability
    // is a rate rather than time off, and reads in the allocation profile.
    const away = runsOf(
      daysOf(resource.availabilityOverrides),
      (day) => availabilityOnDay(resource, day) === 0 && calendar.isWorkingDate(dateOfDay(day)),
    );
    if (away.length > 0) awayByResource.set(resource.id, away);
  }
  const rowHeight = Number(gantt.config.row_height) || 0;
  for (const task of project.tasks) {
    const away = task.resourceId ? awayByResource.get(task.resourceId) : undefined;
    // A summary is never scheduled, so nobody is away on its row: the leaves
    // underneath carry the assignment.
    if (!away || solved.summaryIds.has(task.id)) continue;
    // A row inside a collapsed branch has no place on the chart, and asking
    // for its top would put a band on whichever row happens to be there.
    if (!gantt.isTaskExists(task.id) || !gantt.isTaskVisible(task.id)) continue;
    addBands(away, gantt.getTaskTop(task.id), rowHeight, 'timeoff');
  }

  const element = (band: Band, className: string) => {
    const div = document.createElement('div');
    div.className = className;
    div.style.left = `${band.left}px`;
    div.style.width = `${band.width}px`;
    div.style.top = `${band.top}px`;
    div.style.height = `${band.height}px`;
    return div;
  };
  bandsBelow.replaceChildren(
    ...bands.map((band) => element(band, `gantt-bands__${band.kind}`)),
  );
  bandsAbove.replaceChildren(
    ...bands
      .filter((band) => band.kind === 'timeoff')
      .map((band) => element(band, 'gantt-bands__hatch')),
  );
}
