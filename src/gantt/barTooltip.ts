import { formatDays } from './format';
import { escapeHtml } from './html';
import { isShared } from './segmentBar';
import { isContended, type Resource, type ScheduledTask } from '../scheduler';
import { peopleUnder, type MarkedChain, type ProjectTask, type SolvedProject } from './project';

/**
 * Everything the hover has to answer, resolved before any of it is rendered.
 *
 * A plain record rather than the task and the solved project, so the wording is
 * testable without a chart and without a schedule to build.
 */
export interface BarFacts {
  name: string;
  /** Figures and dates roll up from the leaves, and it is never scheduled. */
  isSummary: boolean;
  descendantCount: number;
  start: Date;
  /** Already the end to show, so a milestone does not read backwards. */
  end: Date;
  effortDays: number;
  elapsedDays: number;
  /** Absent on a summary, which aggregates several people, and on nobody assigned. */
  resource: { name: string; availability: number } | null;
  /**
   * Everyone working under a summary, in the order their faces are stacked on
   * the row. Empty on a leaf, which names its one resource instead.
   *
   * The stack stops at four and says "+n" for the rest, so the row alone cannot
   * answer who they are — this is where it is answered, and the shared order is
   * what lets the two be read against each other.
   */
  people: { name: string; availability: number }[];
  /** The rates the task actually ran at, in the order it ran them. */
  rates: number[];
  /** Ran below full rate *because* the resource was split with another task. */
  contended: boolean;
  /** Ran below full rate at all — part-time and absence included. */
  shared: boolean;
  /** Effective state: a leaf's own flag or inherited, a summary once every leaf under it is. */
  disabled: boolean;
  /**
   * What the chart is marking, or null when it is marking nothing.
   *
   * Only what has already been measured: the float *figure* costs a re-solve of
   * the plan per day probed, which is a price for a click on the details button
   * and not for a pointer crossing a bar.
   */
  chain: { isCritical: boolean; contendedOn: string | null; stale: boolean } | null;
}

/** The weekday matters on a Gantt: it is why a bar ends where it does. */
const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/**
 * The rates the task ran at, as one figure or as the span it moved between.
 *
 * Read off the segments the simulation produced, never worked back out of the
 * dates: a summary and a task with no effort both have no segments at all, and
 * the second of those spans no time to divide by either.
 */
function rateRange(rates: number[]): string | null {
  if (rates.length === 0) return null;
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  return low === high ? percent(low) : `${percent(low)}–${percent(high)}`;
}

/** The person, with the share of a day they give the plan when it is not all of it. */
function resourceLabel(resource: BarFacts['resource']): string {
  if (!resource) return '&mdash;';
  const name = escapeHtml(resource.name);
  return resource.availability < 1 ? `${name} <em>at ${percent(resource.availability)}</em>` : name;
}

/**
 * Why the bar is longer than the effort, said once.
 *
 * Contention and part-time both stretch a task and call for different moves —
 * reassign the task, or change the person — so the note names which one it was.
 * Where the criticality line below already names the person the task contends
 * with, this would be a second sentence about the same fact.
 */
function stretchNote(facts: BarFacts, namesContention: boolean): string {
  if (facts.contended) {
    return namesContention
      ? ''
      : 'The resource is split with other tasks in progress, so the duration exceeds the effort.';
  }
  if (facts.shared) {
    return 'The resource does not work full time in this period, so the duration exceeds the effort.';
  }
  return '';
}

/**
 * What the hover over a bar says.
 *
 * The dialog behind the row's button is one row at a time and costs a click; a
 * plan is read by sweeping it. So this answers the two questions a bar raises —
 * what is it, and why is it that long — from figures that are already computed,
 * and asks the engine for nothing.
 */
export function renderBarTooltip(facts: BarFacts): string {
  const rows: [string, string][] = [
    ['Start', longDate.format(facts.start)],
    ['End', longDate.format(facts.end)],
    ['Effort', `${formatDays(facts.effortDays)} d`],
  ];
  // The comparison the whole chart is about, so the duration carries the same
  // warning colour here that it carries in the dialog.
  const stretched = facts.elapsedDays > facts.effortDays;
  rows.push([
    'Duration',
    `<span class="${stretched ? 'gantt-stretched' : ''}">${formatDays(facts.elapsedDays)} d</span>`,
  ]);
  if (facts.isSummary) {
    rows.push([
      facts.people.length === 1 ? 'Person' : 'People',
      facts.people.length > 0 ? facts.people.map(resourceLabel).join(', ') : '&mdash;',
    ]);
  } else {
    rows.push(['Resource', resourceLabel(facts.resource)]);
    const rate = rateRange(facts.rates);
    if (rate) rows.push(['Share', rate]);
  }

  const namesContention = Boolean(facts.chain?.isCritical && facts.chain.contendedOn);
  const notes: string[] = [];
  if (facts.disabled) {
    notes.push('Disabled — does not weigh on the plan.');
  }
  if (facts.isSummary) {
    const subtasks =
      facts.descendantCount === 1
        ? 'from its subtask'
        : `from its ${facts.descendantCount} subtasks`;
    notes.push(`Summary: effort and dates roll up ${subtasks}.`);
  }
  const stretch = stretchNote(facts, namesContention);
  if (stretch) notes.push(stretch);
  if (facts.chain?.isCritical) {
    const reason = namesContention
      ? ` &mdash; contended on ${escapeHtml(facts.chain.contendedOn ?? '')}`
      : '';
    // Said as plainly as the dashed outline says it: a marking that reads as
    // measured while it is not is worse than none.
    const age = facts.chain.stale ? ' <em>(measured before the last edit)</em>' : '';
    // Nothing with no effort has a size to grow, so its criticality is purely
    // positional — the engine does not even run the second probe on it, and
    // offering growing as a cause would describe a measurement nobody made.
    const grows = facts.effortDays > 0 ? ' or if it grows' : '';
    notes.push(
      `<strong class="gantt-tip__critical">Critical${reason}.</strong> ` +
        `The project end moves if it slips${grows}.${age}`,
    );
  }

  return (
    `<div class="gantt-tip__name">${escapeHtml(facts.name)}</div>` +
    '<dl class="gantt-tip__grid">' +
    rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('') +
    '</dl>' +
    notes.map((note) => `<p class="gantt-tip__note">${note}</p>`).join('')
  );
}

/**
 * Reads the facts off the plan on screen, which is where they already are.
 *
 * The chain is taken as the chart drew it rather than measured again: what the
 * hover says and what the outline shows have to be the same statement, and one
 * of them is not going to pay for a re-solve.
 */
export function barFactsOf(
  task: ProjectTask,
  scheduled: ScheduledTask,
  solved: SolvedProject,
  resources: Resource[],
  chain: MarkedChain | null,
  descendantCount: number,
): BarFacts {
  const assigned = resources.find((entry) => entry.id === task.resourceId);
  const row = chain?.rows.get(task.id);
  const contendedOn = resources.find((entry) => entry.id === row?.contendedResourceId);
  return {
    name: task.name,
    isSummary: solved.summaryIds.has(task.id),
    descendantCount,
    start: scheduled.start,
    end: scheduled.end,
    effortDays: solved.calendar.minutesToDays(scheduled.effortMinutes),
    elapsedDays: solved.calendar.minutesToDays(scheduled.elapsedWorkingMinutes),
    resource: assigned ? { name: assigned.name, availability: assigned.availability ?? 1 } : null,
    // Read through the same helper the row's faces are, so the names and the
    // stack cannot fall into different orders.
    people: solved.summaryIds.has(task.id)
      ? peopleUnder(solved, resources, task.id).map((person) => ({
          name: person.name,
          availability: person.availability ?? 1,
        }))
      : [],
    rates: scheduled.segments.map((segment) => segment.rate),
    contended: isContended(scheduled),
    shared: isShared(scheduled),
    disabled: solved.disabledIds.has(task.id),
    chain: chain
      ? {
          isCritical: row?.isCritical ?? false,
          contendedOn: contendedOn?.name ?? null,
          stale: !chain.fresh,
        }
      : null,
  };
}
