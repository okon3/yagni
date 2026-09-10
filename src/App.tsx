import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { CircleHelp } from 'lucide-react';
// ?inline: as a data URI the mark survives even a lone single-file index.html,
// where a URL beside the page would have nothing to point at.
import markUrl from './assets/favicon.svg?inline';
import type { CalendarSpec, Resource } from './scheduler';
import { GanttChart } from './gantt/GanttChart';
import { INITIAL_SCALE_LABEL } from './gantt/zoomLevels';
import type { GanttHandle } from './gantt/ganttHandle';
import { COLOR_OPTIONS } from './gantt/colors';
import { CalendarDialog } from './gantt/CalendarDialog';
import { ChangelogDialog } from './gantt/ChangelogDialog';
import { CHANGELOG_ENTRIES } from './gantt/changelogEntries';
import { ConfirmDialog } from './gantt/ConfirmDialog';
import { EmptyState } from './gantt/EmptyState';
import { HelpDialog } from './gantt/HelpDialog';
import { ResourceDialog } from './gantt/ResourceDialog';
import { TaskDialog } from './gantt/TaskDialog';
import type { TaskDetails, TaskPatch } from './gantt/ganttHandle';
import { createAgentApi } from './gantt/agentApi';
import { buildPlan } from './gantt/plan';
import { planToCsv } from './gantt/planCsv';
import { planFigure, planFigurePages } from './gantt/planFigure';
import { installPrintFigure } from './gantt/printPlan';
import { StatusBar } from './gantt/StatusBar';
import { Toolbar } from './gantt/Toolbar';
import {
  PROJECT_EXTENSION,
  downloadSvgAsPng,
  downloadText,
  exportFilename,
  pickTextFile,
} from './gantt/files';
import { DEFAULT_CALENDAR } from './scheduler';
import { emptyProject, type ChainState, type MeasuredSlack } from './gantt/project';
import { RowMenu, type RowMenuAction, type RowMenuTarget } from './gantt/RowMenu';
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
import { announces, readSeenVersion, writeSeenVersion } from './gantt/seenVersion';
import { wrapIndex } from './gantt/search';
import { keystrokeIsCaptured } from './gantt/shortcuts';
// Load-bearing order: equal-specificity per-dialog rules in App.css win by
// loading after dialog.css's generic block — the mechanism T12 uses instead of
// `!important` to override a base rule.
import './dialog.css';
import './App.css';

const DEFAULT_FILENAME = `project${PROJECT_EXTENSION}`;
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
  // Read once, before the auto-open effect can write today's version over it.
  const [seenVersionAtStart] = useState<string | null>(() => readSeenVersion(draftStore));
  const [error, setError] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState(initialProject.tasks.length);
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(INITIAL_SCALE_LABEL);
  // Off by default: the outlines read as a warning on every bar before anyone
  // asked a question, and the plan opens calmer without them. The question they
  // answer is one click away when it is actually asked.
  const [markCritical, setMarkCritical] = useState(false);
  // What the chart is actually able to show, which past the limit is not the
  // same as what is wanted: the chart reports it after every write. Its start
  // has to agree with `markCritical`, or the first click on the toggle would
  // turn off a marking that is not there.
  const [chainState, setChainState] = useState<ChainState>('off');
  // Off by default: the chart is what the plan is edited in, and the lanes are
  // what it is checked against — asked for, and taking room only then.
  const [showLoad, setShowLoad] = useState(false);
  // Display-only mirror of the chart's own collapsed flag: the width it
  // restores lives in a ref inside GanttChart (the only thing a divider drag
  // keeps current), this just says which icon the toggle should show. The two
  // can only change together — this button is the one place that calls
  // `toggleGridCollapsed`.
  const [gridCollapsed, setGridCollapsed] = useState(false);
  // Searching marks and walks; it never filters. The query is App's because the
  // matches are: the chart answers which rows match, App decides which one the
  // eye is on.
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<string[]>([]);
  // The match the chart is showing, held as an id rather than an index: the
  // list is remeasured after every edit, and a position in the old one means
  // nothing in the new.
  const [focusedMatch, setFocusedMatch] = useState<string | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
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
  const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null);
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
    async () => !dirty || ask('There are unsaved changes. Continue?', 'Continue'),
    [ask, dirty],
  );

  const reportFailure = useCallback((cause: unknown) => {
    setError(
      cause instanceof ProjectFileError
        ? cause.message
        : `Could not read the file: ${String(cause)}`,
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
      // Dropped for the same reason the history is, and the same reason a pinned
      // person is: a query aimed at the plan that was open says nothing about
      // the one that has just arrived. An undo is not an opening and keeps it.
      setSearch('');
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
    setSearch('');
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
    // The file carries the solved report for whoever reads it; `savedText` must
    // not — it is compared against the history's input-only snapshots, and a
    // report in the comparison would keep the project dirty forever.
    downloadText(filename, serializeProject(project, chart.current?.getSolved()));
    setSavedText(serializeProject(project));
  }, [filename]);

  /**
   * The solved plan, not the file: what a spreadsheet is asked for is the dates
   * and the durations the engine derived, which `.gantt` deliberately does not
   * store.
   */
  const handleExportCsv = useCallback(() => {
    const solved = chart.current?.getSolved();
    const project = chart.current?.getProject();
    if (!solved || !project) return;
    downloadText(
      exportFilename(filename, 'csv'),
      planToCsv(buildPlan(solved), project.resources),
      'text/csv;charset=utf-8',
    );
  }, [filename]);

  /**
   * A picture of the whole plan, drawn from the schedule rather than captured
   * from the chart: only the rows in view are in the DOM, so a screenshot of it
   * would be a screenful.
   */
  const handleExportPng = useCallback(async () => {
    const solved = chart.current?.getSolved();
    const project = chart.current?.getProject();
    if (!solved || !project) return;
    try {
      await downloadSvgAsPng(
        exportFilename(filename, 'png'),
        planFigure(project, solved, { title: filename, today: new Date() }),
      );
    } catch (cause) {
      setError(`Could not create the plan image: ${String(cause)}`);
    }
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

  /**
   * A creation placed against whatever the pointer was on.
   *
   * Opened on the timeline the menu carries the day under the pointer, which is
   * a start said out loud; opened on a grid row there is no date axis to point
   * at, and the row lends its own — a summary's being its rolled-up earliest.
   * Never today: a date nobody chose, beside a plan that runs in March, drags
   * the plan's own start back with it.
   */
  const createFromMenu = useCallback((target: RowMenuTarget, action: RowMenuAction) => {
    const handle = chart.current;
    const anchor = handle?.getTaskDetails(target.taskId);
    if (!handle || !anchor) return;
    const start = target.start ?? anchor.start;
    const created =
      action === 'child'
        ? handle.addTask({ parentId: target.taskId, start })
        : handle.addTask({
            after: target.taskId,
            start,
            ...(action === 'milestone' ? { name: 'New milestone', nominalDays: 0 } : {}),
          });
    handle.revealTask(created);
    handle.selectTask(created);
    syncFromChart();
  }, [syncFromChart]);

  /**
   * Flips the row's own flag through the one patch funnel every other edit
   * uses — undo, the effective (inherited) redraw and the dirty check all come
   * free from `updateTask`'s own `applySolution`, same as `saveTaskDetails`.
   * Shared by the row menu and the grid's own toggle button.
   */
  const toggleDisabled = useCallback((taskId: string, currentDisabled: boolean) => {
    const handle = chart.current;
    const details = handle?.getTaskDetails(taskId);
    if (!handle || !details) return;
    handle.updateTask(taskId, {
      name: details.name,
      nominalDays: details.nominalDays,
      start: details.start,
      resourceId: details.resourceId || undefined,
      color: details.ownsColor ? details.color : undefined,
      progress: details.progress,
      disabled: !currentDisabled,
    });
  }, []);

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
            ? 'its subtask'
            : `its ${details.descendantCount} subtasks`;
        if (!(await ask(`Delete "${details.name}" and ${subtasks}?`, 'Delete'))) return;
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

  const toggleGridCollapsed = useCallback(() => {
    chart.current?.toggleGridCollapsed();
    setGridCollapsed((collapsed) => !collapsed);
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

  /**
   * Ctrl+F puts the caret in the search field, as it does in every other
   * document, so the browser's own find does not open over the plan.
   *
   * The captured-keystroke guard makes one exception, for the field this
   * shortcut owns: pressing it again there selects the query rather than
   * handing the gesture to the browser. Everywhere else — a grid editor, a
   * dialog — the keys belong to whatever holds the focus.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'f') return;
      const field = searchField.current;
      if (!field || (keystrokeIsCaptured() && document.activeElement !== field)) return;
      event.preventDefault();
      field.focus();
      field.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * What matches, remeasured whenever the query or the plan moves.
   *
   * `history` steps on every model change — a rename, a new row, an undo, a
   * script — so a list measured against the plan as it was can never be walked
   * onto rows that have since gone. The focused match survives if it is still
   * a match, since remeasuring is not the same as starting a new search.
   */
  useEffect(() => {
    const found = chart.current?.setSearch(search) ?? [];
    setMatches(found);
    setFocusedMatch((current) =>
      current && found.includes(current) ? current : (found[0] ?? null),
    );
  }, [history, search]);

  // Landing on a match is a view change and nothing else: it opens the branches
  // above the row, brings it on screen, and selects it so Del and the details
  // button have something to act on.
  useEffect(() => {
    if (!focusedMatch) return;
    chart.current?.revealTask(focusedMatch);
    chart.current?.selectTask(focusedMatch);
  }, [focusedMatch]);

  const stepMatch = useCallback(
    (step: number) => {
      const next = wrapIndex(matches.length, matches.indexOf(focusedMatch ?? ''), step);
      if (next >= 0) setFocusedMatch(matches[next]);
    },
    [focusedMatch, matches],
  );

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
      const resume = await ask(draftQuestion(pendingDraft, new Date()), 'Resume');
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

  // Once, and only after the draft question is settled: stacking the changelog
  // on top of the ConfirmDialog would bury the question the user has to answer
  // first. A first-ever visit records the current version silently instead of
  // greeting a new user with release notes.
  //
  // Deferred a tick on purpose: this fires at most once per load (guarded by
  // the ref), so it is the settle event, not a value an earlier render could
  // have derived — the microtask just keeps the state write out of the
  // effect's own synchronous pass.
  const changelogChecked = useRef(false);
  useEffect(() => {
    if (pendingDraft !== null || changelogChecked.current) return;
    changelogChecked.current = true;
    queueMicrotask(() => {
      const latest = CHANGELOG_ENTRIES[0]?.version;
      if (announces(seenVersionAtStart, latest)) {
        setChangelogOpen(true);
      } else if (latest !== undefined) {
        writeSeenVersion(draftStore, latest);
      }
    });
  }, [pendingDraft, seenVersionAtStart]);

  // The scripting surface mounts here rather than in the chart: filename, dirty
  // and the task count are this component's state, and every write has to leave
  // them as honest as a dialog callback does.
  //
  // The changing values are read through a ref, so the object can be built once:
  // closing over `filename` would go stale on the first rename. Registered in
  // production too — there is no backend and no secret in the page, and gating
  // it behind DEV would make it useless on the deployed site.
  const agentState = useRef({ filename, dirty, adopt, reset });
  // Read when the pages are built rather than closed over, for the same reason
  // the scripting surface reads its state through a ref: a rename would leave
  // the printed title behind.
  const printTitle = useRef(filename);
  useEffect(() => {
    agentState.current = { filename, dirty, adopt, reset };
    printTitle.current = filename;
  }, [adopt, dirty, filename, reset]);

  // Printing draws the same figure the PNG does, paged: the chart itself prints
  // as the screenful the viewport holds, whatever the plan's height. The pages
  // are built when the browser asks for them, never held in state — nothing here
  // is worth redrawing on every edit.
  useEffect(
    () =>
      installPrintFigure(() => {
        const solved = chart.current?.getSolved();
        const project = chart.current?.getProject();
        if (!solved || !project) return [];
        return planFigurePages(project, solved, {
          title: printTitle.current,
          today: new Date(),
        });
      }),
    [],
  );

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
      'YAGNI: window.yagni drives the plan from a script. yagni.help() for the full surface.',
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
          <img className="app__mark" src={markUrl} alt="" width={20} height={20} />
          <span className="app__brand">
            YAGNI
            <span className="app__expansion">Yet Another Gantt, Now Improved</span>
          </span>
          {CHANGELOG_ENTRIES.length > 0 && (
            <button
              type="button"
              className="app__version"
              onClick={() => setChangelogOpen(true)}
              title="What's new in this version"
            >
              {CHANGELOG_ENTRIES[0].version}
            </button>
          )}
        </h1>
        <Toolbar
          filename={filename}
          dirty={dirty}
          people={people}
          pinned={pinnedResource}
          undoing={undoLabel(history)}
          redoing={redoLabel(history)}
          gridCollapsed={gridCollapsed}
          onNew={() => void handleNew()}
          onOpen={() => void handleOpen()}
          onSave={handleSave}
          onExportCsv={handleExportCsv}
          onExportPng={() => void handleExportPng()}
          onPrint={() => window.print()}
          onUndo={() => travel(undone)}
          onRedo={() => travel(redone)}
          onAddTask={handleAddTask}
          onEditResources={openResources}
          onEditCalendar={openCalendar}
          onHighlight={setPinnedResource}
          onToggleGridCollapsed={toggleGridCollapsed}
        />
        {/* Outside the toolbar so it keeps its place when the avatars wrap. */}
        <button
          type="button"
          className="app__help"
          title="How it works"
          aria-label="How it works"
          onClick={() => setHelpOpen(true)}
        >
          <CircleHelp size={14} />
        </button>
      </header>

      <div className="app__body">
        {error && (
          <p className="app__error" role="alert">
            {error}
          </p>
        )}
        <GanttChart
          ref={chart}
          project={initialProject}
          highlighted={hoveredResource ?? pinnedResource}
          markCritical={markCritical}
          showLoad={showLoad}
          onChainState={setChainState}
          onChange={() => {
            setError(null);
            syncFromChart();
            registerChange();
          }}
          onOpenTask={openTaskDetails}
          onRowMenu={setRowMenu}
          onToggleDisabled={toggleDisabled}
          onDeleteTask={(id) => void requestDelete(id)}
          onScaleChange={setScale}
          onReject={setError}
          suppressTooltip={rowMenu !== null}
        />
        {taskCount === 0 && (
          <EmptyState
            onAddTask={handleAddTask}
            onOpen={() => void handleOpen()}
            onHelp={() => setHelpOpen(true)}
          />
        )}
        {dragging && <div className="app__dropzone">Drop the .gantt file to open it</div>}
      </div>

      <StatusBar
        taskCount={taskCount}
        scale={scale}
        chainState={chainState}
        loadShown={showLoad}
        search={search}
        matchCount={matches.length}
        matchPosition={focusedMatch ? matches.indexOf(focusedMatch) + 1 : 0}
        searchFieldRef={searchField}
        onSearch={setSearch}
        onStepMatch={stepMatch}
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

      {rowMenu && (
        <RowMenu
          target={rowMenu}
          onDismiss={() => setRowMenu(null)}
          onPick={(action) => {
            setRowMenu(null);
            if (action === 'toggle-disabled') toggleDisabled(rowMenu.taskId, rowMenu.disabled);
            else createFromMenu(rowMenu, action);
          }}
        />
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {changelogOpen && (
        <ChangelogDialog
          onClose={() => {
            // Reachable only through the badge or the auto-open effect, both
            // gated on there being a top entry.
            writeSeenVersion(draftStore, CHANGELOG_ENTRIES[0].version);
            setChangelogOpen(false);
          }}
        />
      )}

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
