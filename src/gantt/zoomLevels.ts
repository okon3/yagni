import { gantt, type ZoomLevel } from 'dhtmlx-gantt';

/**
 * Marks the scale cell holding today, whatever span that cell covers.
 *
 * A cell's own `css` hook only receives where the cell starts, so the span has
 * to come from the scale it is declared on. `gantt.templates.scale_cell_class`
 * would be the obvious place instead — it was dropped in dhtmlx 6 and still
 * compiles to nothing.
 */
const marksToday = (unit: string, step: number, className: string) => (date: Date) => {
  const now = new Date();
  return now >= date && now < gantt.date.add(date, step, unit) ? className : '';
};

/** The finest row of a scale: a filled pill on the exact cell. */
const todayCell = (unit: string, step = 1) => marksToday(unit, step, 'gantt-scale--today');

/**
 * A coarser row above it: coloured text only. A filled pill on a week or a year
 * paints a band across the whole header.
 */
const todaySpan = (unit: string, step = 1) => marksToday(unit, step, 'gantt-scale--today-span');

/**
 * Quarters as a scale unit.
 *
 * dhtmlx builds a custom unit from `<unit>_start` and `add_<unit>`, and ships
 * neither for quarters. Without one the coarsest level draws a column per
 * month, so a project longer than about ten months cannot be fitted into the
 * timeline at all: `zoomToFit` then crops it — from the start, and in silence,
 * because smart rendering does not draw a row whose bar falls outside the
 * range.
 */
export function registerQuarterUnit(): void {
  gantt.date.quarter_start = (date: Date) => {
    const start = gantt.date.month_start(new Date(date));
    start.setMonth(Math.floor(start.getMonth() / 3) * 3);
    return start;
  };
  gantt.date.add_quarter = (date: Date, increment: number) =>
    gantt.date.add(date, increment * 3, 'month');
}

const quarterLabel = (date: Date) => `T${Math.floor(date.getMonth() / 3) + 1}`;

export const ZOOM_LEVELS: ZoomLevel[] = [
  {
    name: 'day',
    scale_height: 50,
    scales: [{ unit: 'day', step: 1, format: '%d %M', css: todayCell('day') }],
  },
  {
    name: 'week',
    scale_height: 50,
    scales: [
      { unit: 'week', step: 1, format: 'Week %W', css: todaySpan('week') },
      { unit: 'day', step: 1, format: '%d %M', css: todayCell('day') },
    ],
  },
  {
    name: 'month',
    scale_height: 50,
    scales: [
      { unit: 'month', step: 1, format: '%F %Y', css: todaySpan('month') },
      { unit: 'week', step: 1, format: 'Week %W', css: todayCell('week') },
    ],
  },
  {
    name: 'quarter',
    scale_height: 50,
    scales: [
      { unit: 'quarter', step: 1, format: quarterLabel, css: todaySpan('quarter') },
      { unit: 'month', step: 1, format: '%M', css: todayCell('month') },
    ],
  },
  {
    name: 'year',
    scale_height: 50,
    scales: [
      { unit: 'year', step: 1, format: '%Y', css: todaySpan('year') },
      { unit: 'quarter', step: 1, format: quarterLabel, css: todayCell('quarter') },
    ],
  },
];

/** What the status bar calls each zoom level: the band above its columns. */
export const SCALE_LABELS: Record<string, string> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
  year: 'Years',
};

export const INITIAL_SCALE_LABEL = SCALE_LABELS.week;

/** How long one ctrl+wheel gesture holds the scale still after a step. */
export const WHEEL_ZOOM_COOLDOWN = 200;
