import { useCallback, useRef, useState, type DragEvent } from 'react';
import type { CalendarSpec, Resource } from './scheduler';
import { GanttChart, INITIAL_SCALE_LABEL, type GanttHandle } from './gantt/GanttChart';
import { COLOR_OPTIONS } from './gantt/colors';
import { CalendarDialog } from './gantt/CalendarDialog';
import { EmptyState } from './gantt/EmptyState';
import { ResourceDialog } from './gantt/ResourceDialog';
import { TaskDialog, type TaskDetails, type TaskPatch } from './gantt/TaskDialog';
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

  const syncCount = useCallback(() => {
    setTaskCount(chart.current?.getProject().tasks.length ?? 0);
  }, []);

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm('Ci sono modifiche non salvate. Continuare?'),
    [dirty],
  );

  const adopt = useCallback(
    (text: string, name: string) => {
      // Parse before loading: a malformed file must leave the open project alone.
      const parsed = deserializeProject(text);
      chart.current?.loadProject(parsed);
      setFilename(name);
      setDirty(false);
      setError(null);
      syncCount();
    },
    [syncCount],
  );

  const reportFailure = useCallback((cause: unknown) => {
    setError(
      cause instanceof ProjectFileError
        ? cause.message
        : `Impossibile leggere il file: ${String(cause)}`,
    );
  }, []);

  const handleNew = useCallback(() => {
    if (!confirmDiscard()) return;
    chart.current?.loadProject(emptyProject());
    setFilename(DEFAULT_FILENAME);
    setDirty(false);
    setError(null);
    syncCount();
  }, [confirmDiscard, syncCount]);

  const handleOpen = useCallback(async () => {
    if (!confirmDiscard()) return;
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
    syncCount();
  }, [syncCount]);

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
    if (!confirmDiscard()) return;
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
          onNew={handleNew}
          onOpen={handleOpen}
          onSave={handleSave}
          onAddTask={handleAddTask}
          onEditResources={openResources}
          onEditCalendar={openCalendar}
        />
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
          onChange={() => {
            setDirty(true);
            syncCount();
          }}
          onOpenTask={openTaskDetails}
          onScaleChange={setScale}
        />
        {taskCount === 0 && (
          <EmptyState
            onAddTask={handleAddTask}
            onOpen={handleOpen}
            onEditResources={openResources}
          />
        )}
        {dragging && <div className="app__dropzone">Rilascia il file .gantt per aprirlo</div>}
      </div>

      <StatusBar
        taskCount={taskCount}
        scale={scale}
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
          onCancel={() => setResourcesOpen(false)}
          onSave={saveResources}
        />
      )}

      {calendarOpen && (
        <CalendarDialog
          calendar={calendarSnapshot}
          onCancel={() => setCalendarOpen(false)}
          onSave={saveCalendar}
        />
      )}

      {openTask && (
        <TaskDialog
          task={openTask.details}
          resources={openTask.resources}
          colors={COLOR_OPTIONS}
          onCancel={() => setOpenTask(null)}
          onSave={saveTaskDetails}
        />
      )}
    </main>
  );
}
