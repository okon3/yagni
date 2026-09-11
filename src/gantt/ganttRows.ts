import { gantt } from 'dhtmlx-gantt';
import {
  effectiveColorOf,
  isMilestone,
  loadByResource,
  type MarkedChain,
  type Project,
  type ProjectTask,
  type SolvedProject,
} from './project';
import { resourceClass, shade } from './colors';
import { isShared } from './segmentBar';
import type { LoadLane } from './loadPanel';
import type { ScheduledTask } from '../scheduler';

/** dhtmlx link type for finish-to-start. */
export const FINISH_TO_START = '0';

/**
 * The two dhtmlx task types the app writes, through `String` because the
 * typings allow `config.types` to hold numbers. A row of the first kind is drawn
 * as a diamond on its date, a row of the second as a bar.
 */
export const MILESTONE_TYPE = String(gantt.config.types.milestone);
export const BAR_TYPE = String(gantt.config.types.task);

/** Class tokens for whoever works on the task, or anywhere below it. */
export function resourceClassesOf(solved: SolvedProject, id: string): string {
  const owners = solved.resourcesByTask.get(id);
  return owners ? [...owners].map(resourceClass).join(' ') : '';
}

export function typeOf(task: ProjectTask, solved: SolvedProject): string {
  return isMilestone(task, solved.summaryIds) ? MILESTONE_TYPE : BAR_TYPE;
}

export function toGanttData(project: Project, solved: SolvedProject, chain: MarkedChain | null) {
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
export function barBackground(
  color: string | undefined,
  scheduled: ScheduledTask | undefined,
  summary: boolean,
): string {
  if (!color) return '';
  if (summary) return shade(color, 0.55);
  return scheduled && isShared(scheduled) ? '' : color;
}

/**
 * Puts the chain onto the rows dhtmlx will redraw, leaving the redraw to the
 * caller — an edit already has one coming, a measurement asked for does not.
 */
export function writeChainOntoRows(project: Project, chain: MarkedChain | null): void {
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
export function loadLanes(project: Project, solved: SolvedProject): LoadLane[] {
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

export function nextTaskId(project: Project): string {
  const highest = project.tasks.reduce((max, task) => {
    const numeric = Number(task.id);
    return Number.isFinite(numeric) && numeric > max ? numeric : max;
  }, 0);
  return String(highest + 1);
}
