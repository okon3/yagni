import { equalSplit, type AllocationPolicy } from './allocation';
import { DEFAULT_CALENDAR, WorkingCalendar, type CalendarSpec } from './calendar';
import { expandRanges } from './dayRange';
import { assertAcyclic, buildSuccessorIndex } from './topology';
import type {
  AllocationSegment,
  Resource,
  ResourceId,
  Schedule,
  ScheduledTask,
  Task,
  TaskId,
} from './types';

/** Man-minute tolerance below which a task counts as finished, absorbing float drift. */
const EPSILON = 1e-9;

/**
 * Whether the task was stretched by sharing its resource with another task.
 *
 * Distinct from "ran below full rate", which part-time and a reduced period also
 * produce: those two call for a change to the person, contention for a change to
 * the tasks. A caller that cannot tell them apart cannot decide what to do.
 */
export function isContended(task: ScheduledTask): boolean {
  return task.segments.some((segment) => segment.rate < segment.soloRate - EPSILON);
}

export interface ScheduleOptions {
  calendar?: CalendarSpec;
  /** Anchors the working-minute axis. Defaults to the earliest start constraint. */
  origin?: Date;
  allocate?: AllocationPolicy;
}

interface SimTask {
  task: Task;
  remaining: number;
  /** Working minutes; undefined while predecessors are still pending. */
  ready: number | undefined;
  pendingPredecessors: number;
  startedAt: number | undefined;
  finishedAt: number | undefined;
  segments: { start: number; end: number; rate: number; soloRate: number }[];
}

export function schedule(
  tasks: Task[],
  resources: Resource[] = [],
  options: ScheduleOptions = {},
): Schedule {
  assertAcyclic(tasks);

  const origin =
    options.origin ??
    tasks.reduce<Date | undefined>((earliest, task) => {
      const start = task.startConstraint;
      if (!start) return earliest;
      return !earliest || start < earliest ? start : earliest;
    }, undefined) ??
    new Date();

  const calendar = new WorkingCalendar(origin, options.calendar ?? DEFAULT_CALENDAR);
  const allocate = options.allocate ?? equalSplit;
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  /**
   * Availability overrides projected onto the working-minute axis.
   *
   * Days that are not working days collapse to the same coordinate, so a period
   * falling entirely on a weekend or inside a company shutdown becomes a
   * zero-width interval and correctly costs nothing.
   */
  const overrides = new Map<ResourceId, { from: number; to: number; availability: number }[]>();
  const capacityEdges: number[] = [];
  for (const resource of resources) {
    const intervals: { from: number; to: number; availability: number }[] = [];
    for (const override of resource.availabilityOverrides ?? []) {
      const days = [...expandRanges([override])].sort((a, b) => a - b);
      for (const day of days) {
        const from = calendar.dayStartInWorkingMinutes(day);
        const to = calendar.dayStartInWorkingMinutes(day + 1);
        if (to <= from) continue;
        const availability = Math.max(0, override.availability);
        // Consecutive days at the same rate merge into one interval, keeping the
        // event list short for a two-week period.
        const last = intervals[intervals.length - 1];
        if (last && last.to === from && last.availability === availability) last.to = to;
        else intervals.push({ from, to, availability });
      }
    }
    if (intervals.length === 0) continue;
    overrides.set(resource.id, intervals);
    for (const interval of intervals) capacityEdges.push(interval.from, interval.to);
  }
  capacityEdges.sort((a, b) => a - b);

  const capacityAt = (resourceId: ResourceId, at: number): number => {
    const resource = resourceById.get(resourceId);
    if (!resource) return 0;
    // Last match wins, so a narrow exception declared after a broad period takes
    // precedence over it.
    const covering = (overrides.get(resourceId) ?? []).filter(
      (interval) => at >= interval.from && at < interval.to,
    );
    if (covering.length > 0) return covering[covering.length - 1].availability;
    return resource.availability ?? 1;
  };

  const nextCapacityEdge = (after: number): number | undefined =>
    capacityEdges.find((edge) => edge > after);
  const successors = buildSuccessorIndex(tasks);

  const states = new Map<TaskId, SimTask>();
  for (const task of tasks) {
    const pendingPredecessors = task.predecessors?.length ?? 0;
    states.set(task.id, {
      task,
      remaining: Math.max(0, task.effort),
      ready:
        pendingPredecessors === 0
          ? task.startConstraint
            ? calendar.toWorkingMinutes(task.startConstraint)
            : 0
          : undefined,
      pendingPredecessors,
      startedAt: undefined,
      finishedAt: undefined,
      segments: [],
    });
  }

  if (states.size === 0) {
    return { tasks: new Map(), projectStart: calendar.origin, projectEnd: calendar.origin };
  }

  let remainingCount = states.size;
  /** Latest predecessor finish seen so far, tracked separately because `ready`
   *  stays undefined until the last predecessor closes. */
  const predecessorFinish = new Map<TaskId, number>();

  const finish = (state: SimTask, at: number): void => {
    state.finishedAt = at;
    state.startedAt ??= at;
    remainingCount--;
    for (const successorId of successors.get(state.task.id) ?? []) {
      const successor = states.get(successorId)!;
      successor.pendingPredecessors--;
      predecessorFinish.set(successorId, Math.max(predecessorFinish.get(successorId) ?? 0, at));
      if (successor.pendingPredecessors === 0) {
        const constraint = successor.task.startConstraint
          ? calendar.toWorkingMinutes(successor.task.startConstraint)
          : 0;
        successor.ready = Math.max(constraint, predecessorFinish.get(successorId)!);
      }
    }
  };

  const pending = (): SimTask[] => {
    const list: SimTask[] = [];
    for (const state of states.values()) if (state.finishedAt === undefined) list.push(state);
    return list;
  };

  const initialReady = pending()
    .map((state) => state.ready)
    .filter((ready): ready is number => ready !== undefined);
  if (initialReady.length === 0) {
    throw new Error('Scheduler stalled: every task waits on a predecessor');
  }

  let clock = Math.min(...initialReady);
  // Each iteration consumes at least one completion, one arrival, or one absence
  // edge; the bound turns any future logic error into a clear failure instead of
  // a hang. It has to count the capacity edges too, or a team with a lot of
  // holiday would trip a convergence error that is not one.
  const maxIterations = 4 * states.size + 2 * capacityEdges.length + 16;

  for (let iteration = 0; remainingCount > 0; iteration++) {
    if (iteration > maxIterations) {
      throw new Error(`Scheduler failed to converge after ${iteration} iterations`);
    }

    // Zero-effort tasks (milestones) close as soon as they are reachable, and may
    // cascade into further milestones, so drain them before allocating capacity.
    let drained = true;
    while (drained) {
      drained = false;
      for (const state of pending()) {
        if (state.ready !== undefined && state.ready <= clock && state.remaining <= EPSILON) {
          finish(state, state.ready);
          drained = true;
        }
      }
    }
    if (remainingCount === 0) break;

    const stillPending = pending();
    const active = stillPending.filter(
      (state) => state.ready !== undefined && state.ready <= clock,
    );
    const nextArrival = stillPending
      .map((state) => state.ready)
      .filter((ready): ready is number => ready !== undefined && ready > clock)
      .reduce<number | undefined>(
        (min, ready) => (min === undefined || ready < min ? ready : min),
        undefined,
      );

    if (active.length === 0) {
      if (nextArrival === undefined) {
        throw new Error('Scheduler stalled: pending tasks are unreachable');
      }
      clock = nextArrival;
      continue;
    }

    const groups = new Map<string | null, SimTask[]>();
    for (const state of active) {
      const key = state.task.resourceId ?? null;
      const group = groups.get(key);
      if (group) group.push(state);
      else groups.set(key, [state]);
    }

    const rates = new Map<TaskId, number>();
    const soloRates = new Map<TaskId, number>();
    for (const [key, group] of groups) {
      const resource = key === null ? undefined : resourceById.get(key);
      // Unassigned tasks have no owner to share, so each one gets a full rate.
      const capacity = key === null ? group.length : capacityAt(key, clock);
      const granted = allocate({
        resource,
        capacity,
        candidates: group.map((state) => ({ id: state.task.id, remaining: state.remaining })),
      });
      const solo = key === null ? 1 : capacity;
      for (const state of group) {
        rates.set(state.task.id, granted.get(state.task.id) ?? 0);
        soloRates.set(state.task.id, solo);
      }
    }

    let step = nextArrival === undefined ? Infinity : nextArrival - clock;
    // An absence starting or ending changes the rates even though no task
    // started or finished, so its edges are events in their own right.
    const nextCapacityChange = nextCapacityEdge(clock);
    if (nextCapacityChange !== undefined) step = Math.min(step, nextCapacityChange - clock);
    for (const state of active) {
      const rate = rates.get(state.task.id)!;
      if (rate > 0) step = Math.min(step, state.remaining / rate);
    }
    if (!Number.isFinite(step)) {
      // Everyone active is away and nothing will ever change: a task assigned to
      // a resource that is off forever would otherwise spin here.
      throw new Error('Scheduler stalled: no active task received capacity');
    }

    for (const state of active) {
      const rate = rates.get(state.task.id)!;
      if (rate <= 0) continue;
      const soloRate = soloRates.get(state.task.id)!;
      state.startedAt ??= clock;
      const last = state.segments[state.segments.length - 1];
      // Events on other resources split the timeline without changing this rate;
      // merging keeps the rendered bar from fragmenting into meaningless slices.
      if (last && last.end === clock && last.rate === rate && last.soloRate === soloRate) {
        last.end = clock + step;
      } else {
        state.segments.push({ start: clock, end: clock + step, rate, soloRate });
      }
      state.remaining -= rate * step;
    }

    clock += step;

    for (const state of active) {
      if (state.finishedAt === undefined && state.remaining <= EPSILON) finish(state, clock);
    }
  }

  const scheduled = new Map<TaskId, ScheduledTask>();
  for (const [id, state] of states) {
    const startMinutes = state.startedAt ?? 0;
    const endMinutes = state.finishedAt ?? startMinutes;
    scheduled.set(id, {
      id,
      start: calendar.fromWorkingMinutes(startMinutes, 'start'),
      end: calendar.fromWorkingMinutes(endMinutes, 'end'),
      startWorkingMinutes: startMinutes,
      endWorkingMinutes: endMinutes,
      elapsedWorkingMinutes: endMinutes - startMinutes,
      effortMinutes: state.task.effort,
      segments: state.segments.map<AllocationSegment>((segment) => ({
        start: calendar.fromWorkingMinutes(segment.start, 'start'),
        end: calendar.fromWorkingMinutes(segment.end, 'end'),
        startWorkingMinutes: segment.start,
        endWorkingMinutes: segment.end,
        rate: segment.rate,
        soloRate: segment.soloRate,
      })),
    });
  }

  const starts = [...states.values()].map((state) => state.startedAt ?? 0);
  const ends = [...states.values()].map((state) => state.finishedAt ?? 0);
  return {
    tasks: scheduled,
    projectStart: calendar.fromWorkingMinutes(Math.min(...starts), 'start'),
    projectEnd: calendar.fromWorkingMinutes(Math.max(...ends), 'end'),
  };
}
