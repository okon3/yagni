import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { CalendarSpec, Resource } from './scheduler';
import { GanttChart, INITIAL_SCALE_LABEL, type GanttHandle } from './gantt/GanttChart';
import { COLOR_OPTIONS } from './gantt/colors';
import { CalendarDialog } from './gantt/CalendarDialog';
import { ConfirmDialog } from './gantt/ConfirmDialog';
import { EmptyState } from './gantt/EmptyState';
import { HelpDialog } from './gantt/HelpDialog';
import { ResourceDialog } from './gantt/ResourceDialog';
import { TaskDialog, type TaskDetails, type TaskPatch } from './gantt/TaskDialog';
import { createAgentApi } from './gantt/agentApi';
import { StatusBar } from './gantt/StatusBar';
import { Toolbar } from './gantt/Toolbar';
import { PROJECT_EXTENSION, downloadText, pickTextFile } from './gantt/files';
import { DEFAULT_CALENDAR } from './scheduler';
import { emptyProject } from './gantt/project';
import { ProjectFileError, deserializeProject, serializeProject } from './gantt/serialization';
import './App.css';

const DEFAULT_FILENAME = `progetto${PROJECT_EXTENSION}`;
const initialProject = emptyProject();

export default function App() {
  const chart = useRef<GanttHandle>(null);
  const [filename, setFilename] = useState(DEFAULT_FILENAME);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState(initialProject.tasks.length);
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(INITIAL_SCALE_LABEL);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [people, setPeople] = useState<Resource[]>(initialProject.resources);
  // Two sources for one highlight: the toolbar pins a person until they are
  // unpinned, an avatar under the pointer borrows it for as long as it is there.
  const [pinnedResource, setPinnedResource] = useState<string | null>(null);
  const [hoveredResource, setHoveredResource] = useState<string | null>(null);
  // One question at a time, held with the promise that is waiting on it.
  const [question, setQuestion] = useState<{
    message: string;
    confirmLabel: string;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Snapshotted on open, like the other dialogs: the chart owns the live task.
  const [openTask, setOpenTask] = useState<{
    details: TaskDetails;
    resources: Resource[];
  } | null>(null);
  const [calendarSnapshot, setCalendarSnapshot] = useState<CalendarSpec>(DEFAULT_CALENDAR);
  // Snapshotted when the dialog opens: the chart owns the live project, and
  // reading it on every render would fight the imperative handle.
  const [resourceSnapshot, setResourceSnapshot] = useState<{
    resources: Resource[];
    taskCounts: Map<string, number>;
  }>({ resources: [], taskCounts: new Map() });

  /**
   * Pulls back out of the chart whatever the toolbar and the status bar show.
   *
   * The chart owns the project, so this runs after everything that can change
   * it — a dialog, a drag, a script — rather than only where a person is edited.
   * A pinned person who is no longer in the plan is dropped here: the file that
   * was just opened knows nothing about them.
   */
  const syncFromChart = useCallback(() => {
    const project = chart.current?.getProject();
    setTaskCount(project?.tasks.length ?? 0);
    const resources = project?.resources ?? [];
    setPeople([...resources]);
    setPinnedResource((pinned) =>
      pinned && resources.some((resource) => resource.id === pinned) ? pinned : null,
    );
  }, []);

  const ask = useCallback(
    (message: string, confirmLabel: string) =>
      new Promise<boolean>((resolve) => setQuestion({ message, confirmLabel, resolve })),
    [],
  );

  const answer = useCallback(
    (confirmed: boolean) => {
      question?.resolve(confirmed);
      setQuestion(null);
    },
    [question],
  );

  const confirmDiscard = useCallback(
    async () => !dirty || ask('Ci sono modifiche non salvate. Continuare?', 'Continua'),
    [ask, dirty],
  );

  const adopt = useCallback(
    (text: string, name: string) => {
      // Parse before loading: a malformed file must leave the open project alone.
      const parsed = deserializeProject(text);
      chart.current?.loadProject(parsed);
      setFilename(name);
      setDirty(false);
      setError(null);
      syncFromChart();
    },
    [syncFromChart],
  );

  const reportFailure = useCallback((cause: unknown) => {
    setError(
      cause instanceof ProjectFileError
        ? cause.message
        : `Impossibile leggere il file: ${String(cause)}`,
    );
  }, []);

  /** Everything the New button does except ask. The agent API takes it as is. */
  const reset = useCallback(() => {
    chart.current?.loadProject(emptyProject());
    setFilename(DEFAULT_FILENAME);
    setDirty(false);
    setError(null);
    syncFromChart();
  }, [syncFromChart]);

  const handleNew = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    reset();
  }, [confirmDiscard, reset]);

  const handleOpen = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    try {
      const picked = await pickTextFile();
      if (!picked) return;
      adopt(picked.text, picked.name);
    } catch (cause) {
      reportFailure(cause);
    }
  }, [adopt, confirmDiscard, reportFailure]);

  const handleSave = useCallback(() => {
    const project = chart.current?.getProject();
    if (!project) return;
    downloadText(filename, serializeProject(project));
    setDirty(false);
  }, [filename]);

  const handleAddTask = useCallback(() => {
    chart.current?.addTask();
    syncFromChart();
  }, [syncFromChart]);

  const openTaskDetails = useCallback((id: string) => {
    const handle = chart.current;
    const details = handle?.getTaskDetails(id);
    if (!handle || !details) return;
    setOpenTask({ details, resources: handle.getResources() });
  }, []);

  const saveTaskDetails = useCallback(
    (patch: TaskPatch) => {
      if (!openTask) return;
      chart.current?.updateTask(openTask.details.id, patch);
      setOpenTask(null);
      setDirty(true);
    },
    [openTask],
  );

  /**
   * Shared by the dialog's button and the Del key, so both ask the same thing:
   * a leaf goes without a question, a group announces what it takes with it.
   */
  const requestDelete = useCallback(
    async (id: string) => {
      const handle = chart.current;
      const details = handle?.getTaskDetails(id);
      if (!handle || !details) return;
      if (details.descendantCount > 0) {
        const subtasks =
          details.descendantCount === 1
            ? 'la sua sottoattività'
            : `le sue ${details.descendantCount} sottoattività`;
        if (!(await ask(`Elimino "${details.name}" e ${subtasks}?`, 'Elimina'))) return;
      }
      handle.deleteTask(id);
      setOpenTask(null);
      setDirty(true);
      syncFromChart();
    },
    [ask, syncFromChart],
  );

  const openResources = useCallback(() => {
    const handle = chart.current;
    if (!handle) return;
    setResourceSnapshot({
      resources: handle.getResources(),
      taskCounts: handle.countTasksByResource(),
    });
    setCalendarSnapshot(handle.getCalendar());
    setResourcesOpen(true);
  }, []);

  const openCalendar = useCallback(() => {
    const handle = chart.current;
    if (!handle) return;
    setCalendarSnapshot(handle.getCalendar());
    setCalendarOpen(true);
  }, []);

  const saveCalendar = useCallback((calendar: CalendarSpec) => {
    chart.current?.setCalendar(calendar);
    setCalendarOpen(false);
    setDirty(true);
  }, []);

  const saveResources = useCallback((resources: Resource[], releasedIds: string[]) => {
    chart.current?.setResources(resources, releasedIds);
    setResourcesOpen(false);
    setDirty(true);
  }, []);

  // The scripting surface mounts here rather than in the chart: filename, dirty
  // and the task count are this component's state, and every write has to leave
  // them as honest as a dialog callback does.
  //
  // The changing values are read through a ref, so the object can be built once:
  // closing over `filename` would go stale on the first rename. Registered in
  // production too — there is no backend and no secret in the page, and gating
  // it behind DEV would make it useless on the deployed site.
  const agentState = useRef({ filename, dirty, adopt, reset });
  useEffect(() => {
    agentState.current = { filename, dirty, adopt, reset };
  }, [adopt, dirty, filename, reset]);

  useEffect(() => {
    window.yagni = createAgentApi({
      handle: () => chart.current,
      filename: () => agentState.current.filename,
      dirty: () => agentState.current.dirty,
      setFilename,
      adopt: (text, name) => agentState.current.adopt(text, name),
      newProject: () => agentState.current.reset(),
    });
    console.info(
      'YAGNI: window.yagni pilota il piano da uno script. yagni.help() per la superficie completa.',
    );
  }, []);

  /**
   * The highlight follows the pointer over any avatar, in the grid or in the
   * toolbar.
   *
   * One document-wide listener rather than handlers on the avatars themselves:
   * React synthesises the enter of the element being entered while the mouseout
   * of the one being left is still dispatching, so a handler that cleared the
   * highlight on the way out would land after the one that set it and win. A
   * single mouseover cannot disagree with itself — whatever the pointer is on
   * now is the answer, which also heals a stale hover as soon as the pointer
   * moves, and dhtmlx does replace the node under it whenever it redraws a row.
   */
  useEffect(() => {
    const track = (event: MouseEvent) => {
      const avatar = (event.target as HTMLElement | null)?.closest?.('[data-resource-id]');
      setHoveredResource(avatar?.getAttribute('data-resource-id') ?? null);
    };
    // No mouseover fires for a pointer that has left the window altogether.
    const clear = () => setHoveredResource(null);
    document.addEventListener('mouseover', track);
    document.documentElement.addEventListener('mouseleave', clear);
    return () => {
      document.removeEventListener('mouseover', track);
      document.documentElement.removeEventListener('mouseleave', clear);
    };
  }, []);

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    // Without preventDefault the browser refuses the drop and opens the file.
    event.preventDefault();
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    // Moving over a child fires dragleave on the parent, so ignore anything that
    // is still inside the drop area.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  };

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!(await confirmDiscard())) return;
    try {
      adopt(await file.text(), file.name);
    } catch (cause) {
      reportFailure(cause);
    }
  };

  return (
    <main
      className={`app${dragging ? ' app--dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="app__bar">
        <h1>
          {/* One SVG for the header and the favicon, so the mark cannot drift. */}
          <img className="app__mark" src="/favicon.svg" alt="" width={20} height={20} />
          <span className="app__brand">
            YAGNI
            <span className="app__expansion">Yet Another Gantt, Now Improved</span>
          </span>
        </h1>
        <Toolbar
          filename={filename}
          dirty={dirty}
          people={people}
          pinned={pinnedResource}
          onNew={() => void handleNew()}
          onOpen={() => void handleOpen()}
          onSave={handleSave}
          onAddTask={handleAddTask}
          onEditResources={openResources}
          onEditCalendar={openCalendar}
          onHighlight={setPinnedResource}
        />
        {/* Outside the toolbar so it keeps its place when the avatars wrap. */}
        <button
          type="button"
          className="app__help"
          title="Come funziona"
          aria-label="Come funziona"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
      </header>

      {error && (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}

      <div className="app__body">
        <GanttChart
          ref={chart}
          project={initialProject}
          highlighted={hoveredResource ?? pinnedResource}
          onChange={() => {
            setDirty(true);
            syncFromChart();
          }}
          onOpenTask={openTaskDetails}
          onDeleteTask={(id) => void requestDelete(id)}
          onScaleChange={setScale}
          onReject={setError}
        />
        {taskCount === 0 && (
          <EmptyState
            onAddTask={handleAddTask}
            onOpen={() => void handleOpen()}
            onHelp={() => setHelpOpen(true)}
          />
        )}
        {dragging && <div className="app__dropzone">Rilascia il file .gantt per aprirlo</div>}
      </div>

      <StatusBar
        taskCount={taskCount}
        scale={scale}
        onCollapseAll={() => chart.current?.collapseAll()}
        onExpandAll={() => chart.current?.expandAll()}
        onToday={() => chart.current?.scrollToToday()}
        onZoomIn={() => chart.current?.zoomIn()}
        onZoomOut={() => chart.current?.zoomOut()}
        onZoomToFit={() => chart.current?.zoomToFit()}
      />

      {resourcesOpen && (
        <ResourceDialog
          resources={resourceSnapshot.resources}
          usage={{ taskCounts: resourceSnapshot.taskCounts }}
          workingWeekdays={calendarSnapshot.workingDays}
          confirm={ask}
          onCancel={() => setResourcesOpen(false)}
          onSave={saveResources}
        />
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {calendarOpen && (
        <CalendarDialog
          calendar={calendarSnapshot}
          onCancel={() => setCalendarOpen(false)}
          onSave={saveCalendar}
        />
      )}

      {question && (
        <ConfirmDialog
          message={question.message}
          confirmLabel={question.confirmLabel}
          onResolve={answer}
        />
      )}

      {openTask && (
        <TaskDialog
          task={openTask.details}
          resources={openTask.resources}
          colors={COLOR_OPTIONS}
          onCancel={() => setOpenTask(null)}
          onSave={saveTaskDetails}
          onDelete={() => void requestDelete(openTask.details.id)}
        />
      )}
    </main>
  );
}
