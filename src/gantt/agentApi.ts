import helpMarkdown from './agentApi.help.md?raw';
import { parseWallClock, serializeDate } from './dates';
import type { GanttHandle } from './GanttChart';
import { buildPlan, type Plan } from './plan';
import { loadByResource, rejectionForLink, slackByRow, subtreeOf } from './project';
import {
  nextResourceId,
  releasedBy,
  validateResources,
  withAvailability,
  withResourceAdded,
  withResourceRemoved,
  withResourceUpdated,
  type ResourcePatch,
} from './resources';
import { serializeProject } from './serialization';
import type { TaskDetails } from './TaskDialog';
import type { AvailabilityOverride, CalendarSpec, Resource } from '../scheduler';

/**
 * An adapter over `GanttHandle`, for a script driving the page.
 *
 * It owns no rules of its own: every operation is the one the buttons and
 * dialogs already run. It departs from them in exactly three ways, each because
 * a script cannot do what a person does.
 *
 * 1. **Nothing is confirmed.** A `<dialog>` awaiting a click would hang a script
 *    forever, so where a button asks, this takes an explicit argument.
 * 2. **Errors throw.** The handle returns silently on an unknown id, which is
 *    the one failure a caller cannot detect.
 * 3. **Patches are partial**, filled in from the current state, because a script
 *    knows the one field it wants to change and a dialog always has them all.
 */

/** `TaskDetails` with its dates as text, since a `Date` does not survive JSON. */
export type TaskInfo = Omit<TaskDetails, 'start' | 'end'> & { start: string; end: string };

export interface TaskInput {
  name?: string;
  nominalDays?: number;
  /** `YYYY-MM-DDTHH:mm` in local wall clock, or a `Date`. */
  start?: string | Date;
  /** Null or empty unassigns. */
  resourceId?: string | null;
  /** `#rrggbb`. Only a top-level task owns one; a subtask inherits. */
  color?: string | null;
  /** 0..1. */
  progress?: number;
}

export interface NewTaskInput extends TaskInput {
  parentId?: string | null;
}

declare global {
  interface Window {
    yagni: AgentApi;
  }
}

/** One row of the critical-chain analysis, in the order `getPlan()` uses. */
export interface ChainTask {
  id: string;
  /** The plan's end moves if this task starts later, or if it grows. */
  isCritical: boolean;
  /** Working days it can start later before the plan's end moves. */
  floatDays: number;
  /** Whose split makes it critical, when contention is the reason. */
  contendedOn: string | null;
}

/** A stretch of one person's calendar over which nothing about it changes. */
export interface LoadStretch {
  /** `YYYY-MM-DDTHH:mm`, local wall clock, as everywhere else on this surface. */
  start: string;
  end: string;
  /** Fraction of a full-time person actually booked. Never above `capacity`. */
  committed: number;
  /** Fraction the person had to give, part-time and absences included. */
  capacity: number;
  tasks: { id: string; rate: number }[];
}

/** One person's plan from their own side, in `getResources()` order. */
export interface ResourceLoadInfo {
  resourceId: string;
  /** Working days booked on them, which is the sum of their tasks' efforts. */
  committedDays: number;
  /** Working days they had over the plan that nothing claimed. */
  idleDays: number;
  /** Tiles the plan end to end, so an idle stretch is a stretch at zero. */
  stretches: LoadStretch[];
}

export interface AgentApi {
  help(): string;

  getPlan(): Plan;
  getTask(id: string): TaskInfo;
  getCriticalChain(): ChainTask[];
  getResourceLoad(): ResourceLoadInfo[];
  getResources(): Resource[];
  getCalendar(): CalendarSpec;
  toText(): string;
  getFilename(): string;
  isDirty(): boolean;

  addTask(patch?: NewTaskInput): string;
  updateTask(id: string, patch: TaskInput): void;
  deleteTask(id: string): void;
  setParent(id: string, parentId: string | null): void;
  link(from: string, to: string): void;
  unlink(from: string, to: string): void;

  addResource(patch: ResourcePatch): string;
  updateResource(id: string, patch: ResourcePatch): void;
  removeResource(id: string, options?: { releaseTasks?: boolean }): void;
  setAvailability(id: string, overrides: AvailabilityOverride[]): void;

  setCalendar(spec: CalendarSpec): void;
  newProject(): void;
  loadText(text: string, filename?: string): void;
  setFilename(name: string): void;

  select(id: string): void;
  reveal(id: string): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  collapseAll(): void;
  expandAll(): void;
  showToday(): void;
}

/**
 * The `App` state a write has to keep honest, reached through getters.
 *
 * Getters rather than values because the object is built once: closing over
 * `filename` would go stale on the first rename.
 */
export interface AgentHost {
  handle(): GanttHandle | null;
  filename(): string;
  dirty(): boolean;
  setFilename(name: string): void;
  /** Parses before loading, so a malformed text leaves the open project alone. */
  adopt(text: string, filename: string): void;
  /** The New button without its discard question. */
  newProject(): void;
}

function asDate(value: string | Date, field: string): Date {
  if (value instanceof Date) return value;
  const parsed = parseWallClock(value);
  if (!parsed) {
    throw new Error(
      `${field}: attesa una data "YYYY-MM-DDTHH:mm" in ora locale, ricevuto ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

/** A copy, so a caller poking at the result cannot reach into the model. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

export function createAgentApi(host: AgentHost): AgentApi {
  const chart = (): GanttHandle => {
    const handle = host.handle();
    if (!handle) throw new Error('Il grafico non è ancora montato');
    return handle;
  };

  const details = (id: string): TaskDetails => {
    const found = chart().getTaskDetails(id);
    if (!found) throw new Error(`Attività "${id}" inesistente`);
    return found;
  };

  const resource = (id: string): Resource => {
    const found = chart()
      .getResources()
      .find((entry) => entry.id === id);
    if (!found) throw new Error(`Risorsa "${id}" inesistente`);
    return found;
  };

  /**
   * The one place an incoming resource id is checked, for every write that
   * carries one.
   *
   * An id nobody has would reach `schedule()` as a task assigned to a resource
   * with no capacity, and it throws "Scheduler stalled" from inside the dhtmlx
   * handler applying the change — the exception escapes, React unmounts, and the
   * open plan is gone. So it is refused before anything is written, as a cyclic
   * link is. The dialogs and the grid editor cannot get here: both pick from a
   * fixed list of the project's own people.
   */
  const requireKnownResource = (id: string | null | undefined) => {
    if (id) resource(id);
  };

  /** Every resource write ends here, so the released list is never the caller's to build. */
  const commitResources = (next: Resource[]) => {
    const problem = validateResources(next);
    if (problem) throw new Error(problem);
    const handle = chart();
    handle.setResources(next, releasedBy(handle.getResources(), next));
  };

  return {
    help: () => helpMarkdown,

    getPlan: () => buildPlan(chart().getSolved()),

    getTask: (id) => {
      const { start, end, ...rest } = details(id);
      return { ...rest, start: serializeDate(start), end: serializeDate(end) };
    },

    /**
     * Deliberately not folded into `getPlan()`: that call is read after every
     * write and this one costs a re-solve of the plan per probe. It also ignores
     * the ceiling the chart's own marking respects — a script has no frame to
     * miss, and asking for the figures is the whole point of the call.
     */
    getCriticalChain: () => {
      const handle = chart();
      const solved = handle.getSolved();
      const rows = slackByRow(handle.getProject(), solved, { search: true });
      // Tree order, like getPlan: two snapshots of a plan have to line up.
      return buildPlan(solved).tasks.flatMap((task) => {
        const slack = rows.get(task.id);
        if (!slack) return [];
        return [
          {
            id: task.id,
            isCritical: slack.isCritical,
            floatDays: slack.floatDays ?? 0,
            contendedOn: slack.contendedResourceId ?? null,
          },
        ];
      });
    },

    /**
     * The one reading a script cannot assemble for itself: `getPlan()` leaves
     * out the allocation segments, so there is nothing to aggregate by person.
     * Cheap, unlike the chain — it reads the schedule already solved.
     */
    getResourceLoad: () => {
      const handle = chart();
      const solved = handle.getSolved();
      return loadByResource(handle.getProject(), solved).map((load) => ({
        resourceId: load.resourceId,
        committedDays: solved.calendar.minutesToDays(load.committedMinutes),
        idleDays: solved.calendar.minutesToDays(load.idleMinutes),
        stretches: load.segments.map((segment) => ({
          start: serializeDate(segment.start),
          end: serializeDate(segment.end),
          committed: segment.committed,
          capacity: segment.capacity,
          tasks: segment.shares.map((share) => ({ id: share.taskId, rate: share.rate })),
        })),
      }));
    },

    getResources: () => copy(chart().getResources()),
    getCalendar: () => copy(chart().getCalendar()),
    toText: () => serializeProject(chart().getProject()),
    getFilename: host.filename,
    isDirty: host.dirty,

    addTask: (patch) => {
      requireKnownResource(patch?.resourceId);
      return chart().addTask({
        name: patch?.name,
        nominalDays: patch?.nominalDays,
        start: patch?.start ? asDate(patch.start, 'start') : undefined,
        resourceId: patch?.resourceId ?? undefined,
        color: patch?.color ?? undefined,
        parentId: patch?.parentId ?? undefined,
      });
    },

    updateTask: (id, patch) => {
      const current = details(id);
      // The handle would discard these on a summary, where they are rolled up
      // from the leaves. Refusing is what the inline editor already does; the
      // alternative is a write the caller believes happened.
      if (current.isSummary) {
        const derived = (['nominalDays', 'start', 'resourceId'] as const).filter(
          (field) => patch[field] !== undefined,
        );
        if (derived.length > 0) {
          throw new Error(
            `"${id}" è un'attività di riepilogo: ${derived.join(', ')} si ricava dalle figlie`,
          );
        }
      }
      requireKnownResource(patch.resourceId);
      chart().updateTask(id, {
        name: patch.name ?? current.name,
        nominalDays: patch.nominalDays ?? current.nominalDays,
        start: patch.start ? asDate(patch.start, 'start') : current.start,
        resourceId:
          patch.resourceId === undefined ? current.resourceId || undefined : patch.resourceId || undefined,
        color: patch.color === undefined ? current.color : patch.color || undefined,
        progress: patch.progress ?? current.progress,
      });
    },

    deleteTask: (id) => {
      details(id);
      chart().deleteTask(id);
    },

    setParent: (id, parentId) => {
      details(id);
      if (parentId !== null) {
        details(parentId);
        // Refuse before mutating: a parent taken from inside its own subtree
        // detaches the branch from the tree, and buildHierarchy then throws on
        // every render.
        if (subtreeOf(chart().getProject().tasks, id).has(parentId)) {
          throw new Error(`"${parentId}" sta sotto "${id}": non può diventarne il padre`);
        }
      }
      chart().setParent(id, parentId);
    },

    link: (from, to) => {
      // solve() runs inside the dhtmlx event handler that follows, after the
      // predecessors are already written: a cycle has to be refused here.
      const problem = rejectionForLink(chart().getProject(), from, to);
      if (problem) throw new Error(problem);
      chart().addLink(from, to);
    },

    unlink: (from, to) => {
      details(from);
      details(to);
      chart().removeLink(from, to);
    },

    addResource: (patch) => {
      const current = chart().getResources();
      const id = nextResourceId(current);
      commitResources(withResourceAdded(current, patch));
      return id;
    },

    updateResource: (id, patch) => {
      resource(id);
      commitResources(withResourceUpdated(chart().getResources(), id, patch));
    },

    removeResource: (id, options) => {
      const person = resource(id);
      const assigned = chart().countTasksByResource().get(id) ?? 0;
      // The honest translation of the dialog's warning: not dropped, turned
      // into an argument the caller has to mean.
      if (assigned > 0 && !options?.releaseTasks) {
        throw new Error(
          `${person.name} è assegnata a ${assigned} attività, che resterebbero senza risorsa. ` +
            'Passa { releaseTasks: true } per farlo comunque.',
        );
      }
      commitResources(withResourceRemoved(chart().getResources(), id));
    },

    setAvailability: (id, overrides) => {
      resource(id);
      commitResources(withAvailability(chart().getResources(), id, overrides));
    },

    setCalendar: (spec) => chart().setCalendar(copy(spec)),
    newProject: host.newProject,
    loadText: (text, filename) => host.adopt(text, filename ?? host.filename()),
    setFilename: host.setFilename,

    select: (id) => {
      details(id);
      chart().selectTask(id);
    },
    reveal: (id) => {
      details(id);
      chart().revealTask(id);
    },
    zoomIn: () => chart().zoomIn(),
    zoomOut: () => chart().zoomOut(),
    zoomToFit: () => chart().zoomToFit(),
    collapseAll: () => chart().collapseAll(),
    expandAll: () => chart().expandAll(),
    showToday: () => chart().scrollToToday(),
  };
}
