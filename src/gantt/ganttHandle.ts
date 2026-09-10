import type { CalendarSpec, Resource } from '../scheduler';
import type { MeasuredSlack, Project, SolvedProject } from './project';

/**
 * What a new row may carry. Everything is optional and falls back to the
 * defaults the toolbar's button uses.
 */
export interface NewTask {
  name?: string;
  nominalDays?: number;
  /** Normalised to 08:00, as every other creation path does. */
  start?: Date;
  resourceId?: string;
  color?: string;
  disabled?: boolean;
  parentId?: string;
  /**
   * Placed straight below this row, as its sibling, instead of at the end of a
   * branch. Wins over `parentId`, which it derives: "below this" already says
   * whose child the new row is.
   */
  after?: string;
}

export interface LoadOptions {
  /**
   * Keeps the scroll position and the selected row.
   *
   * What undo restores is the same project seen from the same place. Opening a
   * file is the opposite case: there the viewport belongs to the plan that was
   * on screen a moment ago and means nothing for the one arriving.
   */
  keepViewport?: boolean;
}

export interface GanttHandle {
  getProject(): Project;
  /** The solved schedule behind what is on screen. */
  getSolved(): SolvedProject;
  loadProject(project: Project, options?: LoadOptions): void;
  /** Null when the row has meanwhile been deleted. */
  getTaskDetails(id: string): TaskDetails | null;
  /**
   * How much room the row has, measured on the spot: the figure costs a search
   * that a whole plan cannot afford on every edit. Null when the plan is past
   * the limit for measuring at all.
   */
  getTaskSlack(id: string): MeasuredSlack | null;
  /**
   * Measures the critical chain now and redraws, whatever the plan's size.
   *
   * The path an explicit request takes: past the limit nothing measures on its
   * own, and this is what a click on the control runs. It also turns the marking
   * on, since asking to see it is asking for it to be shown.
   */
  measureCriticalChain(): void;
  updateTask(id: string, patch: TaskPatch): void;
  /** Takes the task's subtree with it, and clears dependencies on any of them. */
  deleteTask(id: string): void;
  getResources(): Resource[];
  /** Tasks assigned to a removed resource are released to "no resource". */
  setResources(resources: Resource[], releasedResourceIds: string[]): void;
  getCalendar(): CalendarSpec;
  setCalendar(calendar: CalendarSpec): void;
  countTasksByResource(): Map<string, number>;
  /** The id of the created row, which the caller needs to say anything else about it. */
  addTask(task?: NewTask): string;
  /** Null re-parents to the top level. */
  setParent(id: string, parentId: string | null): void;
  /** Finish-to-start. Silent on a link that already exists. */
  addLink(from: string, to: string): void;
  removeLink(from: string, to: string): void;
  selectTask(id: string): void;
  /** Opens whatever branches hide the task, then scrolls it into view. */
  revealTask(id: string): void;
  /**
   * Marks the rows whose name matches, and answers with their ids in the order
   * the grid shows them. An empty query marks nothing.
   *
   * The plan is never filtered, so this is a marking and a list to walk rather
   * than a state the view is left in.
   */
  setSearch(query: string): string[];
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  /** Collapses every branch of the grid. View state only: the project is untouched. */
  collapseAll(): void;
  expandAll(): void;
  scrollToToday(): void;
  /**
   * Collapses the task grid to zero width, or restores it to the width it had
   * a moment before — exactly, even across a divider drag in between. View
   * state only, and not persisted: it does not survive a reload.
   */
  toggleGridCollapsed(): void;
}

/** Everything the dialog shows, resolved by the chart: inputs and derived alike. */
export interface TaskDetails {
  id: string;
  name: string;
  nominalDays: number;
  start: Date;
  end: Date;
  resourceId: string;
  color: string;
  /** Only a top-level task owns its colour; a subtask inherits it. */
  ownsColor: boolean;
  progress: number;
  isSummary: boolean;
  /** How many tasks sit under this one; they go with it when it is deleted. */
  descendantCount: number;
  /** Working days the task actually spans, stretching included. */
  elapsedDays: number;
  /** Effort rolled up from the leaves; equals `nominalDays` on a leaf. */
  effortDays: number;
  /** Ran below full rate, for whatever reason: the duration then exceeds the effort. */
  shared: boolean;
  /** Ran below full rate *because* the resource was split with another task. */
  contended: boolean;
  /** The task's own flag — not the effective (inherited) state a group shows. */
  disabled: boolean;
}

export interface TaskPatch {
  name: string;
  nominalDays: number;
  start: Date;
  resourceId: string | undefined;
  color: string | undefined;
  progress: number;
  /**
   * Optional: absent means the caller left it alone. `false` deletes the
   * stored flag rather than writing it — see `GanttChart.updateTask`.
   */
  disabled?: boolean;
}
