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

export interface Resource {
  id: ResourceId;
  name: string;
  /** Share of a full working day this resource is available for. 1 = full time. */
  availability?: number;
}

/** A stretch of time during which a task progressed at a constant rate. */
export interface AllocationSegment {
  start: Date;
  end: Date;
  startWorkingMinutes: number;
  endWorkingMinutes: number;
  /** Fraction of a full-time resource devoted to the task. 0.5 = two concurrent tasks. */
  rate: number;
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
