import type { LoadSegment, Resource, ResourceLoad } from '../scheduler';
import { avatarColorOf, initialsOf, resourceClass } from './colors';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tall enough for the profile to be read as a shape, short enough for ten people. */
const LANE_HEIGHT = 26;

export interface LoadLane {
  resource: Resource;
  load: ResourceLoad;
  /** Working days booked on the person, and left on the table, for the label. */
  committedDays: number;
  idleDays: number;
}

/**
 * Everything the panel needs from the chart it hangs under.
 *
 * Positions come from the chart's own `posFromDate` rather than from a linear
 * mapping of its own: above day scale a column spans an unequal number of days,
 * so any second opinion about where a date sits would drift from the bars.
 */
export interface LoadGeometry {
  /** The grid's width, which the labels take so a lane starts where the bars do. */
  gridWidth: number;
  /** The timeline's full content width in pixels. */
  timelineWidth: number;
  scrollX: number;
  posOf(date: Date): number;
  /** The non-working runs as pixel spans, exactly as the chart shades them. */
  nonWorking: { left: number; width: number }[];
  /** Names for the breakdown, since the engine only knows ids. */
  nameOf(taskId: string): string;
}

const dayMonth = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' });
const percent = (rate: number) => `${Math.round(rate * 100)}%`;
/** Two decimals would claim a precision nobody plans to. */
const roundDays = (value: number) => Math.round(value * 10) / 10;

/** The profile as one step path anchored to the bottom of the lane. */
function stepPath(
  segments: LoadSegment[],
  level: (segment: LoadSegment) => number,
  posOf: (date: Date) => number,
): string {
  if (segments.length === 0) return '';
  // Full capacity stops a pixel short of the top: the ceiling is a stroked line,
  // and one drawn exactly on the edge would be clipped in half.
  const y = (rate: number) => (LANE_HEIGHT - rate * (LANE_HEIGHT - 1)).toFixed(2);
  const step = (x: number, rate: number) => ` L ${x.toFixed(2)},${y(rate)}`;

  let right = posOf(segments[0].start);
  let path = `M ${right.toFixed(2)},${LANE_HEIGHT}`;
  segments.forEach((segment, index) => {
    const here = level(segment);
    right = posOf(segment.end);
    path += step(posOf(segment.start), here) + step(right, here);

    const next = segments[index + 1];
    if (!next) return;
    // Two segments meet on the working-minute axis and not on the wall clock:
    // one closes at 17:00 and the next opens at 08:00, and the night between
    // them is pixels here while being no time at all there. It is drawn at the
    // lower of the two levels, which is what keeps the filled area exactly as
    // wide as the bars above: work ending at 17:00 does not creep into the next
    // morning, and work starting at 08:00 does not reach back over the weekend
    // before it.
    const bridge = Math.min(here, level(next));
    right = posOf(next.start);
    path += step(posOf(segment.end), bridge) + step(right, bridge);
  });
  return `${path} L ${right.toFixed(2)},${LANE_HEIGHT} Z`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function laneLabel(lane: LoadLane, width: number): HTMLElement {
  const label = element('div', 'loadlane__label');
  label.style.width = `${width}px`;

  const avatar = element('span', 'gantt-avatar');
  avatar.style.background = avatarColorOf(lane.resource.name);
  avatar.textContent = initialsOf(lane.resource.name);
  // The same attribute the grid's and the toolbar's avatars carry, so hovering
  // one here highlights that person's work on the chart above.
  avatar.dataset.resourceId = lane.resource.id;

  const name = element('span', 'loadlane__name');
  name.textContent = lane.resource.name;

  const totals = element('span', 'loadlane__totals');
  totals.textContent = `${roundDays(lane.committedDays)}g`;
  totals.title = `${roundDays(lane.committedDays)} giorni impegnati, ${roundDays(lane.idleDays)} liberi`;
  if (lane.idleDays > 0) {
    const idle = element('span', 'loadlane__idle');
    idle.textContent = ` · ${roundDays(lane.idleDays)}g libere`;
    totals.append(idle);
  }

  label.append(avatar, name, totals);
  return label;
}

/** What the pointer is over, kept beside the lane so a hover needs no measuring. */
interface Hotspot {
  from: number;
  to: number;
  segment: LoadSegment;
}

function laneTrack(lane: LoadLane, geometry: LoadGeometry, tip: HTMLElement): HTMLElement {
  const track = element('div', 'loadlane__track');
  const scroller = element('div', 'loadlane__scroll');
  scroller.style.width = `${geometry.timelineWidth}px`;

  for (const band of geometry.nonWorking) {
    const shade = element('div', 'loadlane__off');
    shade.style.left = `${band.left}px`;
    shade.style.width = `${band.width}px`;
    scroller.append(shade);
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'loadlane__plot');
  svg.setAttribute('width', String(geometry.timelineWidth));
  svg.setAttribute('height', String(LANE_HEIGHT));
  const capacity = document.createElementNS(SVG_NS, 'path');
  capacity.setAttribute('class', 'loadlane__capacity');
  capacity.setAttribute('d', stepPath(lane.load.segments, (s) => s.capacity, geometry.posOf));
  const committed = document.createElementNS(SVG_NS, 'path');
  committed.setAttribute('class', 'loadlane__committed');
  committed.setAttribute('d', stepPath(lane.load.segments, (s) => s.committed, geometry.posOf));
  // Inline, because a rule in a stylesheet outranks an SVG presentation
  // attribute and every lane carries its own person's colour.
  committed.setAttribute('style', `fill:${avatarColorOf(lane.resource.name)}`);
  svg.append(capacity, committed);
  scroller.append(svg);
  track.append(scroller);

  // Reaching to the next segment's own left edge rather than to this one's right:
  // the hover has to answer everywhere along the lane, and the nights between two
  // segments would otherwise be places where nothing is said at all.
  const hotspots: Hotspot[] = lane.load.segments.map((segment, index) => {
    const next = lane.load.segments[index + 1];
    return {
      from: geometry.posOf(segment.start),
      to: next ? geometry.posOf(next.start) : geometry.posOf(segment.end),
      segment,
    };
  });

  track.addEventListener('mousemove', (event) => {
    const bounds = track.getBoundingClientRect();
    // The lane is offset by however far the chart is scrolled, so a pointer
    // position is a timeline coordinate only once that is added back.
    const x = event.clientX - bounds.left + currentScroll(track);
    const hit = hotspots.find((spot) => x >= spot.from && x < spot.to);
    if (!hit) {
      tip.hidden = true;
      return;
    }
    showTip(tip, lane, hit.segment, geometry, event);
  });
  track.addEventListener('mouseleave', () => {
    tip.hidden = true;
  });

  return track;
}

/** The offset the last scroll wrote, read back off the element that carries it. */
function currentScroll(track: HTMLElement): number {
  const scroller = track.firstElementChild as HTMLElement | null;
  return scroller ? -Number.parseFloat(scroller.style.left || '0') : 0;
}

function showTip(
  tip: HTMLElement,
  lane: LoadLane,
  segment: LoadSegment,
  geometry: LoadGeometry,
  pointer: MouseEvent,
): void {
  const when = element('div', 'loadtip__when');
  when.textContent = `${lane.resource.name} · ${dayMonth.format(segment.start)} – ${dayMonth.format(segment.end)}`;

  const headline = element('div', 'loadtip__headline');
  headline.textContent =
    segment.capacity === 0
      ? 'Assente'
      : `Impegno ${percent(segment.committed)} su ${percent(segment.capacity)} disponibile`;

  tip.replaceChildren(when, headline);

  if (segment.shares.length === 0 && segment.capacity > 0) {
    const free = element('div', 'loadtip__free');
    free.textContent = 'Nessuna attività in corso';
    tip.append(free);
  }
  for (const share of segment.shares) {
    const row = element('div', 'loadtip__task');
    const name = element('span', 'loadtip__name');
    name.textContent = geometry.nameOf(share.taskId);
    const rate = element('span', 'loadtip__rate');
    rate.textContent = percent(share.rate);
    row.append(name, rate);
    tip.append(row);
  }

  // Shown before it is measured, and above the pointer: the lane being read is
  // 26 pixels tall, and a box under the pointer would cover the very stretch the
  // figures are about.
  tip.hidden = false;
  const left = Math.min(pointer.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, pointer.clientY - tip.offsetHeight - 12)}px`;
}

/**
 * Draws the lanes from scratch.
 *
 * Rebuilding rather than patching: a redraw of the chart can change the scale,
 * the range and the grid's width at once, and the panel is a few dozen nodes.
 */
export function renderLoadPanel(
  root: HTMLElement,
  lanes: LoadLane[],
  geometry: LoadGeometry,
): void {
  if (lanes.length === 0) {
    const empty = element('p', 'loadpanel__empty');
    empty.textContent = 'Nessuna risorsa: il carico si legge per persona.';
    root.replaceChildren(empty);
    return;
  }

  const tip = element('div', 'loadtip');
  tip.hidden = true;
  const list = element('div', 'loadpanel__lanes');
  for (const lane of lanes) {
    // The same class the rows and bars carry, so highlighting one person
    // reaches their lane through the very rule that dims the chart.
    const row = element('div', `loadlane ${resourceClass(lane.resource.id)}`);
    row.append(laneLabel(lane, geometry.gridWidth), laneTrack(lane, geometry, tip));
    list.append(row);
  }
  root.replaceChildren(list, tip);
  scrollLoadPanel(root, geometry.scrollX);
}

/**
 * Keeps the lanes under the bars they belong to.
 *
 * `left` rather than a transform: the tooltip reads the offset back off it, and
 * a transform would also need a matrix to be parsed.
 */
export function scrollLoadPanel(root: HTMLElement, scrollX: number): void {
  for (const scroller of root.querySelectorAll<HTMLElement>('.loadlane__scroll')) {
    scroller.style.left = `${-scrollX}px`;
  }
}
