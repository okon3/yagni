import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { gantt, type ZoomLevel } from 'dhtmlx-gantt';
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css';
import { isShared, renderSegments } from './segmentBar';
import type { Resource, ScheduledTask } from '../scheduler';
import { effectiveColorOf, solve, type Project, type SolvedProject } from './project';
import './gantt.css';

/** dhtmlx link type for finish-to-start. */
const FINISH_TO_START = '0';

const dayMonth = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});
const shortDate = (value: Date) => (value ? dayMonth.format(new Date(value)) : '');

export const DEFAULT_BAR_COLOR = '#3b74d6';

/** Columns whose value a summary derives from its children. */
const DERIVED_ON_SUMMARY = new Set(['nominal_days', 'resource_id', 'start_date']);

/** dhtmlx select editors carry plain text, so the hex is the option key. */
const COLOR_OPTIONS = [
  { key: DEFAULT_BAR_COLOR, label: 'Blu' },
  { key: '#2f9e6e', label: 'Verde' },
  { key: '#c9822b', label: 'Ambra' },
  { key: '#c0533f', label: 'Rosso' },
  { key: '#7a5bbd', label: 'Viola' },
  { key: '#3f7d8c', label: 'Petrolio' },
  { key: '#6b7280', label: 'Grigio' },
];

/** Darkens a hex colour for borders and outlines. */
function shade(hex: string, factor = 0.72): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * factor);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

const ZOOM_LEVELS: ZoomLevel[] = [
  { name: 'day', scale_height: 50, scales: [{ unit: 'day', step: 1, format: '%d %M' }] },
  {
    name: 'week',
    scale_height: 50,
    scales: [
      { unit: 'week', step: 1, format: 'Sett. %W' },
      { unit: 'day', step: 1, format: '%d %M' },
    ],
  },
  {
    name: 'month',
    scale_height: 50,
    scales: [
      { unit: 'month', step: 1, format: '%F %Y' },
      { unit: 'week', step: 1, format: 'Sett. %W' },
    ],
  },
  {
    name: 'quarter',
    scale_height: 50,
    scales: [
      { unit: 'year', step: 1, format: '%Y' },
      { unit: 'month', step: 1, format: '%M' },
    ],
  },
];

export interface GanttHandle {
  getProject(): Project;
  loadProject(project: Project): void;
  getResources(): Resource[];
  /** Tasks assigned to a removed resource are released to "no resource". */
  setResources(resources: Resource[], releasedResourceIds: string[]): void;
  countTasksByResource(): Map<string, number>;
  addTask(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  scrollToToday(): void;
}

function toGanttData(project: Project, solved: SolvedProject) {
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
        start_date: formatDate(scheduled?.start ?? task.start),
        end_date: formatDate(scheduled?.end ?? task.start),
        progress: task.progress ?? 0,
        resource_id: task.resourceId ?? '',
        nominal_days: task.nominalDays,
        rolled_effort_days: scheduled
          ? solved.calendar.minutesToDays(scheduled.effortMinutes)
          : task.nominalDays,
        is_summary: summary,
        // The colour actually shown, inherited from the top-level ancestor.
        bar_color: inherited ?? '',
        // Only a top-level task may set it; subtasks show it read-only.
        owns_color: task.parentId === undefined,
        // dhtmlx paints `color` straight onto the bar background, which must stay
        // pale on a shared task: there the colour belongs to the profile inside.
        color: barBackground(inherited, scheduled, summary),
        elapsed_days: scheduled
          ? solved.calendar.minutesToDays(scheduled.elapsedWorkingMinutes)
          : task.nominalDays,
        shared: scheduled ? isShared(scheduled) : false,
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

function nextTaskId(project: Project): string {
  const highest = project.tasks.reduce((max, task) => {
    const numeric = Number(task.id);
    return Number.isFinite(numeric) && numeric > max ? numeric : max;
  }, 0);
  return String(highest + 1);
}

export function GanttChart({
  project,
  onChange,
  ref,
}: {
  project: Project;
  onChange?: () => void;
  ref?: Ref<GanttHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project);
  const solvedRef = useRef<SolvedProject>(solve(project));
  const applyingRef = useRef(false);

  const applySolution = useCallback(
    (notify = true) => {
      applyingRef.current = true;
      const solved = solve(projectRef.current);
      solvedRef.current = solved;
      for (const task of projectRef.current.tasks) {
        const scheduled = solved.schedule.tasks.get(task.id);
        if (!scheduled || !gantt.isTaskExists(task.id)) continue;
        const ganttTask = gantt.getTask(task.id);
        ganttTask.start_date = scheduled.start;
        ganttTask.end_date = scheduled.end;
        ganttTask.nominal_days = task.nominalDays;
        ganttTask.rolled_effort_days = solved.calendar.minutesToDays(scheduled.effortMinutes);
        const summary = solved.summaryIds.has(task.id);
        const inherited = effectiveColorOf(projectRef.current.tasks, solved.hierarchy, task.id);
        ganttTask.is_summary = summary;
        ganttTask.bar_color = inherited ?? '';
        ganttTask.owns_color = task.parentId === undefined;
        ganttTask.color = barBackground(inherited, scheduled, summary);
        ganttTask.elapsed_days = solved.calendar.minutesToDays(scheduled.elapsedWorkingMinutes);
        ganttTask.shared = isShared(scheduled);
      }
      // refreshData redraws from the mutated task objects without firing the
      // update events that would bounce straight back into this function.
      gantt.refreshData();
      applyingRef.current = false;
      if (notify) onChange?.();
    },
    [onChange],
  );

  const loadProject = useCallback((next: Project) => {
    applyingRef.current = true;
    projectRef.current = next;
    solvedRef.current = solve(next);
    gantt.clearAll();
    gantt.parse(toGanttData(next, solvedRef.current));
    applyingRef.current = false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getProject: () => projectRef.current,
      loadProject,
      getResources: () => projectRef.current.resources,
      setResources: (resources, releasedResourceIds) => {
        projectRef.current.resources = resources;
        const released = new Set(releasedResourceIds);
        for (const task of projectRef.current.tasks) {
          if (task.resourceId && released.has(task.resourceId)) task.resourceId = undefined;
        }
        // The select editor captured its options when the columns were configured,
        // so a new person stays invisible in the grid until they are replaced.
        const column = gantt.config.columns?.find((entry) => entry.name === 'resource_id');
        if (column?.editor) {
          column.editor.options = resources.map((resource) => ({
            key: resource.id,
            label: resource.name,
          }));
        }
        applySolution();
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
      addTask: () => {
        const id = nextTaskId(projectRef.current);
        const start = new Date();
        start.setHours(8, 0, 0, 0);
        projectRef.current.tasks.push({ id, name: 'Nuova attività', nominalDays: 1, start });
        applyingRef.current = true;
        gantt.addTask({
          id,
          text: 'Nuova attività',
          start_date: gantt.date.date_to_str(gantt.config.date_format)(start),
          parent: 0,
          duration: 1,
          progress: 0,
          resource_id: '',
          nominal_days: 1,
          rolled_effort_days: 1,
          is_summary: false,
          bar_color: '',
          elapsed_days: 1,
          shared: false,
        });
        applyingRef.current = false;
        applySolution();
        gantt.showTask(id);
      },
      zoomIn: () => gantt.ext.zoom.zoomIn(),
      zoomOut: () => gantt.ext.zoom.zoomOut(),
      zoomToFit: () => gantt.ext.zoom.zoomToFit(),
      scrollToToday: () => gantt.showDate(new Date()),
    }),
    [applySolution, loadProject],
  );

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    const resourceOptions = () =>
      projectRef.current.resources.map((resource) => ({ key: resource.id, label: resource.name }));
    // Partial staffing changes every duration on the row, so it belongs on the
    // face of the grid rather than hidden in the resources dialog.
    const resourceLabel = (id: string | undefined) => {
      const resource = projectRef.current.resources.find((entry) => entry.id === id);
      if (!resource) return '';
      const availability = resource.availability ?? 1;
      return availability < 1
        ? `${resource.name} (${Math.round(availability * 100)}%)`
        : resource.name;
    };

    // Also localises month and weekday names in the timeline scales, and the
    // default name dhtmlx gives to rows created from the grid.
    gantt.i18n.setLocale('it');
    gantt.config.date_format = '%Y-%m-%d %H:%i';
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
    // Grid inline editors only open when cell-level keyboard navigation is on;
    // without it the editable columns are silently read-only.
    gantt.config.keyboard_navigation = true;
    gantt.config.keyboard_navigation_cells = true;
    gantt.config.row_height = 38;
    gantt.config.bar_height = 26;
    gantt.config.columns = [
      {
        name: 'text',
        label: 'Attività',
        tree: true,
        width: 190,
        resize: true,
        editor: { type: 'text', map_to: 'text' },
      },
      {
        name: 'resource_id',
        label: 'Risorsa',
        width: 108,
        align: 'center',
        resize: true,
        // A summary aggregates whoever works on its children, so it names none.
        template: (task) =>
          task.is_summary ? '<span class="gantt-derived">—</span>' : resourceLabel(task.resource_id as string | undefined),
        editor: { type: 'select', map_to: 'resource_id', options: resourceOptions() },
      },
      {
        name: 'nominal_days',
        label: 'Effort',
        width: 62,
        align: 'center',
        resize: true,
        template: (task) =>
          task.is_summary
            ? `<span class="gantt-derived">${Number(task.rolled_effort_days).toFixed(2)}g</span>`
            : `${task.nominal_days}g`,
        editor: { type: 'number', map_to: 'nominal_days', min: 0, max: 999 },
      },
      {
        name: 'elapsed_days',
        label: 'Durata',
        width: 68,
        align: 'center',
        resize: true,
        // Highlighted when sharing stretched the task beyond its effort.
        template: (task) =>
          `<span class="${task.is_summary ? 'gantt-derived' : task.shared ? 'gantt-stretched' : ''}">${Number(task.elapsed_days).toFixed(2)}g</span>`,
      },
      {
        name: 'start_date',
        label: 'Inizio',
        width: 84,
        align: 'center',
        resize: true,
        template: (task) =>
          task.is_summary
            ? `<span class="gantt-derived">${shortDate(task.start_date as Date)}</span>`
            : shortDate(task.start_date as Date),
        editor: { type: 'date', map_to: 'start_date' },
      },
      {
        name: 'end_date',
        label: 'Fine',
        width: 84,
        align: 'center',
        resize: true,
        template: (task) => shortDate(task.end_date as Date),
      },
      {
        name: 'color',
        label: 'Colore',
        width: 62,
        align: 'center',
        resize: true,
        template: (task) =>
          `<span class="gantt-swatch${task.owns_color ? '' : ' gantt-swatch--inherited'}" style="background:${String(task.bar_color || DEFAULT_BAR_COLOR)}"></span>`,
        editor: { type: 'select', map_to: 'bar_color', options: COLOR_OPTIONS },
      },
      { name: 'add', width: 40 },
    ];

    gantt.templates.task_class = (_start, _end, task) => {
      if (task.is_summary) return 'gantt-bar--summary';
      return task.shared ? 'gantt-bar--shared' : '';
    };
    // On a shared task the segments fill the bar, so the name moves outside it
    // rather than competing with the percentages for the same pixels.
    gantt.templates.task_text = (_start, _end, task) => {
      const scheduled = solvedRef.current.schedule.tasks.get(String(task.id));
      if (!scheduled) return String(task.text ?? '');
      if (!isShared(scheduled)) return String(task.text ?? '');
      // Which percentage labels fit depends on the zoom level, so ask dhtmlx for
      // the bar's actual pixel width rather than guessing from a percentage.
      const width = Number(gantt.getTaskPosition(task).width) || 0;
      const color = String(task.bar_color || DEFAULT_BAR_COLOR);
      return renderSegments(scheduled, width, color, shade(color));
    };
    gantt.templates.rightside_text = (_start, _end, task) => {
      const scheduled = solvedRef.current.schedule.tasks.get(String(task.id));
      return scheduled && isShared(scheduled) ? String(task.text ?? '') : '';
    };

    gantt.ext.zoom.init({ levels: ZOOM_LEVELS, activeLevelIndex: 1, useKey: 'ctrlKey' });
    gantt.init(container);

    const pullFromView = (id: string | number) => {
      const ganttTask = gantt.getTask(id);
      const task = projectRef.current.tasks.find((candidate) => candidate.id === String(id));
      if (!task) return;
      task.name = String(ganttTask.text ?? task.name);
      task.progress = Number(ganttTask.progress ?? 0);
      // Subtasks display an inherited colour; writing it back would freeze a copy
      // that stops following the parent.
      if (task.parentId === undefined) {
        task.color = (ganttTask.bar_color as string | undefined) || undefined;
      }
      // Effort, start and resource of a summary are rolled up from its children,
      // so writing them back would overwrite the user's leaf data with derived
      // figures the moment dhtmlx refreshes the parent row.
      if (solvedRef.current.summaryIds.has(task.id)) return;
      task.start = new Date(ganttTask.start_date as Date);
      task.resourceId = (ganttTask.resource_id as string | undefined) || undefined;
      const nominal = Number(ganttTask.nominal_days);
      if (Number.isFinite(nominal) && nominal >= 0) task.nominalDays = nominal;
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

    // dhtmlx fires onTaskDblClick for the bars but not for grid cells, so the
    // inline editors get no mouse trigger at all. A native listener on the
    // container is both deterministic and better informed: the rendered cells
    // carry data-task-id and data-column-name, so nothing has to be inferred.
    const openEditor = (event: MouseEvent) => {
      const cell = (event.target as HTMLElement | null)?.closest?.('.gantt_cell');
      const columnName = cell?.getAttribute('data-column-name');
      const taskId = cell?.closest('.gantt_row')?.getAttribute('data-task-id');
      if (!columnName || !taskId) return;
      if (!gantt.config.columns?.some((column) => column.name === columnName && column.editor)) {
        return;
      }
      // On a summary these columns show rolled-up figures. Opening the editor
      // would accept a value that the rollup then discards, so refuse instead of
      // silently ignoring what the user typed.
      if (solvedRef.current.summaryIds.has(taskId) && DERIVED_ON_SUMMARY.has(columnName)) return;
      // Colour belongs to the top-level task; subtasks inherit it, so editing it
      // there would set a value that is never read.
      // Note: the column is named `color`; `bar_color` is only what its editor
      // maps to, and `data-column-name` carries the former.
      if (columnName === 'color' && !gantt.getTask(taskId).owns_color) return;
      gantt.ext.inlineEditors.startEdit(taskId, columnName);
      // startEdit renders the field but leaves focus on the body, and the click
      // that opened it settles focus only after this handler returns — so claim
      // the field one frame later, else typing goes nowhere and a stray blur
      // closes the editor again.
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(
          '.gantt_grid_editor_placeholder input, .gantt_grid_editor_placeholder select',
        );
        field?.focus();
        if (field instanceof HTMLInputElement) field.select();
      });
    };
    // Capture phase: dhtmlx stops the dblclick before it bubbles up to the
    // container, so a listener on the bubble phase never sees a real click.
    container.addEventListener('dblclick', openEditor, true);

    const handlers = [
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
          const start = item.start_date ? new Date(item.start_date as Date) : new Date();
          start.setHours(8, 0, 0, 0);
          projectRef.current.tasks.push({
            id: key,
            name: String(item.text || 'Nuova attività'),
            nominalDays: 1,
            start,
            parentId: parent,
          });
        }
        applySolution();
        return true;
      }, undefined),
      gantt.attachEvent('onAfterTaskMove', (id, parent) => {
        if (applyingRef.current) return true;
        const task = projectRef.current.tasks.find((candidate) => candidate.id === String(id));
        if (task) {
          task.parentId = parent !== undefined && String(parent) !== '0' ? String(parent) : undefined;
        }
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
        // Deleting a summary takes its subtree with it; leaving the descendants
        // behind would keep them in the schedule as invisible rows.
        const doomed = new Set<string>([String(id)]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const task of projectRef.current.tasks) {
            if (task.parentId && doomed.has(task.parentId) && !doomed.has(task.id)) {
              doomed.add(task.id);
              grew = true;
            }
          }
        }
        projectRef.current.tasks = projectRef.current.tasks.filter((task) => !doomed.has(task.id));
        for (const task of projectRef.current.tasks) {
          task.predecessors = task.predecessors?.filter(
            (predecessorId) => !doomed.has(predecessorId),
          );
        }
        applySolution();
        return true;
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

    // dhtmlx measures its container once at init. It listens for window resize,
    // but not for the container changing size on its own — a split pane, a
    // devtools panel opening, or the error banner appearing above the chart.
    const observer = new ResizeObserver(() => gantt.setSizes());
    observer.observe(container);

    return () => {
      observer.disconnect();
      container.removeEventListener('dblclick', openEditor, true);
      handlers.forEach((handlerId) => gantt.detachEvent(handlerId));
      // Deliberately no destructor(): it leaves the singleton unusable, and
      // StrictMode's mount/unmount/mount would then re-init a dead instance
      // ("cannot read tasksStore"). The Community build has no
      // getGanttInstance(), so there is exactly one gantt for the whole app.
      gantt.clearAll();
    };
  }, [applySolution, loadProject]);

  return <div ref={host} className="gantt-host" />;
}
