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
import { emptyProject, type ChainState, type MeasuredSlack } from './gantt/project';
import { ProjectFileError, deserializeProject, serializeProject } from './gantt/serialization';
import {
  historyOf,
  recordedChange,
  redoLabel,
  redone,
  undoLabel,
  undone,
  type History,
} from './gantt/history';
import {
  DRAFT_DELAY,
  clearDraft,
  draftQuestion,
  localDraftStorage,
  readDraft,
  writeDraft,
  type Draft,
} from './gantt/draft';
import { keystrokeIsCaptured } from './gantt/shortcuts';
import './App.css';

const DEFAULT_FILENAME = `progetto${PROJECT_EXTENSION}`;
const initialProject = emptyProject();
const initialText = serializeProject(initialProject);
const draftStore = localDraftStorage();

export default function App() {
  const chart = useRef<GanttHandle>(null);
  const [filename, setFilename] = useState(DEFAULT_FILENAME);
  const [history, setHistory] = useState<History>(() => historyOf(initialText));
  // The project as it was last written to a file, or null when it never was.
  // Dirty is the difference between that and the present, so undoing back to
  // the saved state clears the dot instead of leaving it on for good.
  const [savedText, setSavedText] = useState<string | null>(initialText);
  const dirty = history.present.text !== savedText;
  // Read at the first render rather than in an effect: the effect that keeps
  // the draft in step with the plan clears it as soon as nothing is unsaved,
  // which on mount is the case.
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(() => readDraft(draftStore));
  const [error, setError] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState(initialProject.tasks.length);
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(INITIAL_SCALE_LABEL);
  // On by default: which tasks the end date hangs on is the first thing anybody
  // asks of a plan, and an outline costs the bars nothing they were showing.
  const [markCritical, setMarkCritical] = useState(true);
  // What the chart is actually able to show, which past the limit is not the
  // same as what is wanted: the chart reports it after every write.
  const [chainState, setChainState] = useState<ChainState>('live');
  // Off by default: the chart is what the plan is edited in, and the lanes are
  // what it is checked against — asked for, and taking room only then.
  const [showLoad, setShowLoad] = useState(false);
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
    /** Measured when the dialog opens, since the figure costs a search. */
    slack: MeasuredSlack | null;
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

  const reportFailure = useCallback((cause: unknown) => {
    setError(
      cause instanceof ProjectFileError
        ? cause.message
        : `Impossibile leggere il file: ${String(cause)}`,
    );
  }, []);

  // Mirrored in a ref because two changes can land before React re-renders, and
  // the second one would then record on top of a history it cannot see.
  const historyRef = useRef(history);
  const commitHistory = useCallback((next: History) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  /**
   * Takes a project on, from a file or from the draft, as the state to undo
   * back to.
   *
   * Opening a document resets the history rather than stacking onto it: a
   * Ctrl+Z that resurrected the previous project over the one just opened would
   * be a different file appearing in the window, and the discard question has
   * already drawn that boundary. `neverSaved` is the draft's case: work that
   * has never been written anywhere cannot arrive clean.
   */
  const adopt = useCallback(
    (text: string, name: string, options?: { neverSaved?: boolean }) => {
      // Parse before loading: a malformed file must leave the open project alone.
      const parsed = deserializeProject(text);
      chart.current?.loadProject(parsed);
      // A plan arrives shown whole, at the coarsest scale that holds it. The
      // range is three days around today until something widens it, so a file
      // whose plan starts next month opened as a chart of empty weeks with
      // every row sitting in the grid.
      //
      // Here rather than inside loadProject, which an undo shares and which has
      // to keep the window the user was looking through — and because the zoom
      // extension only ends up consistent when the fit happens after the load
      // has finished, exactly as the toolbar's own button does it.
      //
      // Collapsed first, and fitted after: what a plan opens on is its top
      // level, which is the shape of the thing rather than every leaf of it.
      // Collapsing changes which rows are drawn, never which dates the plan
      // spans, so the window it is fitted to is the same either way.
      if (parsed.tasks.length > 0) {
        chart.current?.collapseAll();
        chart.current?.zoomToFit();
      }
      // Canonical rather than the file's own bytes: the history holds what the
      // project serialises to, so that comparing it against the present is
      // comparing like with like — a version 1 file is not written back as one.
      const canonical = serializeProject(parsed);
      commitHistory(historyOf(canonical));
      setSavedText(options?.neverSaved ? null : canonical);
      setFilename(name);
      setError(null);
      syncFromChart();
    },
    [commitHistory, syncFromChart],
  );

  /** Everything the New button does except ask. The agent API takes it as is. */
  const reset = useCallback(() => {
    const fresh = emptyProject();
    chart.current?.loadProject(fresh);
    const text = serializeProject(fresh);
    commitHistory(historyOf(text));
    setSavedText(text);
    setFilename(DEFAULT_FILENAME);
    setError(null);
    syncFromChart();
  }, [commitHistory, syncFromChart]);

  /**
   * One snapshot per change, taken wherever the chart says the model moved.
   *
   * `onChange` is the single funnel: a dialog save, a bar dragged, an inline
   * edit, a link drawn and every write on `window.yagni` all reach it through
   * `applySolution`. Recording here rather than at each call site is what makes
   * the coverage a property of the code instead of a list to keep up to date.
   */
  const registerChange = useCallback(() => {
    const project = chart.current?.getProject();
    if (!project) return;
    commitHistory(recordedChange(historyRef.current, project));
  }, [commitHistory]);

  const travel = useCallback(
    (step: (from: History) => History) => {
      const next = step(historyRef.current);
      if (next === historyRef.current) return;
      try {
        // The same path a file takes, so a restored state can only be one the
        // app could have loaded in the first place.
        chart.current?.loadProject(deserializeProject(next.present.text), {
          keepViewport: true,
        });
      } catch (cause) {
        reportFailure(cause);
        return;
      }
      commitHistory(next);
      setError(null);
      syncFromChart();
    },
    [commitHistory, reportFailure, syncFromChart],
  );

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
    const text = serializeProject(project);
    downloadText(filename, text);
    setSavedText(text);
  }, [filename]);

  const handleAddTask = useCallback(() => {
    chart.current?.addTask();
    syncFromChart();
  }, [syncFromChart]);

  /**
   * What the one control does, which depends on what it is showing.
   *
   * Showing a current answer, it hides it. Showing nothing or an old answer, it
   * measures now — past the limit that is the only way the marking gets there,
   * and a click can afford what a keystroke cannot. Turning the marking on is
   * the chart's own job below the limit, so this only has to ask for the state
   * it wants.
   */
  const handleCriticalChain = useCallback(() => {
    if (chainState === 'live' || chainState === 'fresh') {
      setMarkCritical(false);
      return;
    }
    setMarkCritical(true);
    chart.current?.measureCriticalChain();
  }, [chainState]);

  const openTaskDetails = useCallback((id: string) => {
    const handle = chart.current;
    const details = handle?.getTaskDetails(id);
    if (!handle || !details) return;
    setOpenTask({
      details,
      slack: handle.getTaskSlack(id),
      resources: handle.getResources(),
    });
  }, []);

  const saveTaskDetails = useCallback(
    (patch: TaskPatch) => {
      if (!openTask) return;
      chart.current?.updateTask(openTask.details.id, patch);
      setOpenTask(null);
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
  }, []);

  const saveResources = useCallback((resources: Resource[], releasedIds: string[]) => {
    chart.current?.setResources(resources, releasedIds);
    setResourcesOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const redoing = key === 'y' || (key === 'z' && event.shiftKey);
      if (key !== 'z' && !redoing) return;
      // Inside a grid editor or a dialog field, Ctrl+Z is the field's own.
      if (keystrokeIsCaptured()) return;
      event.preventDefault();
      travel(redoing ? redone : undone);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [travel]);

  // The browser's own question, which is the only one that can still be asked
  // once the page is going away.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Safari and older Chrome still need the legacy property to show it.
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  /**
   * The unsaved plan, kept in local storage a moment after it stops moving.
   *
   * `history.present.text` is the project as it is now, so nothing is
   * serialised again here — and the debounce is what keeps a drag from writing
   * a hundred times. Only the present is persisted, never the stack: fifty
   * copies of a project would spend the origin's whole quota on states nobody
   * asked to keep across a reload.
   *
   * A clean project needs no draft, which covers Save, Open and New in one
   * rule rather than three call sites.
   */
  useEffect(() => {
    // While the question is still on screen, what is in storage is the only
    // copy of that work — clearing it there and then would lose it to a reload,
    // which is the very thing this exists to prevent.
    if (pendingDraft) return;
    if (!dirty) {
      clearDraft(draftStore);
      return;
    }
    const timer = setTimeout(
      () => writeDraft(draftStore, { filename, text: history.present.text, savedAt: Date.now() }),
      DRAFT_DELAY,
    );
    return () => clearTimeout(timer);
  }, [dirty, filename, history, pendingDraft]);

  // Asked once, and never in StrictMode's second pass: the question is a
  // promise, and a second one would leave the first waiting for an answer that
  // now belongs to the dialog on screen.
  const draftAsked = useRef(false);
  useEffect(() => {
    if (!pendingDraft || draftAsked.current) return;
    draftAsked.current = true;
    void (async () => {
      const resume = await ask(draftQuestion(pendingDraft, new Date()), 'Riprendi');
      try {
        if (resume) adopt(pendingDraft.text, pendingDraft.filename, { neverSaved: true });
        else clearDraft(draftStore);
      } catch (cause) {
        reportFailure(cause);
        clearDraft(draftStore);
      } finally {
        // Releases the autosave, which holds off until the draft is settled.
        setPendingDraft(null);
      }
    })();
  }, [adopt, ask, pendingDraft, reportFailure]);

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
          undoing={undoLabel(history)}
          redoing={redoLabel(history)}
          onNew={() => void handleNew()}
          onOpen={() => void handleOpen()}
          onSave={handleSave}
          onUndo={() => travel(undone)}
          onRedo={() => travel(redone)}
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
          markCritical={markCritical}
          showLoad={showLoad}
          onChainState={setChainState}
          onChange={() => {
            syncFromChart();
            registerChange();
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
        chainState={chainState}
        loadShown={showLoad}
        onCollapseAll={() => chart.current?.collapseAll()}
        onExpandAll={() => chart.current?.expandAll()}
        onCriticalChain={handleCriticalChain}
        onToggleLoad={() => setShowLoad((shown) => !shown)}
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
          slack={openTask.slack}
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
