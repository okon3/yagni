import type { DayRange } from './dayRange';

export type TaskId = string;
export type ResourceId = string;

/**
 * A unit of work to schedule.
 *
 * `effort` is expressed in man-minutes, not in calendar duration: the UI converts
 * the duration the user types ("how long with the resource fully dedicated") into
 * effort before handing tasks to the scheduler.
 */
export interface Task {
  id: TaskId;
  name: string;
  effort: number;
  /** Earliest start chosen by the user. Predecessors can push the task later, never earlier. */
  startConstraint?: Date;
  /** Unassigned tasks never contend for capacity and always progress at full rate. */
  resourceId?: ResourceId;
  /** Finish-to-start predecessors. */
  predecessors?: TaskId[];
}

/**
 * A stretch where a resource's availability differs from its default.
 *
 * An absence is just this with `availability: 0` — holiday and reduced capacity
 * are the same mechanism, so the engine has one notion to reason about instead
 * of two that could disagree.
 */
export interface AvailabilityOverride extends DayRange {
  /** Share of a full working day. 0 means away. */
  availability: number;
}

export interface Resource {
  id: ResourceId;
  name: string;
  /** Default share of a full working day. 1 = full time. */
  availability?: number;
  /**
   * Periods where availability differs from the default — holiday, part-time
   * spells, a stint on another project.
   *
   * Unlike a company shutdown these cannot be removed from the shared time axis,
   * since the rest of the team keeps working; they become stretches of different
   * capacity instead. Where two overlap, the one declared last wins, so a
   * specific exception can be added after a broad rule.
   */
  availabilityOverrides?: AvailabilityOverride[];
}

/** A stretch of time during which a task progressed at a constant rate. */
export interface AllocationSegment {
  start: Date;
  end: Date;
  startWorkingMinutes: number;
  endWorkingMinutes: number;
  /** Fraction of a full-time resource devoted to the task. 0.5 = two concurrent tasks. */
  rate: number;
  /**
   * The rate the task would have had with the resource to itself, so `rate`
   * below it means contention and `rate` equal to it means the resource simply
   * has less to give — part-time, or a reduced period.
   *
   * Recorded rather than re-derived: the capacity is the calendar's and the
   * policy's business, and a caller reconstructing it would be a second copy of
   * both. 1 for an unassigned task, which never contends.
   */
  soloRate: number;
}

/**
 * `start` and `end` are for display. Two instants that are contiguous in working
 * time render as different wall-clock dates (17:00 versus 08:00 the next day), so
 * compare the working-minute fields, not the dates, to test adjacency.
 */
export interface ScheduledTask {
  id: TaskId;
  start: Date;
  end: Date;
  startWorkingMinutes: number;
  endWorkingMinutes: number;
  /** Calendar working minutes spanned, which exceeds `effort` whenever the task was shared. */
  elapsedWorkingMinutes: number;
  /** Man-minutes of work. Echoed from the input so callers can roll it up. */
  effortMinutes: number;
  segments: AllocationSegment[];
}

export interface Schedule {
  tasks: Map<TaskId, ScheduledTask>;
  projectStart: Date;
  projectEnd: Date;
}

export class CyclicDependencyError extends Error {
  readonly cycle: TaskId[];

  constructor(cycle: TaskId[]) {
    super(`Cyclic dependency: ${cycle.join(' -> ')}`);
    this.name = 'CyclicDependencyError';
    this.cycle = cycle;
  }
}

export class UnknownPredecessorError extends Error {
  readonly taskId: TaskId;
  readonly predecessorId: TaskId;

  constructor(taskId: TaskId, predecessorId: TaskId) {
    super(`Task "${taskId}" depends on unknown task "${predecessorId}"`);
    this.name = 'UnknownPredecessorError';
    this.taskId = taskId;
    this.predecessorId = predecessorId;
  }
}
