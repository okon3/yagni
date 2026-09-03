import {
  CyclicDependencyError,
  DEFAULT_CALENDAR,
  WorkingCalendar,
  criticalTasks,
  schedule,
  totalFloat,
  type CalendarSpec,
  type FloatOptions,
  type Resource,
  type Schedule,
  type ScheduledTask,
  type Task,
  type TaskCriticality,
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
  /** Who works on each task, a summary included. Absent when nobody does. */
  resourcesByTask: Map<string, Set<string>>;
  /**
   * The leaves exactly as the engine received them — dependencies pushed down,
   * effort in minutes.
   *
   * Kept because the critical chain re-solves this same plan a task at a time,
   * and a second translation of the project would be a second set of rules to
   * disagree with `solve`.
   */
  engineTasks: Task[];
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

/**
 * The people working on each task, counting everything below a summary.
 *
 * A summary has no resource of its own — its figures roll up from the leaves —
 * so it answers with whoever works inside it. Highlighting a person then keeps
 * the branches their work sits in readable, instead of leaving a lit leaf under
 * a faded parent.
 */
export function resourcesByTask(
  tasks: ProjectTask[],
  hierarchy: Hierarchy,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const add = (taskId: string, resourceId: string) => {
    const known = owners.get(taskId);
    if (known) known.add(resourceId);
    else owners.set(taskId, new Set([resourceId]));
  };
  for (const task of tasks) {
    // A summary's own resourceId is ignored everywhere else, so it must not
    // claim the row here either.
    if (!task.resourceId || hierarchy.isSummary(task.id)) continue;
    add(task.id, task.resourceId);
    for (const ancestorId of hierarchy.ancestorsOf(task.id)) add(ancestorId, task.resourceId);
  }
  return owners;
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

  const engineTasks = leaves.map<Task>((task) => ({
    id: task.id,
    name: task.name,
    effort: calendar.daysToMinutes(task.nominalDays),
    startConstraint: task.start,
    resourceId: task.resourceId,
    predecessors: effectivePredecessors(task),
  }));

  const result = schedule(engineTasks, project.resources, { origin, calendar: project.calendar });

  rollUp(project, hierarchy, result, calendar);
  return {
    schedule: result,
    calendar,
    summaryIds,
    hierarchy,
    resourcesByTask: resourcesByTask(project.tasks, hierarchy),
    engineTasks,
  };
}

/**
 * Tasks above which the critical chain is no longer measured on every edit.
 *
 * Measuring is a simulation per probe, and the simulation is itself quadratic in
 * the tasks, so the cost climbs faster than the plan does: 7 ms at 20 tasks,
 * 18 ms at 30, 41 ms at 40, 162 ms at 60. Forty keeps the price of an edit
 * inside a couple of frames.
 *
 * It is not a ceiling on the answer, only on what an edit pays for it: past it
 * the measurement is asked for, and a click can afford what a keystroke cannot.
 */
export const CRITICAL_CHAIN_LIMIT = 40;

/**
 * Whether the plan is small enough to measure along with its schedule.
 *
 * Asked by the view too, which has to say whether what it draws keeps itself
 * current or has to be asked for again.
 */
export function isChainMeasurable(solved: SolvedProject): boolean {
  return solved.engineTasks.length <= CRITICAL_CHAIN_LIMIT;
}

export interface TaskSlack {
  /**
   * Working days the task can start later before the plan's end moves.
   *
   * Null when only criticality was measured: the figure costs a search per
   * task, the flag does not.
   */
  floatDays: number | null;
  /** The plan's end moves if this task starts later, or if it grows. */
  isCritical: boolean;
  /** Whose split is the reason, when contention is the reason. */
  contendedResourceId?: string;
}

/** Slack with the figure actually measured, which is what a caller can display. */
export type MeasuredSlack = TaskSlack & { floatDays: number };

/** What the engine answers with: criticality always, the figure only from a search. */
type Measured = TaskCriticality & { floatMinutes?: number };

export interface SlackOptions {
  /** Measure the float figure too, not only criticality. Costs a search per leaf. */
  search?: boolean;
  /** Rows to measure, expanded to the leaves under them. Every row by default. */
  ids?: string[];
}

/**
 * How much room the rows have, measured against the schedule on screen.
 *
 * The engine only knows the leaves, so what it answers is spread back over the
 * rows here. A summary is never scheduled and has no float of its own: what the
 * branch can afford is what its tightest leaf can afford, and it is critical as
 * soon as any leaf below it is. Contention is only named when every critical
 * leaf under a row shares the same person — otherwise the reason would explain
 * one leaf and hide the others.
 *
 * No cost ceiling of its own: the price is a re-solve per probe, and only the
 * caller knows whether it is standing in front of a frame budget. `search` is
 * the expensive half.
 */
export function slackByRow(
  project: Project,
  solved: SolvedProject,
  options: SlackOptions = {},
): Map<string, TaskSlack> {
  const wanted = options.ids ?? project.tasks.map((task) => task.id);
  const measure = options.search ? totalFloat : criticalTasks;
  // The axis `solve` used, or the probes would not be comparable to the
  // schedule they are measured against.
  const floatOptions: FloatOptions = {
    origin: solved.calendar.origin,
    calendar: project.calendar,
    ids: new Set(wanted.flatMap((id) => solved.hierarchy.leavesUnder(id))),
  };
  const measured: Map<string, Measured> = measure(
    solved.engineTasks,
    project.resources,
    solved.schedule,
    floatOptions,
  );

  const rows = new Map<string, TaskSlack>();
  for (const id of wanted) {
    const under = solved.hierarchy
      .leavesUnder(id)
      .map((leaf) => measured.get(leaf))
      .filter((entry): entry is Measured => entry !== undefined);
    if (under.length === 0) continue;

    const critical = under.filter((entry) => entry.isCritical);
    const reasons = new Set(critical.map((entry) => entry.contendedResourceId));
    const floats = under.map((entry) => entry.floatMinutes);
    rows.set(id, {
      floatDays: floats.every((minutes): minutes is number => minutes !== undefined)
        ? solved.calendar.minutesToDays(Math.min(...floats))
        : null,
      isCritical: critical.length > 0,
      // A single reason across the critical leaves, or none: a set of one
      // holding `undefined` is a leaf that contends with nobody.
      contendedResourceId: reasons.size === 1 ? [...reasons][0] : undefined,
    });
  }
  return rows;
}

/** What the chart is drawing, and whether it still describes the plan on screen. */
export interface MarkedChain {
  rows: Map<string, TaskSlack>;
  /** False once an edit has landed that this was not measured against. */
  fresh: boolean;
}

export type ChainState =
  /** Nobody is asking for it, and nothing is drawn. */
  | 'off'
  /** Small enough to be measured with the schedule, so it is never out of date. */
  | 'live'
  /** Too big for that, and nothing measured yet: a click asks for it. */
  | 'asked'
  /** Too big for that, measured on request, and still current. */
  | 'fresh'
  /** Too big for that, and what is drawn predates the last edit. */
  | 'stale';

/**
 * The chain to draw once the plan has changed.
 *
 * Under the limit it is measured again along with the schedule. Over it the
 * measurement is not chained to the edit — but what was measured before is kept
 * and flagged old rather than thrown away: clearing it would leave the chart
 * blank exactly while somebody is working on the plan, whereas a marking that
 * declares itself old, with one click to refresh it, still answers the question
 * it was asked.
 */
export function chainAfterEdit(
  project: Project,
  solved: SolvedProject,
  wanted: boolean,
  previous: MarkedChain | null,
): MarkedChain | null {
  if (!wanted) return null;
  if (isChainMeasurable(solved)) return { rows: slackByRow(project, solved), fresh: true };
  return previous ? { rows: previous.rows, fresh: false } : null;
}

/** Measured now whatever the plan's size, because asking is a click. */
export function chainOnRequest(project: Project, solved: SolvedProject): MarkedChain {
  return { rows: slackByRow(project, solved), fresh: true };
}

/** What the control has to offer, which is not the same as what is drawn. */
export function chainStateOf(
  wanted: boolean,
  solved: SolvedProject,
  chain: MarkedChain | null,
): ChainState {
  if (!wanted) return 'off';
  if (isChainMeasurable(solved)) return 'live';
  if (!chain) return 'asked';
  return chain.fresh ? 'fresh' : 'stale';
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

/**
 * Why `from -> to` cannot be added as a dependency, or null.
 *
 * Asked before mutating, by the script and by a link drawn with the mouse
 * alike. `solve()` would otherwise throw with the cyclic `predecessors` already
 * written into the model, leaving the project holding a schedule it cannot
 * solve.
 *
 * The check is a trial `solve()` rather than `assertAcyclic` on the declared
 * graph, because a cycle can exist only after summary dependencies are pushed
 * down to their leaves: two summaries depending on each other's subtree read as
 * acyclic while declared and deadlock once expanded. Reusing `solve` is also the
 * only way this cannot disagree with what the engine will do next.
 */
export function rejectionForLink(project: Project, from: string, to: string): string | null {
  if (from === to) return `Un'attività non può dipendere da se stessa ("${from}")`;
  const known = new Set(project.tasks.map((task) => task.id));
  if (!known.has(from)) return `Attività "${from}" inesistente`;
  if (!known.has(to)) return `Attività "${to}" inesistente`;

  const prospective: Project = {
    ...project,
    tasks: project.tasks.map((task) =>
      task.id === to
        ? { ...task, predecessors: [...(task.predecessors ?? []), from] }
        : task,
    ),
  };
  try {
    solve(prospective);
  } catch (cause) {
    if (cause instanceof CyclicDependencyError) {
      return `La dipendenza da "${from}" a "${to}" crea un ciclo: ${cause.cycle.join(' → ')}`;
    }
    throw cause;
  }
  return null;
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
