import type { ScheduledTask } from '../scheduler';
import { needsDarkInk } from './colors';

/** Narrower than this and the percentage would not fit or would collide. */
const MIN_LABEL_WIDTH_PX = 30;
/** Above this rate the filled area is tall enough to hold the label inside it. */
const LABEL_INSIDE_RATE = 0.45;

export function isShared(scheduled: ScheduledTask): boolean {
  return scheduled.segments.some((segment) => segment.rate < 1);
}

/**
 * Renders the allocation profile inside the task bar.
 *
 * Drawn as one continuous SVG path rather than a block per regime: separate
 * blocks, each with its own border and rounded corners, read as separate tasks
 * instead of one task whose intensity changes. The path is anchored to the
 * bottom of the bar, so a task at 100% fills it completely and looks like an
 * ordinary Gantt bar, while a shared stretch dips.
 *
 * The viewBox is 0..100 on both axes with `preserveAspectRatio="none"`, so x
 * coordinates are percentages of the bar and no measurement is needed. Labels
 * stay in HTML: non-uniform scaling would distort SVG text.
 *
 * `barWidthPx` only decides which labels fit; the geometry is resolution-free.
 */
export function renderSegments(
  scheduled: ScheduledTask,
  barWidthPx: number,
  fill: string,
  stroke: string,
): string {
  const spanMs = scheduled.end.getTime() - scheduled.start.getTime();
  if (!isShared(scheduled) || spanMs <= 0 || scheduled.segments.length === 0) {
    return '';
  }

  const origin = scheduled.start.getTime();
  const asPercent = (date: Date) => ((date.getTime() - origin) / spanMs) * 100;

  let path = 'M 0,100';
  const labels: string[] = [];

  scheduled.segments.forEach((segment, index) => {
    const next = scheduled.segments[index + 1];
    const from = asPercent(segment.start);
    // Consecutive segments are contiguous in *working* time but not on the wall
    // clock: one ends at 17:00 and the next starts at 08:00, and those night and
    // weekend hours still occupy pixels. Carrying the level across to the next
    // segment keeps one shape whose steps are real allocation changes; stopping
    // at `segment.end` instead punches a hole at every nightfall.
    const idleAhead = next && next.startWorkingMinutes > segment.endWorkingMinutes;
    const to = next && !idleAhead ? asPercent(next.start) : asPercent(segment.end);
    const top = 100 - segment.rate * 100;

    path += ` L ${from.toFixed(2)},${top.toFixed(2)} L ${to.toFixed(2)},${top.toFixed(2)}`;
    // Genuine idle time — reachable once allocation can be capped — drops the
    // outline to the floor so the pause stays visible.
    if (idleAhead) path += ` L ${to.toFixed(2)},100 L ${asPercent(next.start).toFixed(2)},100`;

    if (((to - from) / 100) * barWidthPx >= MIN_LABEL_WIDTH_PX) {
      const centre = (from + to) / 2;
      const percent = Math.round(segment.rate * 100);
      // A thin band cannot hold the text, so it sits just above the fill and
      // switches to dark ink against the empty part of the bar.
      const inside = segment.rate >= LABEL_INSIDE_RATE;
      const style = inside
        ? `left:${centre.toFixed(2)}%;top:${(100 - segment.rate * 50).toFixed(2)}%`
        : `left:${centre.toFixed(2)}%;bottom:${(segment.rate * 100).toFixed(2)}%`;
      // Sitting on the fill, the badge's ink has to follow the fill: a pale
      // tint needs dark ink the same way the empty track does above.
      const modifier = inside ? (needsDarkInk(fill) ? ' seg-pct--dark' : '') : ' seg-pct--above';
      labels.push(`<span class="seg-pct${modifier}" style="${style}">${percent}%</span>`);
    }
  });
  path += ' L 100,100 Z';

  return (
    '<div class="seg-track">' +
    '<svg class="seg-fill" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
    // Inline style, not fill/stroke attributes: a stylesheet rule outranks an SVG
    // presentation attribute, so an attribute here would be silently overridden.
    `<path d="${path}" style="fill:${fill};stroke:${stroke}" vector-effect="non-scaling-stroke" /></svg>` +
    labels.join('') +
    '</div>'
  );
}
