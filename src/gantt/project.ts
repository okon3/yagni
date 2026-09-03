import {
  DEFAULT_CALENDAR,
  WorkingCalendar,
  schedule,
  type CalendarSpec,
  type Resource,
  type Schedule,
  type ScheduledTask,
} from '../scheduler';

/**
 * A task as the user edits it.
 *
 * `nominalDays` is the duration the task would take with the resource fully
 * dedicated; it is the user's estimate and never changes on its own. The end
 * date is always derived, which is why it does not appear here.
 *
 * For a summary task — one with children — `nominalDays`, `start` and
 * `resourceId` are ignored: effort and dates roll up from the leaves.
 */
export interface ProjectTask {
  id: string;
  name: string;
  nominalDays: number;
  start: Date;
  resourceId?: string;
  predecessors?: string[];
  progress?: number;
  color?: string;
  parentId?: string;
}

export interface Project {
  tasks: ProjectTask[];
  resources: Resource[];
  calendar: CalendarSpec;
}

export interface SolvedProject {
  schedule: Schedule;
  calendar: WorkingCalendar;
  /** Ids of tasks that have children, whose figures are derived. */
  summaryIds: Set<string>;
  hierarchy: Hierarchy;
}

export class TaskCycleError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task "${taskId}" is its own ancestor`);
    this.name = 'TaskCycleError';
    this.taskId = taskId;
  }
}

export interface Hierarchy {
  childrenOf(id: string | undefined): ProjectTask[];
  isSummary(id: string): boolean;
  /** The leaves under `id`, or `[id]` when it is itself a leaf. */
  leavesUnder(id: string): string[];
  ancestorsOf(id: string): string[];
  /** The top-level task `id` belongs to, or `id` itself when already top level. */
  rootOf(id: string): string;
}

export function buildHierarchy(tasks: ProjectTask[]): Hierarchy {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string | undefined, ProjectTask[]>();
  for (const task of tasks) {
    // A parentId pointing at a deleted task would hide the row entirely, so it
    // falls back to the root.
    const key = task.parentId && byId.has(task.parentId) ? task.parentId : undefined;
    const siblings = children.get(key);
    if (siblings) siblings.push(task);
    else children.set(key, [task]);
  }

  const ancestorsOf = (id: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>([id]);
    let cursor = byId.get(id)?.parentId;
    while (cursor && byId.has(cursor)) {
      // A parent chain that loops back would spin here forever.
      if (seen.has(cursor)) throw new TaskCycleError(id);
      seen.add(cursor);
      chain.push(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
    return chain;
  };

  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0;

  const leavesUnder = (id: string): string[] => {
    if (!isSummary(id)) return [id];
    return (children.get(id) ?? []).flatMap((child) => leavesUnder(child.id));
  };

  const rootOf = (id: string): string => {
    const chain = ancestorsOf(id);
    return chain.length > 0 ? chain[chain.length - 1] : id;
  };

  return {
    childrenOf: (id) => children.get(id) ?? [],
    isSummary,
    leavesUnder,
    ancestorsOf,
    rootOf,
  };
}

/**
 * Colour is chosen once on the top-level task and inherited all the way down.
 *
 * Whatever a subtask carries in its own `color` is ignored while it has an
 * ancestor, so moving a branch under a different parent recolours it — the tree
 * stays one visual block instead of a patchwork.
 */
/**
 * A task and everything under it.
 *
 * Deleting a summary has to take its subtree with it: descendants left behind
 * would keep consuming capacity as rows the tree can no longer show.
 */
export function subtreeOf(tasks: ProjectTask[], id: string): Set<string> {
  const inside = new Set([id]);
  // The list is in no particular order, so one pass could miss a grandchild
  // declared before its parent; repeat until nothing new is found.
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parentId && inside.has(task.parentId) && !inside.has(task.id)) {
        inside.add(task.id);
        grew = true;
      }
    }
  }
  return inside;
}

export function effectiveColorOf(
  tasks: ProjectTask[],
  hierarchy: Hierarchy,
  id: string,
): string | undefined {
  const root = hierarchy.rootOf(id);
  return tasks.find((task) => task.id === root)?.color || undefined;
}

function projectOrigin(tasks: ProjectTask[]): Date {
  return (
    tasks.reduce<Date | undefined>(
      (earliest, task) => (!earliest || task.start < earliest ? task.start : earliest),
      undefined,
    ) ?? new Date()
  );
}

export function solve(project: Project): SolvedProject {
  const hierarchy = buildHierarchy(project.tasks);
  // Validate every parent chain up front, so a loop surfaces as TaskCycleError
  // instead of as a hang inside the rollup.
  for (const task of project.tasks) hierarchy.ancestorsOf(task.id);

  const byId = new Map(project.tasks.map((task) => [task.id, task]));
  const leaves = project.tasks.filter((task) => !hierarchy.isSummary(task.id));
  const summaryIds = new Set(
    project.tasks.filter((task) => hierarchy.isSummary(task.id)).map((task) => task.id),
  );

  const origin = projectOrigin(project.tasks);
  const calendar = new WorkingCalendar(origin, project.calendar);

  /**
   * Only leaves consume capacity, so a dependency declared on a summary has to
   * be pushed down to them. A predecessor that is itself a summary expands into
   * its leaves: finish-to-start against the latest of those is exactly
   * finish-to-start against the summary, whose end is that same maximum.
   */
  const effectivePredecessors = (leaf: ProjectTask): string[] => {
    const declared = [...(leaf.predecessors ?? [])];
    for (const ancestorId of hierarchy.ancestorsOf(leaf.id)) {
      declared.push(...(byId.get(ancestorId)?.predecessors ?? []));
    }
    const expanded = declared.flatMap((id) =>
      summaryIds.has(id) ? hierarchy.leavesUnder(id) : [id],
    );
    // Expansion can name the leaf itself (a summary depending on something that
    // contains it), which would deadlock the simulation.
    return [...new Set(expanded)].filter((id) => id !== leaf.id && byId.has(id));
  };

  const result = schedule(
    leaves.map((task) => ({
      id: task.id,
      name: task.name,
      effort: calendar.daysToMinutes(task.nominalDays),
      startConstraint: task.start,
      resourceId: task.resourceId,
      predecessors: effectivePredecessors(task),
    })),
    project.resources,
    { origin, calendar: project.calendar },
  );

  rollUp(project, hierarchy, result, calendar);
  return { schedule: result, calendar, summaryIds, hierarchy };
}

/**
 * Fills in the summary rows bottom-up.
 *
 * A summary spans from its earliest descendant to its latest, and its effort is
 * the sum of the leaves below it — so its elapsed time can exceed the sum of its
 * children's when they do not run back to back. It gets no allocation segments:
 * a bar aggregating several people has no single allocation rate to draw.
 */
function rollUp(
  project: Project,
  hierarchy: Hierarchy,
  result: Schedule,
  calendar: WorkingCalendar,
): void {
  const depthOf = (id: string) => hierarchy.ancestorsOf(id).length;
  const summaries = project.tasks
    .filter((task) => hierarchy.isSummary(task.id))
    // Deepest first, so a summary of summaries sees its children already rolled up.
    .sort((a, b) => depthOf(b.id) - depthOf(a.id));

  for (const summary of summaries) {
    const children = hierarchy
      .childrenOf(summary.id)
      .map((child) => result.tasks.get(child.id))
      .filter((child): child is ScheduledTask => child !== undefined);
    if (children.length === 0) continue;

    const startMinutes = Math.min(...children.map((child) => child.startWorkingMinutes));
    const endMinutes = Math.max(...children.map((child) => child.endWorkingMinutes));
    result.tasks.set(summary.id, {
      id: summary.id,
      start: calendar.fromWorkingMinutes(startMinutes, 'start'),
      end: calendar.fromWorkingMinutes(endMinutes, 'end'),
      startWorkingMinutes: startMinutes,
      endWorkingMinutes: endMinutes,
      elapsedWorkingMinutes: endMinutes - startMinutes,
      effortMinutes: children.reduce((total, child) => total + child.effortMinutes, 0),
      segments: [],
    });
  }
}

/** No people: inventing names the user has to delete is worse than starting bare. */
export function emptyProject(): Project {
  return { calendar: DEFAULT_CALENDAR, resources: [], tasks: [] };
}

/** Fixture for the serialization tests, not something the app ever loads. */
export const sampleProject: Project = {
  calendar: DEFAULT_CALENDAR,
  resources: [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'carla', name: 'Carla' },
  ],
  tasks: [
    { id: '1', name: 'Design API', nominalDays: 4, start: at(0), resourceId: 'alice', progress: 0.4 },
    { id: '2', name: 'Fix billing bug', nominalDays: 2, start: at(2), resourceId: 'alice' },
    { id: '3', name: 'Write migration', nominalDays: 3, start: at(3), resourceId: 'alice' },
    { id: '4', name: 'Set up CI', nominalDays: 3, start: at(0), resourceId: 'bob', progress: 1 },
    { id: '5', name: 'Deploy staging', nominalDays: 2, start: at(0), resourceId: 'bob', predecessors: ['4'] },
    { id: '6', name: 'Write docs', nominalDays: 5, start: at(1), resourceId: 'carla' },
    { id: '7', name: 'Rilascio 1.0', nominalDays: 0, start: at(0) },
    { id: '8', name: 'Test end to end', nominalDays: 2, start: at(4), resourceId: 'bob', parentId: '7' },
    { id: '9', name: 'Note di rilascio', nominalDays: 1, start: at(6), resourceId: 'carla', parentId: '7' },
  ],
};

function at(dayOffset: number): Date {
  return new Date(2026, 8, 7 + dayOffset, 8, 0);
}
