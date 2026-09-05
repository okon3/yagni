import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { gantt, type ZoomLevel } from 'dhtmlx-gantt';
import { Info, Ban } from 'lucide-static';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import { barFactsOf, renderBarTooltip } from './barTooltip';
import { formatDays } from './format';
import { escapeHtml } from './html';
import { isShared, renderSegments } from './segmentBar';
import { availabilityOnDay, dateOfDay, dayIndexOf, expandRanges, isContended } from '../scheduler';
import type { CalendarSpec, DayRange, Resource, Schedule, ScheduledTask } from '../scheduler';
import { renderLoadPanel, scrollLoadPanel, type LoadLane } from './loadPanel';
import { DEFAULT_BAR_COLOR, avatarColorOf, initialsOf, resourceClass, shade } from './colors';
import {
  chainAfterEdit,
  chainOnRequest,
  chainStateOf,
  constraintStart,
  effectiveColorOf,
  isChainMeasurable,
  isMilestone,
  loadByResource,
  peopleUnder,
  rejectionForLink,
  reorderTasks,
  slackByRow,
  solve,
  subtreeOf,
  type ChainState,
  type MarkedChain,
  type MeasuredSlack,
  type Project,
  type ProjectTask,
  type SolvedProject,
} from './project';
import { matchesSearch, searchKey } from './search';
import { keystrokeIsCaptured } from './shortcuts';
import type { TaskDetails, TaskPatch } from './TaskDialog';
import './gantt.css';

/** dhtmlx link type for finish-to-start. */
const FINISH_TO_START = '0';

/**
 * The two dhtmlx task types the app writes, through `String` because the
 * typings allow `config.types` to hold numbers. A row of the first kind is drawn
 * as a diamond on its date, a row of the second as a bar.
 */
const MILESTONE_TYPE = String(gantt.config.types.milestone);
const BAR_TYPE = String(gantt.config.types.task);

/**
 * Pixels below which a run of non-working days is left unshaded.
 *
 * A weekend is 7px wide once a column is a month, and a chart striped with
 * hairlines on every column is noise rather than information — while a weekend
 * is ambient regularity nobody zooms out to hunt for. The threshold is on the
 * width rather than on the zoom level, so it follows the calendar: a three-day
 * working week measures 13px at the same scale, where half the chart being
 * unworked is exactly what one wants to see, and comes back on its own.
 *
 * It is compared against one pixels-per-day for the whole timeline, never
 * against a band's own width, or bands of the same length would disagree from
 * one column to the next.
 *
 * Time off has no such floor. A shutdown or an absence is a span the plan turns
 * on, so it must survive any zoom, however few pixels it gets.
 */
const MIN_NONWORKING_BAND = 10;

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});
const shortDate = (value: Date) => (value ? dayMonth.format(new Date(value)) : '');

/** Columns whose value a summary derives from its children. */
const DERIVED_ON_SUMMARY = new Set(['nominal_days', 'resource_id', 'start_date']);

/**
 * Faces a summary's resource cell fits, the "+n" counted as one of them.
 *
 * The cell is 64px inside its padding and a face is 22px overlapping by 8, so
 * four is what the column holds — chosen against the width rather than picked,
 * since a fifth is clipped in silence.
 */
const AVATAR_STACK_LIMIT = 4;

/** A person as an avatar names them: part-time is why a row is as long as it is. */
function personLabel(resource: Resource): string {
  const availability = resource.availability ?? 1;
  return availability < 1 ? `${resource.name} - ${Math.round(availability * 100)}%` : resource.name;
}

/** Class tokens for whoever works on the task, or anywhere below it. */
function resourceClassesOf(solved: SolvedProject, id: string): string {
  const owners = solved.resourcesByTask.get(id);
  return owners ? [...owners].map(resourceClass).join(' ') : '';
}

/**
 * `lucide-static` ships each icon at a fixed 24×24 with no `aria-hidden` —
 * HTML keeps the *first* of a duplicate attribute, so appending a smaller
 * width/height would lose to the original. Rewriting the attributes in place
 * is the documented way around a string, short of pulling in React's
 * server renderer for two icons.
 */
function sizedIcon(svg: string, size: number): string {
  return svg
    .replace(/\swidth="\d+"/, ` width="${size}"`)
    .replace(/\sheight="\d+"/, ` height="${size}"`)
    .replace('<svg', '<svg aria-hidden="true"');
}

const INFO_ICON = sizedIcon(Info, 15);
const BAN_ICON = sizedIcon(Ban, 15);

/**
 * Marks the scale cell holding today, whatever span that cell covers.
 *
 * A cell's own `css` hook only receives where the cell starts, so the span has
 * to come from the scale it is declared on. `gantt.templates.scale_cell_class`
 * would be the obvious place instead — it was dropped in dhtmlx 6 and still
 * compiles to nothing.
 */
const marksToday = (unit: string, step: number, className: string) => (date: Date) => {
  const now = new Date();
  return now >= date && now < gantt.date.add(date, step, unit) ? className : '';
};

/** The finest row of a scale: a filled pill on the exact cell. */
const todayCell = (unit: string, step = 1) => marksToday(unit, step, 'gantt-scale--today');

/**
 * A coarser row above it: coloured text only. A filled pill on a week or a year
 * paints a band across the whole header.
 */
const todaySpan = (unit: string, step = 1) => marksToday(unit, step, 'gantt-scale--today-span');

/**
 * Quarters as a scale unit.
 *
 * dhtmlx builds a custom unit from `<unit>_start` and `add_<unit>`, and ships
 * neither for quarters. Without one the coarsest level draws a column per
 * month, so a project longer than about ten months cannot be fitted into the
 * timeline at all: `zoomToFit` then crops it — from the start, and in silence,
 * because smart rendering does not draw a row whose bar falls outside the
 * range.
 */
function registerQuarterUnit(): void {
  gantt.date.quarter_start = (date: Date) => {
    const start = gantt.date.month_start(new Date(date));
    start.setMonth(Math.floor(start.getMonth() / 3) * 3);
    return start;
  };
  gantt.date.add_quarter = (date: Date, increment: number) =>
    gantt.date.add(date, increment * 3, 'month');
}

const quarterLabel = (date: Date) => `T${Math.floor(date.getMonth() / 3) + 1}`;

const ZOOM_LEVELS: ZoomLevel[] = [
  {
    name: 'day',
    scale_height: 50,
    scales: [{ unit: 'day', step: 1, format: '%d %M', css: todayCell('day') }],
  },
  {
    name: 'week',
    scale_height: 50,
    scales: [
      { unit: 'week', step: 1, format: 'Week %W', css: todaySpan('week') },
      { unit: 'day', step: 1, format: '%d %M', css: todayCell('day') },
    ],
  },
  {
    name: 'month',
    scale_height: 50,
    scales: [
      { unit: 'month', step: 1, format: '%F %Y', css: todaySpan('month') },
      { unit: 'week', step: 1, format: 'Week %W', css: todayCell('week') },
    ],
  },
  {
    name: 'quarter',
    scale_height: 50,
    scales: [
      { unit: 'quarter', step: 1, format: quarterLabel, css: todaySpan('quarter') },
      { unit: 'month', step: 1, format: '%M', css: todayCell('month') },
    ],
  },
  {
    name: 'year',
    scale_height: 50,
    scales: [
      { unit: 'year', step: 1, format: '%Y', css: todaySpan('year') },
      { unit: 'quarter', step: 1, format: quarterLabel, css: todayCell('quarter') },
    ],
  },
];

/** What the status bar calls each zoom level: the band above its columns. */
const SCALE_LABELS: Record<string, string> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
  year: 'Years',
};

export const INITIAL_SCALE_LABEL = SCALE_LABELS.week;

/** How long one ctrl+wheel gesture holds the scale still after a step. */
const WHEEL_ZOOM_COOLDOWN = 200;

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
}

function typeOf(task: ProjectTask, solved: SolvedProject): string {
  return isMilestone(task, solved.summaryIds) ? MILESTONE_TYPE : BAR_TYPE;
}

function toGanttData(project: Project, solved: SolvedProject, chain: MarkedChain | null) {
  const formatDate = gantt.date.date_to_str(gantt.config.date_format);
  return {
    data: project.tasks.map((task) => {
      const scheduled = solved.schedule.tasks.get(task.id);
      const summary = solved.summaryIds.has(task.id);
      const inherited = effectiveColorOf(project.tasks, solved.hierarchy, task.id);
      return {
        id: task.id,
        text: task.name,
        // dhtmlx uses 0 for the root of the tree.
        parent: task.parentId ?? 0,
        open: true,
        type: typeOf(task, solved),
        start_date: formatDate(scheduled?.start ?? task.start),
        end_date: formatDate(scheduled?.end ?? task.start),
        // The end the grid prints. A field of ours rather than the `end_date`
        // beside it, which dhtmlx owns and rewrites — on a milestone it pins it
        // to the start to place the diamond, and the column would then be
        // showing the library's geometry instead of the schedule's answer.
        end_shown: scheduled?.end ?? task.start,
        elapsed_days: scheduled
          ? solved.calendar.minutesToDays(scheduled.elapsedWorkingMinutes)
          : 0,
        progress: task.progress ?? 0,
        resource_id: task.resourceId ?? '',
        nominal_days: task.nominalDays,
        rolled_effort_days: scheduled
          ? solved.calendar.minutesToDays(scheduled.effortMinutes)
          : task.nominalDays,
        is_summary: summary,
        // The colour actually shown, inherited from the top-level ancestor.
        bar_color: inherited ?? '',
        // dhtmlx paints `color` straight onto the bar background, which must stay
        // pale on a shared task: there the colour belongs to the profile inside.
        color: barBackground(inherited, scheduled, summary),
        shared: scheduled ? isShared(scheduled) : false,
        // Effective state, from the solved project — a leaf's own flag or an
        // inherited one, and a summary once every leaf under it is.
        disabled: solved.disabledIds.has(task.id),
        critical: chain?.rows.get(task.id)?.isCritical ?? false,
        critical_stale: chain !== null && !chain.fresh,
        // Rendered on every row whether or not anyone is highlighted: the
        // highlight is then one stylesheet rule away, with no redraw.
        resource_classes: resourceClassesOf(solved, task.id),
      };
    }),
    links: project.tasks.flatMap((task) =>
      (task.predecessors ?? []).map((predecessorId) => ({
        id: `${predecessorId}->${task.id}`,
        source: predecessorId,
        target: task.id,
        type: FINISH_TO_START,
      })),
    ),
  };
}

/**
 * The background dhtmlx should paint, or empty to leave it to the stylesheet.
 *
 * A shared bar stays pale because its colour lives in the profile inside it, and
 * a summary takes a darkened shade so the macro task carries its own colour
 * without looking like one of the leaves below it.
 */
function barBackground(
  color: string | undefined,
  scheduled: ScheduledTask | undefined,
  summary: boolean,
): string {
  if (!color) return '';
  if (summary) return shade(color, 0.55);
  return scheduled && isShared(scheduled) ? '' : color;
}

/**
 * Options for the resource cell.
 *
 * The leading blank lets a task go back to having nobody assigned; without it an
 * assignment could never be undone.
 */
function resourceSelectOptions(resources: Resource[]) {
  return [
    { key: '', label: '—' },
    ...resources.map((resource) => ({ key: resource.id, label: resource.name })),
  ];
}

/**
 * Re-arms the resource cell's editor with the people the project now has.
 *
 * The select captured its options when the columns were configured, so anyone
 * who arrives later — through the dialog, a script, or an undo that brings them
 * back — is missing from the grid's dropdown until this runs.
 */
function refreshResourceOptions(resources: Resource[]): void {
  const column = gantt.config.columns?.find((entry) => entry.name === 'resource_id');
  if (column?.editor) column.editor.options = resourceSelectOptions(resources);
}

/**
 * Widens the timeline until it holds the whole plan, and does nothing when it
 * already does.
 *
 * dhtmlx computes the range at render time only, and `zoomToFit` pins it in
 * `config.start_date` / `config.end_date`, where it outranks the data from then
 * on. A plan that grows past the range is then not drawn at all — smart
 * rendering skips a row whose bar falls outside it — which showed as an empty
 * chart twice over: after the first task added to a fresh project, whose range
 * is three days around today, and after opening a file while the range was
 * pinned by Fit. `refreshData` redraws the bars but never the scales, hence
 * the render, and only when the plan no longer fits: `render()` is the whole
 * chart, on every edit.
 */
function fitRangeToPlan(schedule: Schedule): void {
  // An empty project has nothing to fit, and its start still resolves to a date.
  if (schedule.tasks.size === 0) return;
  const { min_date: from, max_date: to } = gantt.getState();
  const covered =
    from instanceof Date &&
    to instanceof Date &&
    schedule.projectStart >= from &&
    schedule.projectEnd <= to;
  if (covered) return;
  gantt.config.start_date = undefined;
  gantt.config.end_date = undefined;
  gantt.render();
}

/**
 * Which branches the user has closed, so that reloading the project does not
 * open them all again — `toGanttData` renders every row open.
 */
function collapsedBranches(): Set<string> {
  const closed = new Set<string>();
  gantt.eachTask((task) => {
    if (!task.$open) closed.add(String(task.id));
  });
  return closed;
}

/**
 * Opens or closes every branch in one go.
 *
 * The whole tree is rewritten before a single redraw: `gantt.open` and
 * `gantt.close` each redraw on their own, which on a deep plan is one render
 * per row. `render` rather than `refreshData` because the row count changes —
 * it is what dhtmlx itself runs when a single branch opens.
 *
 * Nothing here touches the project. An open branch is a property of the view,
 * so this must not mark the file dirty.
 */
function setEveryBranchOpen(open: boolean): void {
  gantt.eachTask((task) => {
    task.$open = open;
  });
  gantt.render();
}

/**
 * The days that `matches` accepts, as merged inclusive runs of day indices —
 * one band to draw per run rather than one per day.
 */
function runsOf(days: number[], matches: (day: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  for (const day of days) {
    if (!matches(day)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === day - 1) last[1] = day;
    else runs.push([day, day]);
  }
  return runs;
}

/** Ascending day indices of `ranges`, which may overlap and need not be sorted. */
function daysOf(ranges: DayRange[] | undefined): number[] {
  return [...expandRanges(ranges)].sort((a, b) => a - b);
}

const daysBetween = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(to - from + 1, 0) }, (_, offset) => from + offset);

/**
 * Puts the chain onto the rows dhtmlx will redraw, leaving the redraw to the
 * caller — an edit already has one coming, a measurement asked for does not.
 */
function writeChainOntoRows(project: Project, chain: MarkedChain | null): void {
  for (const task of project.tasks) {
    if (!gantt.isTaskExists(task.id)) continue;
    const ganttTask = gantt.getTask(task.id);
    ganttTask.critical = chain?.rows.get(task.id)?.isCritical ?? false;
    // Plan-wide, but carried per row: a class of ours can only come from a
    // template, and the template is only given the task.
    ganttTask.critical_stale = chain !== null && !chain.fresh;
  }
}

/** One lane per person, whether or not anything is booked on them. */
function loadLanes(project: Project, solved: SolvedProject): LoadLane[] {
  const byId = new Map(project.resources.map((resource) => [resource.id, resource]));
  return loadByResource(project, solved).flatMap((load) => {
    const resource = byId.get(load.resourceId);
    if (!resource) return [];
    return [
      {
        resource,
        load,
        committedDays: solved.calendar.minutesToDays(load.committedMinutes),
        idleDays: solved.calendar.minutesToDays(load.idleMinutes),
      },
    ];
  });
}

function nextTaskId(project: Project): string {
  const highest = project.tasks.reduce((max, task) => {
    const numeric = Number(task.id);
    return Number.isFinite(numeric) && numeric > max ? numeric : max;
  }, 0);
  return String(highest + 1);
}

export function GanttChart({
  project,
  highlighted,
  markCritical = true,
  showLoad = false,
  onChange,
  onOpenTask,
  onRowMenu,
  onToggleDisabled,
  onDeleteTask,
  onScaleChange,
  onChainState,
  onReject,
  suppressTooltip = false,
  ref,
}: {
  project: Project;
  /** Whose work stays at full opacity while the rest of the plan fades. */
  highlighted?: string | null;
  /** Outlines the tasks the plan's end depends on. Costs a measurement per edit. */
  markCritical?: boolean;
  /** Opens the per-person load lanes under the chart, on its own time axis. */
  showLoad?: boolean;
  onChange?: () => void;
  onOpenTask?: (id: string) => void;
  /** A right-click on a row, for the caller to answer with a menu of its own. */
  onRowMenu?: (target: {
    taskId: string;
    name: string;
    x: number;
    y: number;
    isSummary: boolean;
    /** The day the pointer was over, when it was over the timeline. */
    start?: Date;
    /** The task's own flag, not the effective (inherited) state. */
    disabled: boolean;
  }) => void;
  /** The grid's per-row power button — same action as the menu's Enable/Disable. */
  onToggleDisabled?: (taskId: string, ownDisabled: boolean) => void;
  /** Asked, not done: the confirmation belongs with the rest of the dialogs. */
  onDeleteTask?: (id: string) => void;
  onScaleChange?: (label: string) => void;
  /** Whether the marking is live, has to be asked for, or is showing an old answer. */
  onChainState?: (state: ChainState) => void;
  /** Why an edit made in the chart was refused, for the caller to surface. */
  onReject?: (message: string) => void;
  /** Quiets the bar tooltip while a caller's popup sits over the chart. */
  suppressTooltip?: boolean;
  ref?: Ref<GanttHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const loadHost = useRef<HTMLDivElement>(null);
  // Held in a ref because the dhtmlx handlers are registered once, in an effect
  // that must not re-run when a callback identity changes.
  const openTaskRef = useRef(onOpenTask);
  const rowMenuRef = useRef(onRowMenu);
  const toggleDisabledRef = useRef(onToggleDisabled);
  const deleteTaskRef = useRef(onDeleteTask);
  const scaleChangeRef = useRef(onScaleChange);
  const changeRef = useRef(onChange);
  const rejectRef = useRef(onReject);
  const projectRef = useRef(project);
  const solvedRef = useRef<SolvedProject>(solve(project));
  const applyingRef = useRef(false);
  // Also what the marking effect below compares against, so mounting does not
  // re-apply what the first parse already drew.
  const markCriticalRef = useRef(markCritical);
  // The chain outlives an edit: over the limit it is not re-measured, and what
  // was measured before stays on the rows marked as old.
  const chainRef = useRef<MarkedChain | null>(null);
  const chainStateRef = useRef(onChainState);
  const showLoadRef = useRef(showLoad);
  // The lanes are aggregated from the schedule, so they are recomputed once per
  // solve and not once per redraw — a zoom or a scroll only moves the geometry.
  const lanesRef = useRef<{ solved: SolvedProject; lanes: LoadLane[] } | null>(null);
  // Owned by the effect that builds the panel, called by the toggle below it.
  const repaintLoadRef = useRef<() => void>(() => {});
  // What the row templates test a name against. A ref rather than a field on
  // each row: dhtmlx rebuilds the rows on every redraw and a class of ours has
  // to come from a template, and a template asking one question of one value
  // cannot fall out of step with the query the way a copy per row would.
  const searchKeyRef = useRef('');
  const suppressTooltipRef = useRef(suppressTooltip);

  useEffect(() => {
    suppressTooltipRef.current = suppressTooltip;
    // Hovering preceded the popup, so a tooltip may already be up.
    if (suppressTooltip) gantt.ext.tooltips.tooltip.hide();
  }, [suppressTooltip]);

  useEffect(() => {
    openTaskRef.current = onOpenTask;
    rowMenuRef.current = onRowMenu;
    toggleDisabledRef.current = onToggleDisabled;
    deleteTaskRef.current = onDeleteTask;
    scaleChangeRef.current = onScaleChange;
    changeRef.current = onChange;
    rejectRef.current = onReject;
    chainStateRef.current = onChainState;
  }, [
    onChainState,
    onChange,
    onDeleteTask,
    onOpenTask,
    onReject,
    onRowMenu,
    onScaleChange,
    onToggleDisabled,
  ]);

  /** Says which of the three the control has to offer, after every write to the chain. */
  const reportChainState = useCallback(() => {
    chainStateRef.current?.(
      chainStateOf(markCriticalRef.current, solvedRef.current, chainRef.current),
    );
  }, []);

  const applySolution = useCallback(
    (notify = true) => {
      applyingRef.current = true;
      const solved = solve(projectRef.current);
      solvedRef.current = solved;
      // Measured after the schedule and from it, so the two can never disagree
      // about the plan they describe — or, over the limit, kept and called old.
      chainRef.current = chainAfterEdit(
        projectRef.current,
        solved,
        markCriticalRef.current,
        chainRef.current,
      );
      for (const task of projectRef.current.tasks) {
        const scheduled = solved.schedule.tasks.get(task.id);
        if (!scheduled || !gantt.isTaskExists(task.id)) continue;
        const ganttTask = gantt.getTask(task.id);
        ganttTask.type = typeOf(task, solved);
        ganttTask.start_date = scheduled.start;
        ganttTask.end_date = scheduled.end;
        ganttTask.end_shown = scheduled.end;
        ganttTask.elapsed_days = solved.calendar.minutesToDays(scheduled.elapsedWorkingMinutes);
        ganttTask.nominal_days = task.nominalDays;
        ganttTask.rolled_effort_days = solved.calendar.minutesToDays(scheduled.effortMinutes);
        const summary = solved.summaryIds.has(task.id);
        const inherited = effectiveColorOf(projectRef.current.tasks, solved.hierarchy, task.id);
        ganttTask.is_summary = summary;
        ganttTask.bar_color = inherited ?? '';
        ganttTask.color = barBackground(inherited, scheduled, summary);
        ganttTask.shared = isShared(scheduled);
        ganttTask.disabled = solved.disabledIds.has(task.id);
        ganttTask.resource_classes = resourceClassesOf(solved, task.id);
      }
      writeChainOntoRows(projectRef.current, chainRef.current);
      // refreshData redraws from the mutated task objects without firing the
      // update events that would bounce straight back into this function.
      gantt.refreshData();
      fitRangeToPlan(solved.schedule);
      applyingRef.current = false;
      reportChainState();
      if (notify) changeRef.current?.();
    },
    // Nothing that changes identity per render. This function is a dependency of
    // the effect that calls gantt.init(), so an identity that changed with every
    // render of the parent would tear the chart down and rebuild it on every
    // keystroke — and gantt.ext.zoom.init() would reset the zoom level while
    // doing so. `reportChainState` has no dependencies of its own either.
    [reportChainState],
  );

  const loadProject = useCallback(
    (next: Project, options?: LoadOptions) => {
      // clearAll drops the selection and sends the timeline back to where the
      // plan starts, which for an undo would mean losing the row and the week
      // the user was looking at. The zoom level survives on its own: it lives
      // in the extension rather than in the data.
      const scroll = options?.keepViewport ? gantt.getScrollState() : undefined;
      const selected = options?.keepViewport ? gantt.getSelectedId() : undefined;
      const collapsed = options?.keepViewport ? collapsedBranches() : undefined;
      applyingRef.current = true;
      projectRef.current = next;
      solvedRef.current = solve(next);
      // An undo keeps the marking it had — over the limit as a stale one — since
      // it is the same plan a step back, and dropping it would leave a big plan
      // with nothing marked after every Ctrl+Z. A file, a draft or a new project
      // is a different plan, and a marking measured against the one that was
      // open says nothing about it.
      chainRef.current = chainAfterEdit(
        next,
        solvedRef.current,
        markCriticalRef.current,
        options?.keepViewport ? chainRef.current : null,
      );
      gantt.clearAll();
      const data = toGanttData(next, solvedRef.current, chainRef.current);
      // Written into the data rather than onto the tasks afterwards, which would
      // need a second render of the whole chart to show.
      for (const task of data.data) {
        if (collapsed?.has(String(task.id))) task.open = false;
      }
      gantt.parse(data);
      refreshResourceOptions(next.resources);
      fitRangeToPlan(solvedRef.current.schedule);
      applyingRef.current = false;
      // After the render, or fitRangeToPlan would scroll back over it.
      if (scroll) gantt.scrollTo(scroll.x, scroll.y);
      // The row may be one of those the undone change had created.
      if (selected && gantt.isTaskExists(selected)) gantt.selectTask(selected);
      reportChainState();
    },
    [reportChainState],
  );

  useImperativeHandle(
    ref,
    () => ({
      getProject: () => projectRef.current,
      getSolved: () => solvedRef.current,
      loadProject,
      getTaskDetails: (id) => {
        const task = projectRef.current.tasks.find((candidate) => candidate.id === id);
        const scheduled = solvedRef.current.schedule.tasks.get(id);
        if (!task || !scheduled) return null;
        const solved = solvedRef.current;
        const summary = solved.summaryIds.has(id);
        return {
          id,
          name: task.name,
          nominalDays: task.nominalDays,
          start: scheduled.start,
          end: scheduled.end,
          // The model may still hold the resource a summary had while it was a
          // leaf. The engine ignores it and every write here discards it, so
          // reading it out would report an assignment nobody is working —
          // buildPlan already answers null for the same reason.
          resourceId: summary ? '' : task.resourceId ?? '',
          color:
            effectiveColorOf(projectRef.current.tasks, solved.hierarchy, id) ?? DEFAULT_BAR_COLOR,
          ownsColor: task.parentId === undefined,
          progress: task.progress ?? 0,
          isSummary: summary,
          descendantCount: subtreeOf(projectRef.current.tasks, id).size - 1,
          elapsedDays: solved.calendar.minutesToDays(scheduled.elapsedWorkingMinutes),
          effortDays: solved.calendar.minutesToDays(scheduled.effortMinutes),
          shared: isShared(scheduled),
          contended: isContended(scheduled),
          disabled: task.disabled === true,
        };
      },
      getTaskSlack: (id) => {
        const solved = solvedRef.current;
        if (!isChainMeasurable(solved)) return null;
        const slack = slackByRow(projectRef.current, solved, { search: true, ids: [id] }).get(id);
        // The figure was asked for, so its absence means the row is gone rather
        // than unmeasured — and either way there is nothing to show.
        if (!slack || slack.floatDays === null) return null;
        return { ...slack, floatDays: slack.floatDays };
      },
      measureCriticalChain: () => {
        applyingRef.current = true;
        chainRef.current = chainOnRequest(projectRef.current, solvedRef.current);
        // The ref is what the rows were drawn from, so putting the marking on
        // here is also what keeps the toggle effect from firing a second time
        // and calling this very measurement old.
        markCriticalRef.current = true;
        writeChainOntoRows(projectRef.current, chainRef.current);
        gantt.refreshData();
        applyingRef.current = false;
        reportChainState();
      },
      deleteTask: (id) => {
        // gantt.deleteTask fires onAfterTaskDelete, where the model, the
        // dependencies and the schedule are already dealt with.
        if (gantt.isTaskExists(id)) gantt.deleteTask(id);
      },
      updateTask: (id, patch) => {
        const task = projectRef.current.tasks.find((candidate) => candidate.id === id);
        if (!task || !gantt.isTaskExists(id)) return;
        task.name = patch.name;
        // No progress and no progress are the same thing, and the dialog opens
        // on the colour the bar is painted — which for a task that has none is
        // the app's default. Both come back on every save, so writing them
        // through would turn what the view had to invent to show the task into
        // something the task declares: a plan whose bars all became explicitly
        // default-coloured, and an edit that changed nothing reporting itself
        // as unsaved work. It is the bargain `constraintStart` makes for the
        // start, for the two other fields the dialog cannot show as empty.
        task.progress = patch.progress || undefined;
        // Same rules the grid enforces: a summary derives its effort, start and
        // resource from the leaves, and a subtask inherits its parent's colour.
        if (task.parentId === undefined) {
          task.color = patch.color === DEFAULT_BAR_COLOR ? undefined : patch.color;
        }
        if (!solvedRef.current.summaryIds.has(id)) {
          task.nominalDays = patch.nominalDays;
          // The dialog's date field opens on the solved start and a script fills
          // an omitted one from it, so most saves hand back a date nobody chose.
          task.start = constraintStart(task, patch.start, solvedRef.current);
          task.resourceId = patch.resourceId;
        }
        // Not derived from the leaves — a summary can be disabled on its own,
        // same as a leaf. Undefined means the caller left it alone; only `true`
        // and `false` write, and `false` deletes the key rather than storing it,
        // since absence is the only spelling of "enabled" the file format knows.
        if (patch.disabled !== undefined) {
          if (patch.disabled) task.disabled = true;
          else delete task.disabled;
        }
        applyingRef.current = true;
        const ganttTask = gantt.getTask(id);
        ganttTask.text = task.name;
        ganttTask.progress = task.progress ?? 0;
        ganttTask.resource_id = task.resourceId ?? '';
        applyingRef.current = false;
        applySolution();
      },
      getResources: () => projectRef.current.resources,
      setResources: (resources, releasedResourceIds) => {
        projectRef.current.resources = resources;
        const released = new Set(releasedResourceIds);
        for (const task of projectRef.current.tasks) {
          if (task.resourceId && released.has(task.resourceId)) task.resourceId = undefined;
        }
        refreshResourceOptions(resources);
        applySolution();
      },
      getCalendar: () => projectRef.current.calendar,
      setCalendar: (calendar) => {
        projectRef.current.calendar = calendar;
        // Shutdowns leave the time axis, so every date shifts: the timeline
        // scales have to be redrawn, not just the task data.
        applySolution();
        gantt.render();
      },
      countTasksByResource: () => {
        const counts = new Map<string, number>();
        for (const task of projectRef.current.tasks) {
          if (!task.resourceId) continue;
          counts.set(task.resourceId, (counts.get(task.resourceId) ?? 0) + 1);
        }
        // Resources with no tasks must still appear, or the dialog cannot show a zero.
        for (const resource of projectRef.current.resources) {
          if (!counts.has(resource.id)) counts.set(resource.id, 0);
        }
        return counts;
      },
      addTask: (task) => {
        const start = task?.start ? new Date(task.start) : new Date();
        const effort = task?.nominalDays ?? 1;
        // Below a named row: the parent is that row's, and the index is one past
        // it. dhtmlx counts the index within the branch, which is exactly the
        // arrangement `pullOrderFromView` then writes into the model.
        const sibling =
          task?.after && gantt.isTaskExists(task.after) ? gantt.getTask(task.after) : undefined;
        const parent = sibling ? (sibling.parent ?? 0) : (task?.parentId ?? 0);
        const index = sibling ? gantt.getTaskIndex(task!.after!) + 1 : undefined;
        // A parent that was a leaf until now renders collapsed, which would hide
        // the row that was just created.
        if (parent && gantt.isTaskExists(parent)) {
          gantt.getTask(parent).$open = true;
        }
        // No applying flag and no write to the model here: onAfterTaskAdd is the
        // single path that turns a dhtmlx row into a project task, and it
        // already honours whatever data the row carries. Adding a second path
        // is how the grid's "+" button once produced rows with a NaN duration.
        const id = String(
          gantt.addTask(
            {
              id: nextTaskId(projectRef.current),
              text: task?.name ?? 'New task',
              start_date: gantt.date.date_to_str(gantt.config.date_format)(start),
              parent,
              duration: 1,
              progress: 0,
              resource_id: task?.resourceId ?? '',
              nominal_days: effort,
              rolled_effort_days: effort,
              elapsed_days: effort,
              is_summary: false,
              bar_color: task?.color ?? '',
              shared: false,
              disabled: task?.disabled ?? false,
            },
            parent,
            index,
          ),
        );
        gantt.showTask(id);
        return id;
      },
      setParent: (id, parentId) => {
        // -1 appends at the end of the new parent's children, the convention
        // dhtmlx's own shift+right indent uses.
        const target = parentId ?? gantt.config.root_id;
        if (parentId && gantt.isTaskExists(parentId)) gantt.getTask(parentId).$open = true;
        // onAfterTaskMove writes task.parentId and re-solves, so nothing else
        // may touch the model here.
        gantt.moveTask(id, -1, target);
      },
      addLink: (from, to) => {
        const exists = gantt
          .getLinks()
          .some((link) => String(link.source) === from && String(link.target) === to);
        if (exists) return;
        gantt.addLink({ source: from, target: to, type: gantt.config.links.finish_to_start });
      },
      removeLink: (from, to) => {
        const link = gantt
          .getLinks()
          .find((entry) => String(entry.source) === from && String(entry.target) === to);
        if (link) gantt.deleteLink(link.id);
      },
      selectTask: (id) => gantt.selectTask(id),
      revealTask: (id) => {
        if (!gantt.isTaskExists(id)) return;
        // A row inside a closed branch has no position on the chart, so
        // showTask would scroll to wherever the closed parent sits. Opening a
        // branch is a property of the view and marks nothing dirty.
        let opened = false;
        for (const ancestorId of solvedRef.current.hierarchy.ancestorsOf(id)) {
          if (!gantt.isTaskExists(ancestorId)) continue;
          const ancestor = gantt.getTask(ancestorId);
          if (ancestor.$open) continue;
          ancestor.$open = true;
          opened = true;
        }
        // The number of rows changed, which refreshData does not lay out again.
        if (opened) gantt.render();
        gantt.showTask(id);
      },
      setSearch: (query) => {
        const key = searchKey(query);
        // Only a change of query needs a redraw of its own. After an edit this
        // is asked again with the same query, against a plan whose rows
        // `applySolution` has already redrawn.
        if (key !== searchKeyRef.current) {
          searchKeyRef.current = key;
          gantt.refreshData();
        }
        if (key === '') return [];
        const found: string[] = [];
        // eachTask walks the whole tree in the order the grid lays it out,
        // closed branches included — a match one cannot see yet is still a
        // match, and revealing it is what opens the branch.
        gantt.eachTask((task) => {
          if (matchesSearch(String(task.text ?? ''), key)) found.push(String(task.id));
        });
        return found;
      },
      zoomIn: () => gantt.ext.zoom.zoomIn(),
      zoomOut: () => gantt.ext.zoom.zoomOut(),
      zoomToFit: () => gantt.ext.zoom.zoomToFit(),
      collapseAll: () => setEveryBranchOpen(false),
      expandAll: () => setEveryBranchOpen(true),
      scrollToToday: () => gantt.showDate(new Date()),
    }),
    [applySolution, loadProject, reportChainState],
  );

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    const resourceOptions = () => resourceSelectOptions(projectRef.current.resources);
    // An avatar rather than a name: the column shrinks to a third of its width
    // and the full name moves into the tooltip. Partial staffing keeps its
    // number on the face of the grid, because it changes every duration there.
    const resourceAvatar = (id: string | undefined) => {
      const resource = projectRef.current.resources.find((entry) => entry.id === id);
      if (!resource) {
        return '<span class="gantt-avatar gantt-avatar--empty" title="No resource">&ndash;</span>';
      }
      const availability = resource.availability ?? 1;
      const percentage = Math.round(availability * 100);
      const title = personLabel(resource);
      return (
        `<span class="gantt-avatar" style="background:${avatarColorOf(resource.name)}"` +
        // Whoever the pointer is on drives the highlight, and App reads it off
        // this attribute — the same one the toolbar's avatars carry.
        ` data-resource-id="${escapeHtml(resource.id)}"` +
        ` title="${escapeHtml(title)}">${escapeHtml(initialsOf(resource.name))}</span>` +
        (availability < 1 ? `<span class="gantt-avatar__pct">${percentage}%</span>` : '')
      );
    };

    /**
     * Everyone working under a summary, as overlapping faces.
     *
     * The row used to say "—", which is true of the summary's own field and
     * useless about the branch: who a group of work belongs to is most of what
     * a collapsed tree is read for.
     *
     * None of these carries `data-resource-id`, so none of them highlights.
     * That is the price of the overlap: a face covered down to a sliver is not
     * something a pointer can claim to have chosen, and the people past the
     * limit have no face at all. A branch staffed by one person still renders
     * as the ordinary avatar and still highlights — there the pointer is
     * unambiguous.
     *
     * Who they all are is a native `title`, as it is on every other avatar in
     * the grid: the app's own tooltip is deliberately detached from the rows and
     * left on the bars, and bringing it back here for one cell would be a second
     * tooltip in the same column as the leaves' titles. It carries the whole
     * list, the people the "+n" stands for included.
     */
    const resourceStack = (taskId: string) => {
      const people = peopleUnder(solvedRef.current, projectRef.current.resources, taskId);
      if (people.length === 0) return '<span class="gantt-derived">—</span>';
      if (people.length === 1) return resourceAvatar(people[0].id);
      const title = people.map(personLabel).join('\n');
      // A face and the "+n" that replaces the rest cost the same width, so the
      // stack is n faces or n-1 faces and a count — never both a count and a
      // gap where one more face would have fitted.
      const shown =
        people.length > AVATAR_STACK_LIMIT ? people.slice(0, AVATAR_STACK_LIMIT - 1) : people;
      const hidden = people.length - shown.length;
      const faces = shown.map(
        (person) =>
          `<span class="gantt-avatar" style="background:${avatarColorOf(person.name)}">` +
          `${escapeHtml(initialsOf(person.name))}</span>`,
      );
      if (hidden > 0) {
        faces.push(`<span class="gantt-avatar gantt-avatar--more">+${hidden}</span>`);
      }
      return (
        `<span class="gantt-avatar-stack" title="${escapeHtml(title)}">${faces.join('')}</span>`
      );
    };

    // Also localises month and weekday names in the timeline scales, and the
    // default name dhtmlx gives to rows created from the grid.
    gantt.i18n.setLocale('en');
    gantt.config.date_format = '%Y-%m-%d %H:%i';
    // dhtmlx rounds a drop to the cell of the finest scale on screen, and on a
    // plan long enough to need the month or quarter view that cell is a month:
    // a nudge of a few pixels on 23 September lands the task on 1 October, with
    // nothing on screen to say so. The exact instant under the pointer is the
    // honest input, and `constraintStart` snaps it to the working day it fell
    // on — a scale the plan can always show.
    gantt.config.round_dnd_dates = false;
    // The end date is computed, never typed or dragged, so the right bar handle
    // would offer an edit the engine immediately overwrites.
    gantt.config.drag_resize = false;
    gantt.config.drag_progress = true;
    gantt.config.drag_links = true;
    gantt.config.details_on_dblclick = false;
    // The lightbox cannot edit effort or resource, so creating through it would
    // only add a row the user then has to fix in the grid anyway.
    gantt.config.details_on_create = false;
    // Lets rows be dragged to re-parent and reorder, which is how the hierarchy
    // is built.
    gantt.config.order_branch = true;
    gantt.config.order_branch_free = true;
    gantt.config.row_height = 36;
    gantt.config.bar_height = 24;
    gantt.config.columns = [
      {
        name: 'text',
        label: 'Task',
        tree: true,
        width: 230,
        resize: true,
        // The colour no longer has a column of its own: it rides along with the
        // name, and the details dialog is where it is picked.
        // The dot turns into a diamond on a milestone, the shape the chart draws
        // it as: the grid says nothing else about effort 0 that a "0g" in the
        // next column does not already say.
        template: (task) =>
          `<span class="gantt-dot${task.type === MILESTONE_TYPE ? ' gantt-dot--milestone' : ''}"` +
          ` style="background:${String(task.bar_color || DEFAULT_BAR_COLOR)}"></span>` +
          `<span class="${task.is_summary ? 'gantt-name gantt-name--summary' : 'gantt-name'}">${escapeHtml(String(task.text ?? ''))}</span>`,
        editor: { type: 'text', map_to: 'text' },
      },
      {
        name: 'resource_id',
        label: 'Resource',
        width: 76,
        align: 'center',
        resize: true,
        // A summary has no resource of its own, so it shows the branch's.
        template: (task) =>
          task.is_summary
            ? resourceStack(String(task.id))
            : resourceAvatar(task.resource_id as string | undefined),
        editor: { type: 'select', map_to: 'resource_id', options: resourceOptions() },
      },
      {
        name: 'nominal_days',
        label: 'Effort',
        width: 62,
        align: 'center',
        resize: true,
        // One format for both branches, or a summary's 9g reads as a different
        // kind of figure from the 5g of the leaf under it.
        template: (task) =>
          task.is_summary
            ? `<span class="gantt-derived">${formatDays(Number(task.rolled_effort_days))}d</span>`
            : `${formatDays(Number(task.nominal_days))}d`,
        editor: { type: 'number', map_to: 'nominal_days', min: 0, max: 999 },
      },
      {
        name: 'start_date',
        label: 'Start',
        width: 84,
        align: 'center',
        resize: true,
        template: (task) =>
          task.is_summary
            ? `<span class="gantt-derived">${shortDate(task.start_date as Date)}</span>`
            : shortDate(task.start_date as Date),
        editor: { type: 'date', map_to: 'start_date' },
      },
      // The two derived columns. Every cell wears the register a summary's
      // rolled-up figures already wear, and neither column carries an editor —
      // a cell without one has nothing for a click to open. The end date is
      // never an input.
      {
        name: 'end_shown',
        label: 'End',
        width: 84,
        align: 'center',
        resize: true,
        template: (task) =>
          `<span class="gantt-derived">${shortDate(task.end_shown as Date)}</span>`,
      },
      {
        name: 'elapsed_days',
        label: 'Duration',
        width: 62,
        align: 'center',
        resize: true,
        template: (task) =>
          `<span class="gantt-derived">${formatDays(Number(task.elapsed_days ?? 0))}d</span>`,
      },
      {
        name: 'info',
        label: '',
        width: 34,
        align: 'center',
        // Progress, colour and the float figure live behind this button: the
        // first two are rarely changed, and the float costs a search per row.
        // The button has no content, so its title is its accessible name — and
        // one shared by every row leaves anyone moving between buttons unable
        // to tell whose detail is about to open. Carried by the template, which
        // dhtmlx re-runs on each render, rather than written onto the node: a
        // class or an attribute set by hand does not survive a redraw.
        template: (task) =>
          `<button type="button" class="gantt-rowinfo" data-task-info="1"` +
          ` title="Details for “${escapeHtml(String(task.text ?? ''))}”">${INFO_ICON}</button>`,
      },
      {
        name: 'toggle',
        label: '',
        width: 34,
        align: 'center',
        // The effective (inherited) flag is what `task.disabled` carries here —
        // wrong for a child of a disabled summary, which must still read as
        // enabled on its own row. The row's own flag lives on the model, not
        // on the dhtmlx task.
        template: (task) => {
          const own =
            projectRef.current.tasks.find((candidate) => candidate.id === String(task.id))
              ?.disabled === true;
          const name = escapeHtml(String(task.text ?? ''));
          return (
            `<button type="button" class="gantt-rowtoggle${own ? ' gantt-rowtoggle--off' : ''}"` +
            ` data-task-toggle="1" title="${own ? 'Enable' : 'Disable'} “${name}”">${BAN_ICON}</button>`
          );
        },
      },
      { name: 'add', width: 40 },
    ];
    // The grid holds `grid_width` and squeezes its resizable columns down to
    // `min_column_width` to fit, so two more columns came out of the task name —
    // 230px to 152px, and a truncated name is the one cell whose content cannot
    // be guessed from what is left of it. The grid is sized to hold the columns
    // it declares instead, and the width comes off the timeline, which scrolls
    // and re-scales while a name does neither.
    gantt.config.grid_width = gantt.config.columns.reduce(
      (total, column) => total + (Number(column.width) || 0),
      0,
    );

    /**
     * Whether the row is one the search is pointing at, or holds one below it.
     * A summary carries the fainter mark whether its branch is open or closed —
     * closed is where it earns its keep, since the matching rows are not on
     * screen at all, but tying it to `$open` would make the highlight flicker
     * with the arrow. Same argument as `resource_classes`: the branch says what
     * it contains, always.
     */
    const found = (task: { id?: unknown; text?: unknown }) => {
      const key = searchKeyRef.current;
      if (key === '') return '';
      if (matchesSearch(String(task.text ?? ''), key)) return 'gantt-found';
      let below = false;
      gantt.eachTask((child) => {
        below ||= matchesSearch(String(child.text ?? ''), key);
      }, task.id as string);
      return below ? 'gantt-found-below' : '';
    };

    // Every row, bar and link says whose work it is, so that highlighting a
    // person is a stylesheet rule and not a redraw.
    gantt.templates.grid_row_class = (_start, _end, task) =>
      [
        String(task.resource_classes ?? ''),
        found(task),
        task.disabled ? 'gantt-row--disabled' : '',
      ]
        .filter(Boolean)
        .join(' ');
    // A band across the chart rather than a mark on the bar: the outline is the
    // critical chain's and the fill is the user's colour, so a match has to
    // read on the row it is on without touching either.
    gantt.templates.task_row_class = (_start, _end, task) => found(task);
    gantt.templates.task_class = (_start, _end, task) => {
      const classes = [String(task.resource_classes ?? '')];
      if (task.is_summary) classes.push('gantt-bar--summary');
      else if (task.shared) classes.push('gantt-bar--shared');
      // Positioned but weightless — the engine guarantees a disabled task is
      // never also critical or shared, so this never has to compose with them.
      if (task.disabled) classes.push('gantt-bar--disabled');
      // An outline, so it composes with whatever colour the bar carries: the
      // colour belongs to the user, and dhtmlx sets it inline anyway.
      if (task.critical) {
        classes.push('gantt-bar--critical');
        // Dashed where the answer predates the last edit. An outline that looks
        // measured while it is not is worse than none at all.
        if (task.critical_stale) classes.push('gantt-bar--critical-old');
      }
      return classes.filter(Boolean).join(' ');
    };
    // A link keeps both ends' people: what gates someone's work, and what their
    // work gates, is part of reading their plan.
    gantt.templates.link_class = (link) =>
      [
        ...new Set(
          [link.source, link.target]
            .filter((id) => gantt.isTaskExists(id))
            .flatMap((id) => String(gantt.getTask(id).resource_classes ?? '').split(' '))
            .filter(Boolean),
        ),
      ].join(' ');
    // The bar holds the allocation profile and nothing else: the name lives
    // beside it, where a one-day bar can still show it in full.
    gantt.templates.task_text = (_start, _end, task) => {
      const scheduled = solvedRef.current.schedule.tasks.get(String(task.id));
      if (!scheduled || !isShared(scheduled)) return '';
      // Which percentage labels fit depends on the zoom level, so ask dhtmlx for
      // the bar's actual pixel width rather than guessing from a percentage.
      const width = Number(gantt.getTaskPosition(task).width) || 0;
      const color = String(task.bar_color || DEFAULT_BAR_COLOR);
      return renderSegments(scheduled, width, color, shade(color));
    };
    gantt.templates.rightside_text = (_start, _end, task) => escapeHtml(String(task.text ?? ''));

    // Before init: the extension hangs its own tooltip off onGanttReady, which
    // fires inside init. Community ships it — unlike addTaskLayer, it is not one
    // of the calls the build deletes — and calling plugins() twice is a no-op,
    // which StrictMode's second mount depends on.
    gantt.plugins({ tooltip: true });
    // The extension's own 30ms means a pointer crossing the chart trails a
    // tooltip per bar. Long enough to be asked for, short enough to be a hover.
    gantt.config.tooltip_timeout = 220;

    // Before the zoom levels, two of which are declared in quarters.
    registerQuarterUnit();
    // No useKey: the extension's own ctrl+wheel binds "mousewheel", which this
    // browser no longer fires at all, and it would bind "wheel" in Firefox —
    // where it would then zoom twice per notch alongside the listener below.
    gantt.ext.zoom.init({ levels: ZOOM_LEVELS, activeLevelIndex: 1 });
    // Zooming also happens by ctrl+wheel, so the status bar cannot rely on its
    // own buttons to know which scale is showing.
    const zoomHandler = gantt.ext.zoom.attachEvent('onAfterZoom', (_level, config) => {
      scaleChangeRef.current?.(SCALE_LABELS[config.name ?? ''] ?? '');
    });
    gantt.init(container);

    /**
     * What a bar says when the pointer rests on it.
     *
     * Read off the plan on screen by id rather than out of the hovered element,
     * so smart rendering is irrelevant: the bar has to exist to be hovered, and
     * nothing here is stored on it to be lost at the next redraw. The extension
     * delegates one mousemove on `$root`, which outlives every redraw too.
     */
    const barTooltip = (id: string | null): string | undefined => {
      if (suppressTooltipRef.current) return undefined;
      const project = projectRef.current;
      const task = project.tasks.find((candidate) => candidate.id === id);
      const scheduled = id === null ? undefined : solvedRef.current.schedule.tasks.get(id);
      if (!task || !scheduled) return undefined;
      return renderBarTooltip(
        barFactsOf(
          task,
          scheduled,
          solvedRef.current,
          project.resources,
          chainRef.current,
          subtreeOf(project.tasks, task.id).size - 1,
        ),
      );
    };
    // The extension's own tooltip covers everything carrying a task id, the grid
    // rows included — where the columns already say all of this and the avatars
    // carry native titles that would fight it. Replaced by one on the bars.
    gantt.ext.tooltips.detach(`[${gantt.config.task_attribute}]:not(.gantt_task_row)`);
    gantt.ext.tooltips.tooltipFor({
      selector: '.gantt_task_line',
      html: (_event, node) => barTooltip(node.getAttribute(gantt.config.task_attribute)),
    });

    // Today as a line rather than a shaded column: a column means a whole month
    // at month scale, while a line is exact at every zoom level. The marker
    // extension would do this, but the Community package ships no codebase/ext.
    // It lives inside the data area, which scrolls with the bars, so only a
    // change of scale moves it.
    const todayLine = document.createElement('div');
    todayLine.className = 'gantt-today';
    gantt.$task_data.appendChild(todayLine);
    const placeTodayLine = () => {
      const now = new Date();
      const { min_date: from, max_date: to } = gantt.getState();
      const visible = from instanceof Date && to instanceof Date && now >= from && now <= to;
      todayLine.style.display = visible ? '' : 'none';
      if (!visible) return;
      // Outside the rendered range posFromDate extrapolates, which would put the
      // line beyond the timeline and stretch the scrollable area.
      todayLine.style.left = `${gantt.posFromDate(now)}px`;
      // The data area is only as tall as the viewport and scrolls its contents,
      // so a line stretched to its edges would stop at the first screenful. The
      // background layer is the one dhtmlx sizes to hold every row.
      todayLine.style.height = `${gantt.$task_bg.offsetHeight}px`;
    };
    placeTodayLine();

    // Non-working time is drawn as bands positioned in pixels rather than as
    // shaded timeline cells: above day scale a cell spans a whole week or month,
    // so colouring it would claim days that are worked.
    //
    // Two layers, because time off needs a tint under the bars and a hatch over
    // them - the day an absence is worth looking at is exactly the day a bar
    // crosses it, and the bar must still show its own colour there. Both live
    // in $task_data: dhtmlx rewrites the contents of $task_bg and $bars_area on
    // every render, so nothing of ours may sit inside them.
    const bandsBelow = document.createElement('div');
    bandsBelow.className = 'gantt-bands';
    gantt.$task_data.insertBefore(bandsBelow, gantt.$task_bg.nextSibling);
    const bandsAbove = document.createElement('div');
    bandsAbove.className = 'gantt-bands';
    gantt.$task_data.appendChild(bandsAbove);

    /** The rendered range in day indices, or null before the first render. */
    const renderedDays = (): { firstDay: number; lastDay: number } | null => {
      const { min_date: from, max_date: to } = gantt.getState();
      if (!(from instanceof Date) || !(to instanceof Date)) return null;
      // max_date is the far edge of the last column, so the last day drawn is
      // the one before it.
      return { firstDay: dayIndexOf(from), lastDay: dayIndexOf(to) - 1 };
    };

    /**
     * The non-working runs as pixel spans, wide enough to be worth shading.
     *
     * The chart's own bands and the load lanes below it both draw from this, or
     * a weekend could be shaded on one and not on the other.
     */
    const nonWorkingSpans = (): { left: number; width: number }[] => {
      const range = renderedDays();
      if (!range) return [];
      const { firstDay, lastDay } = range;
      const { calendar } = solvedRef.current;
      // The threshold becomes a number of days once, off a single
      // pixels-per-day for the whole range. Measuring each band on its own put
      // the same weekend on either side of the threshold from one month to the
      // next — a month column is one width but holds 28 to 31 days — and the
      // chart showed bands blinking in and out along its length.
      const spanDays = lastDay - firstDay + 1;
      const dayWidth =
        spanDays > 0
          ? (gantt.posFromDate(dateOfDay(lastDay + 1)) - gantt.posFromDate(dateOfDay(firstDay))) /
            spanDays
          : 0;
      const minDays = dayWidth > 0 ? MIN_NONWORKING_BAND / dayWidth : Infinity;
      const runs = runsOf(daysBetween(firstDay, lastDay), (day) => {
        const date = dateOfDay(day);
        // A shutdown is not a working day either, and gets the louder band.
        return !calendar.isWorkingDate(date) && !calendar.isShutdownDate(date);
      });
      // Measured before clipping, so a weekend the range cuts in half is still
      // judged as the weekend it is rather than as the sliver drawn.
      return runs
        .filter(([runFrom, runTo]) => runTo - runFrom + 1 >= minDays)
        .map(([runFrom, runTo]) => {
          const left = gantt.posFromDate(dateOfDay(runFrom));
          return { left, width: gantt.posFromDate(dateOfDay(runTo + 1)) - left };
        });
    };

    const paintBands = () => {
      const { calendar } = solvedRef.current;
      const range = renderedDays();
      if (!range) return;
      const { firstDay, lastDay } = range;
      type Band = {
        left: number;
        width: number;
        top: number;
        height: number;
        kind: 'nonworking' | 'timeoff';
      };
      const bands: Band[] = [];
      const addBands = (
        runs: [number, number][],
        top: number,
        height: number,
        kind: Band['kind'],
      ) => {
        for (const [runFrom, runTo] of runs) {
          // Outside the rendered range posFromDate extrapolates, which would
          // stretch the scrollable area, so a run is clipped to it instead.
          const start = Math.max(runFrom, firstDay);
          const end = Math.min(runTo, lastDay);
          if (end < start) continue;
          const left = gantt.posFromDate(dateOfDay(start));
          bands.push({
            left,
            width: gantt.posFromDate(dateOfDay(end + 1)) - left,
            top,
            height,
            kind,
          });
        }
      };

      // The data area is only as tall as the viewport and scrolls its contents;
      // the background layer is the one dhtmlx sizes to hold every row.
      const fullHeight = gantt.$task_bg.offsetHeight;

      for (const span of nonWorkingSpans()) {
        bands.push({ ...span, top: 0, height: fullHeight, kind: 'nonworking' });
      }

      addBands(
        runsOf(daysOf(projectRef.current.calendar.holidays), (day) =>
          calendar.isShutdownDate(dateOfDay(day)),
        ),
        0,
        fullHeight,
        'timeoff',
      );

      const awayByResource = new Map<string, [number, number][]>();
      for (const resource of projectRef.current.resources) {
        // Only a working day the person cannot work at all. Reduced availability
        // is a rate rather than time off, and reads in the allocation profile.
        const away = runsOf(
          daysOf(resource.availabilityOverrides),
          (day) => availabilityOnDay(resource, day) === 0 && calendar.isWorkingDate(dateOfDay(day)),
        );
        if (away.length > 0) awayByResource.set(resource.id, away);
      }
      const rowHeight = Number(gantt.config.row_height) || 0;
      for (const task of projectRef.current.tasks) {
        const away = task.resourceId ? awayByResource.get(task.resourceId) : undefined;
        // A summary is never scheduled, so nobody is away on its row: the leaves
        // underneath carry the assignment.
        if (!away || solvedRef.current.summaryIds.has(task.id)) continue;
        // A row inside a collapsed branch has no place on the chart, and asking
        // for its top would put a band on whichever row happens to be there.
        if (!gantt.isTaskExists(task.id) || !gantt.isTaskVisible(task.id)) continue;
        addBands(away, gantt.getTaskTop(task.id), rowHeight, 'timeoff');
      }

      const element = (band: Band, className: string) => {
        const div = document.createElement('div');
        div.className = className;
        div.style.left = `${band.left}px`;
        div.style.width = `${band.width}px`;
        div.style.top = `${band.top}px`;
        div.style.height = `${band.height}px`;
        return div;
      };
      bandsBelow.replaceChildren(
        ...bands.map((band) => element(band, `gantt-bands__${band.kind}`)),
      );
      bandsAbove.replaceChildren(
        ...bands
          .filter((band) => band.kind === 'timeoff')
          .map((band) => element(band, 'gantt-bands__hatch')),
      );
    };
    paintBands();

    /**
     * The lanes under the chart, on the chart's own axis.
     *
     * Its own DOM below the container rather than a layer inside it: dhtmlx
     * sizes the data area to the rows and scrolls its contents, so lanes put in
     * there would either scroll away with the rows or be rewritten on the next
     * render. The alignment is bought back by taking every x from
     * `posFromDate` and following the chart's horizontal scroll.
     */
    const paintLoad = () => {
      const panel = loadHost.current;
      if (!panel) return;
      panel.hidden = !showLoadRef.current;
      if (!showLoadRef.current) {
        // Nothing to keep alive while the panel is closed, listeners included.
        panel.replaceChildren();
        return;
      }
      const { max_date: to } = gantt.getState();
      if (!(to instanceof Date)) return;
      const solved = solvedRef.current;
      if (lanesRef.current?.solved !== solved) {
        lanesRef.current = { solved, lanes: loadLanes(projectRef.current, solved) };
      }
      const names = new Map(projectRef.current.tasks.map((task) => [task.id, task.name]));
      renderLoadPanel(panel, lanesRef.current.lanes, {
        // Read every time: the grid can be resized by dragging its edge, and a
        // lane starting anywhere else than the bars do is worse than no lane.
        gridWidth: gantt.$grid.offsetWidth,
        timelineWidth: gantt.posFromDate(to),
        scrollX: gantt.getScrollState().x,
        posOf: (date) => gantt.posFromDate(date),
        nonWorking: nonWorkingSpans(),
        nameOf: (id) => names.get(id) ?? id,
      });
    };
    repaintLoadRef.current = paintLoad;
    paintLoad();

    const pullFromView = (id: string | number) => {
      const ganttTask = gantt.getTask(id);
      const task = projectRef.current.tasks.find((candidate) => candidate.id === String(id));
      if (!task) return;
      task.name = String(ganttTask.text ?? task.name);
      // Absent rather than zero, so a rename does not add a key the task never
      // had — see `updateTask`, which reads the same value from the dialog.
      task.progress = Number(ganttTask.progress) || undefined;
      // Subtasks display an inherited colour; writing it back would freeze a copy
      // that stops following the parent.
      if (task.parentId === undefined) {
        task.color = (ganttTask.bar_color as string | undefined) || undefined;
      }
      // Effort, start and resource of a summary are rolled up from its children,
      // so writing them back would overwrite the user's leaf data with derived
      // figures the moment dhtmlx refreshes the parent row.
      if (solvedRef.current.summaryIds.has(task.id)) return;
      // Only a start the drag actually moved is a constraint — see
      // `constraintStart`. dhtmlx reports one drag twice, and the second report
      // arrives after the solved start has been written onto the row, so
      // reading it back unconditionally would move the constraint on its own
      // and cost a second, invisible undo step.
      task.start = constraintStart(
        task,
        new Date(ganttTask.start_date as Date),
        solvedRef.current,
      );
      task.resourceId = (ganttTask.resource_id as string | undefined) || undefined;
      const nominal = Number(ganttTask.nominal_days);
      if (Number.isFinite(nominal) && nominal >= 0) task.nominalDays = nominal;
    };

    /**
     * Writes the grid's row order back onto the model.
     *
     * Walked with `getChildren` rather than `eachTask`, which is an iteration
     * over what is on screen: a branch the user closed must keep the order it
     * has inside it, not be flattened out of the file for being folded.
     */
    const pullOrderFromView = () => {
      const walk = (parent: string | number): string[] =>
        gantt.getChildren(parent).flatMap((id) => [String(id), ...walk(id)]);
      projectRef.current.tasks = reorderTasks(
        projectRef.current.tasks,
        walk(gantt.config.root_id),
      );
    };

    const syncLinks = () => {
      const byTarget = new Map<string, string[]>();
      gantt.getLinks().forEach((link) => {
        const target = String(link.target);
        const list = byTarget.get(target);
        if (list) list.push(String(link.source));
        else byTarget.set(target, [String(link.source)]);
      });
      for (const task of projectRef.current.tasks) {
        task.predecessors = byTarget.get(task.id) ?? [];
      }
    };

    // On a summary these columns show rolled-up figures, so an editor would
    // accept a value the rollup then discards — and one of them would not even
    // show the figure the cell does: the column templates roll up, the editor
    // reads the raw field, so a summary whose children sum to five days offers
    // its own untouched one.
    //
    // Refused here rather than at the gesture that opened it. Every way in ends
    // at `startEdit`, and there are four: dhtmlx's own click, Tab arriving from
    // the cell before, a script, and the double click a person makes out of the
    // first of those. A guard on any one of them is a guard the other three
    // walk past.
    const derivedGuard = gantt.ext.inlineEditors.attachEvent(
      'onBeforeEditStart',
      (state) =>
        !(solvedRef.current.summaryIds.has(String(state.id)) &&
          DERIVED_ON_SUMMARY.has(state.columnName)),
    );

    // The keys that move between cells come from dhtmlx's keyboard navigation
    // extension, which this chart deliberately does not load: it would also
    // claim the arrows and Del, which App already owns. Left alone, Tab falls
    // through to the browser and lands on the grid's scrollbar with the editor
    // still open behind it, and Enter does nothing at all: the only way to
    // commit a typed value is to click somewhere else. The two moves that are
    // wanted are on `inlineEditors`, which is loaded, and each saves the cell
    // it leaves.
    const editorKeys = (event: KeyboardEvent) => {
      const editors = gantt.ext.inlineEditors;
      if (!editors.isVisible()) return;
      if (event.key === 'Tab') {
        event.preventDefault();
        // Past the last editable cell of a row and on to the first of the next,
        // which is the one thing a grid of cells is always expected to do.
        if (event.shiftKey) editors.editPrevCell(true);
        else editors.editNextCell(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        editors.save();
      }
      // Escape is dhtmlx's own and already closes without saving.
    };
    container.addEventListener('keydown', editorKeys);

    /**
     * The day the pointer is over, for an anchor that is on the timeline.
     *
     * The date axis is the one thing the timeline has and the grid has not, so
     * pointing at a week there says a start out loud — while a grid row says
     * only which row, and the caller falls back to that row's own day.
     *
     * Measured against `$task_data`, and **without** adding the scroll: that
     * element is the one the chart translates, so its own rect has already
     * moved by however far the timeline is scrolled — adding `getScrollState().x`
     * counts it twice and lands the task a fortnight out. The load lanes do add
     * it, and are not a precedent: they are drawn in a panel of their own that
     * does not move with the chart.
     *
     * `startOfWorkingDay` then takes the arbitrary minute off it, as it does for
     * a drop.
     */
    const dateUnder = (anchor: Element, clientX: number): Date | undefined => {
      const onTimeline =
        anchor.classList.contains('gantt_task_line') ||
        anchor.classList.contains('gantt_task_row');
      if (!onTimeline) return undefined;
      const left = gantt.$task_data.getBoundingClientRect().left;
      return gantt.dateFromPos(clientX - left) ?? undefined;
    };

    // The only pointer gesture either half of the chart had left: a single
    // click opens the inline editor and selects the row, a double click the
    // same, a drag reorders in the grid and moves the bar in the timeline. The
    // row is selected too, so the plan says which one the menu is about even
    // after the pointer has moved off it.
    //
    // Three anchors, one menu: a grid row, a bar, and the empty stretch of a
    // bar's own lane — which resolves to the `.gantt_task_row` behind it, the
    // bars being drawn in a layer of their own above it.
    const openRowMenu = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.(
        '.gantt_grid_data .gantt_row, .gantt_task_line, .gantt_task_row',
      );
      const id = anchor?.getAttribute('data-task-id');
      if (!anchor || !id || !gantt.isTaskExists(id)) return;
      event.preventDefault();
      gantt.selectTask(id);
      const task = projectRef.current.tasks.find((candidate) => candidate.id === id);
      rowMenuRef.current?.({
        taskId: id,
        name: String(gantt.getTask(id).text ?? ''),
        x: event.clientX,
        y: event.clientY,
        isSummary: solvedRef.current.summaryIds.has(id),
        start: dateUnder(anchor, event.clientX),
        disabled: task?.disabled === true,
      });
    };
    container.addEventListener('contextmenu', openRowMenu);

    // A click on a grid cell opens an inline editor but leaves the row
    // unselected, so Del would have nothing to act on unless the user went to
    // the timeline to click a bar first. The info and toggle buttons are
    // excluded: info opens a modal (a row highlighted behind it reads as a
    // pending action), and the toggle is a self-contained action that must not
    // also select the row it sits on.
    const selectRow = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-task-info]')) return;
      if (target?.closest?.('[data-task-toggle]')) return;
      const id = target?.closest?.('.gantt_row')?.getAttribute('data-task-id');
      if (id && gantt.isTaskExists(id)) gantt.selectTask(id);
    };
    // Bubble phase, unlike the editor above: selecting re-renders the row, and
    // dhtmlx dispatches its own delegated click handlers only while the clicked
    // node is still a descendant of the grid. Selecting on the capture phase
    // detaches it first, which swallows the click on the expand/collapse icon
    // and on the "+" button of any row that is not already selected. dhtmlx
    // delegates on $grid, inside this container, so bubble gets there second.
    container.addEventListener('click', selectRow);

    // Del on the selected row, on the document rather than the container: with
    // keyboard navigation dhtmlx moves focus around its own cells, and a key
    // that only works when focus happens to sit inside the chart reads as
    // broken.
    const deleteSelected = (event: KeyboardEvent) => {
      if (event.key !== 'Delete') return;
      if (keystrokeIsCaptured()) return;
      const selected = gantt.getSelectedId();
      if (!selected || !gantt.isTaskExists(selected)) return;
      event.preventDefault();
      deleteTaskRef.current?.(String(selected));
    };
    document.addEventListener('keydown', deleteSelected);

    const handlers = [
      gantt.attachEvent('onGanttRender', () => {
        placeTodayLine();
        paintBands();
        paintLoad();
        return true;
      }, undefined),
      // onGanttRender alone leaves the line and the bands a render behind:
      // refreshData sizes the rows after it, and adding a task goes through
      // refreshData.
      gantt.attachEvent('onDataRender', () => {
        placeTodayLine();
        paintBands();
        paintLoad();
        return true;
      }, undefined),
      // The lanes are as wide as the whole timeline and are moved rather than
      // redrawn, so following the chart costs nothing per scrolled pixel.
      //
      // The offset comes from getScrollState and deliberately not from the
      // event's own `left`: one scroll fires this three times, and two of them
      // carry the position the chart has just left rather than the one it
      // reached, so a lane driven by the argument settles wherever the last
      // stale report happened to land. The state is already correct in all three.
      gantt.attachEvent('onGanttScroll', () => {
        if (loadHost.current) scrollLoadPanel(loadHost.current, gantt.getScrollState().x);
      }, undefined),
      gantt.attachEvent('onTaskClick', (id, event) => {
        const target = event?.target as HTMLElement | null;
        if (target?.closest?.('[data-task-toggle]')) {
          const task = projectRef.current.tasks.find((candidate) => candidate.id === String(id));
          toggleDisabledRef.current?.(String(id), task?.disabled === true);
          return false;
        }
        if (!target?.closest?.('[data-task-info]')) return true;
        openTaskRef.current?.(String(id));
        // Selecting the row as well would leave it highlighted behind the modal.
        return false;
      }, undefined),
      // Rows created by dhtmlx itself — the grid's "+" button, which adds a
      // child — never passed through the model, so they rendered with an
      // undefined effort and a NaN duration.
      gantt.attachEvent('onAfterTaskAdd', (id, item) => {
        if (applyingRef.current) return true;
        const key = String(id);
        if (!projectRef.current.tasks.some((task) => task.id === key)) {
          const parent = item.parent !== undefined && String(item.parent) !== '0'
            ? String(item.parent)
            : undefined;
          const start = solvedRef.current.calendar.startOfWorkingDay(
            item.start_date ? new Date(item.start_date as Date) : new Date(),
          );
          // Honour whatever the caller supplied and only fall back to a day of
          // effort, so a row created with data does not silently lose it.
          const supplied = Number(item.nominal_days);
          projectRef.current.tasks.push({
            id: key,
            name: String(item.text || 'New task'),
            nominalDays: Number.isFinite(supplied) && supplied >= 0 ? supplied : 1,
            start,
            parentId: parent,
            resourceId: (item.resource_id as string | undefined) || undefined,
            // Only a top-level task owns a colour; a subtask inherits its
            // parent's, and a copy frozen here would stop following it.
            color: parent ? undefined : (item.bar_color as string | undefined) || undefined,
            // Never stored as false — see updateTask's own comment.
            disabled: item.disabled === true ? true : undefined,
          });
        }
        // Pushed at the end of the list, while the grid put it next to its
        // siblings — which for a child of anything but the last branch is a
        // different place.
        pullOrderFromView();
        applySolution();
        return true;
      }, undefined),
      gantt.attachEvent('onAfterTaskMove', (id, parent) => {
        if (applyingRef.current) return true;
        const task = projectRef.current.tasks.find((candidate) => candidate.id === String(id));
        if (task) {
          task.parentId = parent !== undefined && String(parent) !== '0' ? String(parent) : undefined;
        }
        // A move is a reorder as much as a re-parent: dropping a row between two
        // of its own siblings changes nothing else at all.
        pullOrderFromView();
        applySolution();
        return true;
      }, undefined),
      gantt.attachEvent('onAfterTaskUpdate', (id) => {
        if (applyingRef.current) return true;
        pullFromView(id);
        applySolution();
        return true;
      }, undefined),
      gantt.attachEvent('onAfterTaskDrag', (id) => {
        if (applyingRef.current) return true;
        pullFromView(id);
        applySolution();
        return true;
      }, undefined),
      gantt.attachEvent('onAfterTaskDelete', (id) => {
        if (applyingRef.current) return true;
        const doomed = subtreeOf(projectRef.current.tasks, String(id));
        projectRef.current.tasks = projectRef.current.tasks.filter((task) => !doomed.has(task.id));
        for (const task of projectRef.current.tasks) {
          task.predecessors = task.predecessors?.filter(
            (predecessorId) => !doomed.has(predecessorId),
          );
        }
        applySolution();
        return true;
      }, undefined),
      // Refused here rather than after the fact, and for the same reason the
      // scripted path refuses: onAfterLinkAdd writes the predecessors into the
      // model before re-solving, so a cycle drawn with the mouse used to leave
      // the project holding a schedule it cannot solve and the chart half
      // updated, with nothing but an uncaught error to show for it.
      gantt.attachEvent('onBeforeLinkAdd', (_id, link) => {
        if (applyingRef.current) return true;
        const problem = rejectionForLink(
          projectRef.current,
          String(link.source),
          String(link.target),
        );
        if (!problem) return true;
        rejectRef.current?.(problem);
        return false;
      }, undefined),
      gantt.attachEvent('onAfterLinkAdd', () => {
        if (applyingRef.current) return true;
        syncLinks();
        applySolution();
        return true;
      }, undefined),
      gantt.attachEvent('onAfterLinkDelete', () => {
        if (applyingRef.current) return true;
        syncLinks();
        applySolution();
        return true;
      }, undefined),
    ];

    loadProject(projectRef.current);

    /**
     * Ctrl and the wheel change the scale, as they do in every other chart.
     *
     * `passive: false` and `preventDefault` are both load-bearing: without them
     * the browser zooms the page instead, which is the one gesture a user is
     * sure to try. A trackpad pinch arrives here as the same event with
     * `ctrlKey` set, so pinching zooms the timeline for free.
     *
     * Capture phase, and the propagation stopped: dhtmlx scrolls the chart on
     * the wheel from a handler on the data area, and when it does scroll it
     * consumes the event — so a listener on the bubble phase, like this one
     * was, only ever ran at the two ends of the vertical scroll, where dhtmlx
     * has nothing to scroll and lets the event through. Zooming in worked at
     * the top and zooming out at the bottom, and nothing worked in between.
     *
     * One step per gesture rather than per event: a flick of a wheel and a
     * pinch both fire in bursts, and the levels are few enough that a burst
     * would cross all of them and land on quarters.
     */
    let lastZoomStep = 0;
    const zoomOnWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // Or dhtmlx scrolls the rows away under the scale that is being changed.
      event.stopPropagation();
      if (event.deltaY === 0) return;
      const now = event.timeStamp || Date.now();
      if (now - lastZoomStep < WHEEL_ZOOM_COOLDOWN) return;
      lastZoomStep = now;
      if (event.deltaY < 0) gantt.ext.zoom.zoomIn();
      else gantt.ext.zoom.zoomOut();
    };
    container.addEventListener('wheel', zoomOnWheel, { passive: false, capture: true });

    // dhtmlx measures its container once at init. It listens for window resize,
    // but not for the container changing size on its own — a split pane, a
    // devtools panel opening, or the error banner appearing above the chart.
    const observer = new ResizeObserver(() => gantt.setSizes());
    observer.observe(container);


    return () => {
      observer.disconnect();
      gantt.ext.tooltips.detach('.gantt_task_line');
      // The tooltip node lives on document.body, so an unmount while one is up
      // would leave it there with nothing to describe.
      gantt.ext.tooltips.tooltip.hide();
      todayLine.remove();
      bandsBelow.remove();
      bandsAbove.remove();
      gantt.ext.zoom.detachEvent(zoomHandler);
      container.removeEventListener('wheel', zoomOnWheel, true);
      container.removeEventListener('contextmenu', openRowMenu);
      gantt.ext.inlineEditors.detachEvent(derivedGuard);
      container.removeEventListener('keydown', editorKeys);
      container.removeEventListener('click', selectRow);
      document.removeEventListener('keydown', deleteSelected);
      handlers.forEach((handlerId) => gantt.detachEvent(handlerId));
      // Deliberately no destructor(): it leaves the singleton unusable, and
      // StrictMode's mount/unmount/mount would then re-init a dead instance
      // ("cannot read tasksStore"). The Community build has no
      // getGanttInstance(), so there is exactly one gantt for the whole app.
      gantt.clearAll();
    };
  }, [applySolution, loadProject]);

  // Declared after the effect that inits the chart, so the first run has rows to
  // write to — and it compares against the ref rather than firing on mount,
  // since the first parse already drew whatever this asks for. Going through
  // applySolution keeps one path onto the rows; `false` because turning the
  // marking on is a view switch and must not mark the file dirty.
  useEffect(() => {
    if (markCriticalRef.current === markCritical) return;
    markCriticalRef.current = markCritical;
    applySolution(false);
  }, [applySolution, markCritical]);

  // A view switch like the one above, and cheaper: the panel is drawn from the
  // schedule that is already solved, so opening it costs an aggregation and a
  // paint rather than a re-solve — and never marks the file dirty.
  useEffect(() => {
    showLoadRef.current = showLoad;
    repaintLoadRef.current();
    // The chart has just gained or lost the strip's height, and dhtmlx measures
    // its container at init and on a window resize only. Without this its
    // horizontal scrollbar stays where the taller layout put it, behind the
    // panel — the chart looks right and cannot be scrolled sideways any more.
    gantt.setSizes();
  }, [showLoad]);

  // A stylesheet rule rather than a class written onto the rows: dhtmlx rebuilds
  // them on every redraw and would drop it, and redrawing on hover would replace
  // the very node the pointer is on. How faint the rest of the plan goes is the
  // stylesheet's business, which is why the rule reads a custom property.
  useEffect(() => {
    if (!highlighted) return;
    // Nothing is spared, the selected row included: one row left bright in
    // somebody else's colour reads as part of the highlight.
    const others = `:not(.${resourceClass(highlighted)})`;
    const rule = document.createElement('style');
    rule.textContent =
      `.gantt-host .gantt_row${others},` +
      `.gantt-host .gantt_task_line${others},` +
      `.gantt-host .gantt_task_link${others},` +
      // The load panel is not inside the chart, so it needs a selector of its
      // own — and it is the view arranged by person, where dimming the others
      // is most of the point.
      `.loadlane${others}` +
      `{opacity:var(--gantt-dimmed)}`;
    document.head.appendChild(rule);
    return () => rule.remove();
  }, [highlighted]);

  return (
    <>
      <div ref={host} className="gantt-host" />
      {/* Painted imperatively, like the today line and the bands: it follows
          dhtmlx's geometry and has to be redrawn from the same events. */}
      <div ref={loadHost} className="loadpanel" hidden />
    </>
  );
}
