import { capacityAt, capacityIntervals } from './availability';
import type { WorkingCalendar } from './calendar';
import type { Resource, ResourceId, Schedule, Task, TaskId } from './types';

/** What one task contributes to a resource's load over a stretch. */
export interface LoadShare {
  taskId: TaskId;
  /** Fraction of a full-time person, the same figure the allocation profile draws. */
  rate: number;
}

/**
 * A stretch over which both what a resource owes and what it has stay constant.
 *
 * `start` and `end` are for display. Consecutive segments are contiguous in
 * working minutes and not on the wall clock — one ends at 17:00 and the next
 * opens at 08:00 — so compare the working-minute fields to test adjacency.
 */
export interface LoadSegment {
  start: Date;
  end: Date;
  startWorkingMinutes: number;
  endWorkingMinutes: number;
  /** Sum of the rates granted to the tasks running here. Never above `capacity`. */
  committed: number;
  /** What the resource had to give: its availability, an override in force included. */
  capacity: number;
  shares: LoadShare[];
}

export interface ResourceLoad {
  resourceId: ResourceId;
  /** Tiles the plan end to end, idle stretches included, so a gap is a segment at zero. */
  segments: LoadSegment[];
  /** Man-minutes of work booked on the resource. */
  committedMinutes: number;
  /** Man-minutes the resource had over the plan and nothing claimed. */
  idleMinutes: number;
}

/** Ascending, without duplicates. */
function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * What each person's plan looks like from their side: the same segments the bars
 * draw, aggregated by resource instead of by task.
 *
 * The engine divides capacity rather than exceeding it, so a lane can never read
 * as over-allocated. The signal is the opposite one — capacity nobody claimed —
 * which is why the segments tile the whole plan instead of only the stretches
 * with work on them, and why every resource is answered for, including one with
 * nothing to do.
 *
 * `tasks` is the leaves as the engine received them: a summary is never
 * scheduled, and one contributing here would double-count the very children it
 * rolls up. Its rows carry no allocation segments either, so it could not
 * contribute even if it were passed in.
 */
export function resourceLoad(
  tasks: Task[],
  resources: Resource[],
  schedule: Schedule,
  calendar: WorkingCalendar,
): ResourceLoad[] {
  const scheduledOf = (id: TaskId) => schedule.tasks.get(id);
  const horizon = tasks.reduce(
    (latest, task) => Math.max(latest, scheduledOf(task.id)?.endWorkingMinutes ?? 0),
    0,
  );

  /** Every allocation segment of the plan, tagged with whose it is. */
  const booked = new Map<ResourceId, (LoadShare & { from: number; to: number; solo: number })[]>();
  const known = new Set(resources.map((resource) => resource.id));
  for (const task of tasks) {
    if (!task.resourceId || !known.has(task.resourceId)) continue;
    const entries = booked.get(task.resourceId) ?? [];
    for (const segment of scheduledOf(task.id)?.segments ?? []) {
      entries.push({
        taskId: task.id,
        rate: segment.rate,
        from: segment.startWorkingMinutes,
        to: segment.endWorkingMinutes,
        solo: segment.soloRate,
      });
    }
    booked.set(task.resourceId, entries);
  }

  return resources.map((resource) => {
    const entries = booked.get(resource.id) ?? [];
    const intervals = capacityIntervals(resource, calendar);
    const edges = sortedUnique(
      [
        0,
        horizon,
        ...entries.flatMap((entry) => [entry.from, entry.to]),
        ...intervals.flatMap((interval) => [interval.from, interval.to]),
      ].filter((edge) => edge >= 0 && edge <= horizon),
    );

    const segments: LoadSegment[] = [];
    let committedMinutes = 0;
    let idleMinutes = 0;
    for (let index = 0; index + 1 < edges.length; index++) {
      const from = edges[index];
      const to = edges[index + 1];
      const active = entries.filter((entry) => entry.from <= from && entry.to >= to);
      // Where somebody is working, what they would have had alone is the very
      // capacity the simulation divided, so it is read back rather than resolved
      // again. Concurrent segments agree on it by construction: it is one
      // resource at one instant.
      const capacity = active.length > 0 ? active[0].solo : capacityAt(resource, intervals, from);
      const committed = active.reduce((total, entry) => total + entry.rate, 0);
      committedMinutes += committed * (to - from);
      idleMinutes += Math.max(0, capacity - committed) * (to - from);

      const shares = active.map(({ taskId, rate }) => ({ taskId, rate }));
      const last = segments[segments.length - 1];
      // An event on another task splits the axis without changing anything here,
      // so a lane would otherwise fragment into slices that say nothing.
      if (last && last.capacity === capacity && sameShares(last.shares, shares)) {
        last.endWorkingMinutes = to;
        last.end = calendar.fromWorkingMinutes(to, 'end');
        continue;
      }
      segments.push({
        start: calendar.fromWorkingMinutes(from, 'start'),
        end: calendar.fromWorkingMinutes(to, 'end'),
        startWorkingMinutes: from,
        endWorkingMinutes: to,
        committed,
        capacity,
        shares,
      });
    }

    return { resourceId: resource.id, segments, committedMinutes, idleMinutes };
  });
}

/** Same tasks at the same rates, in the same order — which the entries are built in. */
function sameShares(left: LoadShare[], right: LoadShare[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (share, index) =>
        share.taskId === right[index].taskId && share.rate === right[index].rate,
    )
  );
}
