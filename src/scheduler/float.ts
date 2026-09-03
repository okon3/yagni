import { DEFAULT_CALENDAR, WorkingCalendar } from './calendar';
import { isContended, schedule, scheduleOrigin, type ScheduleOptions } from './simulate';
import type { Resource, ResourceId, Schedule, Task, TaskId } from './types';

/** Working minutes of slop when comparing two plan ends. */
const TOLERANCE = 1e-6;

export interface TaskCriticality {
  /**
   * The plan's end depends on this task: it moves when the task starts a step
   * later, or when a step of work is added to it.
   *
   * Not the negation of having float, and the difference is the whole point of
   * asking twice. A person booked solid from the start of the plan absorbs a
   * delay of any single task of theirs — start it later and it runs alone,
   * catching up — while one more day of work on any of them pushes the end out.
   * Those tasks have float *and* are critical, and a planner needs both facts:
   * the task can be moved, but it cannot grow.
   */
  isCritical: boolean;
  /**
   * Whose capacity this task had to share, when that is what stretched it.
   *
   * `isContended`, not a second notion of sharing: a critical task that is
   * contended is one to take off that person, one that is not is one to cut out
   * of its chain, and those are different moves. Absent on a task that had its
   * resource to itself, or has none.
   */
  contendedResourceId?: ResourceId;
}

export interface TaskFloat extends TaskCriticality {
  /**
   * Working minutes the task's start can slip before the plan finishes later.
   *
   * A whole number of steps, one working day by default: half a day of float
   * reads as none, which is the conservative side to round to.
   */
  floatMinutes: number;
}

export interface FloatOptions extends ScheduleOptions {
  /** Resolution of the answer, and the size of a probe. One working day by default. */
  stepMinutes?: number;
  /** Which tasks to measure. All of them by default. */
  ids?: Iterable<TaskId>;
}

/** The plan's end on the working-minute axis, which is what the probes compare. */
function endOfPlan(result: Schedule): number {
  let end = 0;
  for (const task of result.tasks.values()) {
    if (task.endWorkingMinutes > end) end = task.endWorkingMinutes;
  }
  return end;
}

/**
 * Measures how much room each task has before the plan's end moves.
 *
 * The textbook backward pass does not apply here. A resource's capacity is
 * divided between whatever overlaps on it, so a task can set the plan's end
 * with no dependency on it at all — purely because it shares a person with
 * something that does. A float read off the dependency graph would call such a
 * task free, which is the one answer a planner must not be given.
 *
 * So it is measured rather than derived. Two probes, each a re-solve of the
 * whole plan with this one task changed:
 *
 * - **later**: push the task's start out by a step. The largest number of steps
 *   that leaves the end where it was is its float.
 * - **longer**: add a step of effort. If the end moves, the task's size sets the
 *   date, and it is critical however freely it may slide.
 *
 * Between them they mark the critical *chain* — dependencies and contention
 * alike — rather than the critical path.
 *
 * `baseline` must be the schedule of these same tasks. The probes start from
 * where each task actually landed, not from the start it declared, since a task
 * held back by a predecessor has already spent that difference.
 *
 * The doubling search takes the plan's end for monotone in the delay, which it
 * is except where a delay *unshares* a resource — pushing one of two tasks off
 * the other can bring the end in rather than out. Every figure returned is a
 * delay that was simulated and found free, so such a plan reports a float the
 * planner can take rather than a bound nothing ever tried; it may simply not be
 * the largest one.
 */
function measure(
  tasks: Task[],
  resources: Resource[],
  baseline: Schedule,
  options: FloatOptions,
  search: boolean,
): Map<TaskId, TaskFloat> {
  const origin = scheduleOrigin(tasks, options.origin);
  const calendar = new WorkingCalendar(origin, options.calendar ?? DEFAULT_CALENDAR);
  const step = options.stepMinutes ?? calendar.minutesPerDay;
  const baselineEnd = endOfPlan(baseline);
  // Pinned, or a probe on the earliest task would move the axis under the
  // comparison and every figure with it.
  const probeOptions: ScheduleOptions = { ...options, origin };

  const wanted = options.ids ? new Set(options.ids) : undefined;
  const floats = new Map<TaskId, TaskFloat>();

  for (const task of tasks) {
    if (wanted && !wanted.has(task.id)) continue;
    const scheduled = baseline.tasks.get(task.id);
    if (!scheduled) continue;

    /**
     * Solves the plan again with this one task changed.
     *
     * A copy per probe: the plan handed in is input, and a start left mutated
     * behind would poison the probes that follow as well as the caller's model.
     *
     * A probe the simulation refuses counts as a delay that costs something —
     * somebody available only inside a window can be pushed out of it, and the
     * plan then has no capacity for the task at all. Refusing to answer is not
     * an option: this runs inside whatever is applying an edit, and an exception
     * escaping there takes the plan with it. The baseline solved, so anything
     * thrown here is the perturbation's own doing.
     */
    const movesEnd = (patch: Partial<Task>): boolean => {
      const probed = tasks.map((other) => (other.id === task.id ? { ...other, ...patch } : other));
      try {
        return endOfPlan(schedule(probed, resources, probeOptions)) > baselineEnd + TOLERANCE;
      } catch {
        return true;
      }
    };

    const startedAt = scheduled.startWorkingMinutes;
    const startingLater = (steps: number): Partial<Task> => ({
      startConstraint: calendar.fromWorkingMinutes(startedAt + steps * step, 'start'),
    });
    // Started after the plan's own end the task cannot finish inside it, so no
    // simulation can say otherwise and the search has somewhere to stop.
    const reach = Math.floor((baselineEnd - startedAt) / step + TOLERANCE);

    /** Largest delay known to be free, and the smallest known not to be. */
    let free = 0;
    let blocked: number | undefined;
    if (reach >= 1 && !movesEnd(startingLater(1))) {
      free = 1;
      if (search) {
        for (let probe = 2; blocked === undefined; probe *= 2) {
          const candidate = Math.min(probe, reach);
          if (candidate <= free) break;
          if (movesEnd(startingLater(candidate))) blocked = candidate;
          else free = candidate;
        }
        while (blocked !== undefined && blocked - free > 1) {
          const middle = free + Math.floor((blocked - free) / 2);
          if (movesEnd(startingLater(middle))) blocked = middle;
          else free = middle;
        }
      }
    }

    floats.set(task.id, {
      floatMinutes: free * step,
      // A task with nowhere to slide is already critical, so the second probe
      // is only worth running on one that has room. A milestone has no size to
      // grow: its criticality is positional, and growing it would make it work.
      isCritical: free === 0 || (task.effort > 0 && movesEnd({ effort: task.effort + step })),
      contendedResourceId:
        task.resourceId && isContended(scheduled) ? task.resourceId : undefined,
    });
  }

  return floats;
}

/**
 * Which tasks the plan's end depends on, and why.
 *
 * One simulation per critical task and two per task with room, which is what
 * makes marking a whole plan affordable — the float *figure* is what costs a
 * search, and this answer does not need it.
 */
export function criticalTasks(
  tasks: Task[],
  resources: Resource[],
  baseline: Schedule,
  options: FloatOptions = {},
): Map<TaskId, TaskCriticality> {
  const criticality = new Map<TaskId, TaskCriticality>();
  // Rebuilt rather than handed on, so the figure nothing searched for is absent
  // instead of reading as no float at all.
  for (const [id, entry] of measure(tasks, resources, baseline, options, false)) {
    criticality.set(id, {
      isCritical: entry.isCritical,
      contendedResourceId: entry.contendedResourceId,
    });
  }
  return criticality;
}

/**
 * How far each task can slip before the plan's end moves, and whether the end
 * depends on it at all.
 *
 * Costs the probes `criticalTasks` costs plus a doubling search per task with
 * float, bounded by the plan's own span — a dozen simulations for a task with a
 * fortnight of room. Ask for the tasks you are going to show with `ids` rather
 * than for a whole plan.
 */
export function totalFloat(
  tasks: Task[],
  resources: Resource[],
  baseline: Schedule,
  options: FloatOptions = {},
): Map<TaskId, TaskFloat> {
  return measure(tasks, resources, baseline, options, true);
}
