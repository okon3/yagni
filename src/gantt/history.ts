import type { Project, ProjectTask } from './project';
import { deserializeProject, serializeProject } from './serialization';

/**
 * Undo as whole-project snapshots.
 *
 * `serializeProject` / `deserializeProject` already round-trip a project
 * exactly, so a snapshot is simply the file, and restoring one is the path a
 * file already takes. A command log would instead have to describe an inverse
 * for every way the project can change — a drag, an inline edit, a dialog, a
 * script — and each new one is a chance to forget one. An undo that misses an
 * edit is worse than no undo at all.
 *
 * The stack is bounded because a snapshot is the whole project: fifty of them
 * is a few hundred kilobytes, which is nothing, while an unbounded stack grows
 * for as long as the tab is open.
 */
export const HISTORY_LIMIT = 50;

/** What the button says when the change cannot be named more precisely. */
export const GENERIC_CHANGE = 'last change';

export interface Snapshot {
  /** The project as `.gantt` text. */
  text: string;
  /** What the change that produced this state did, for the button's title. */
  label: string;
}

export interface History {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
}

/** A history holding one state and nothing to undo, for a project just loaded. */
export function historyOf(text: string): History {
  return { past: [], present: { text, label: '' }, future: [] };
}

/**
 * Records the project as it is now, on top of whatever is already there.
 *
 * A change that leaves the file identical costs no step: dhtmlx reports an
 * update for an inline editor closed on the value it opened with, and an undo
 * that appears to do nothing is worse than one that is not offered.
 */
export function recordedChange(history: History, project: Project): History {
  const text = serializeProject(project);
  if (text === history.present.text) return history;
  return {
    // The oldest entry goes rather than the newest: the step a person reaches
    // for is the last one they made.
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: { text, label: labelFor(history.present.text, project) },
    // Redo describes a branch that was not taken. Once the plan moves
    // somewhere else, those states can no longer be reached from here.
    future: [],
  };
}

export function undone(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redone(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** What Ctrl+Z would undo, or null when there is nothing behind the present. */
export function undoLabel(history: History): string | null {
  return history.past.length > 0 ? history.present.label || GENERIC_CHANGE : null;
}

export function redoLabel(history: History): string | null {
  const next = history.future[0];
  return next ? next.label || GENERIC_CHANGE : null;
}

function labelFor(beforeText: string, after: Project): string {
  try {
    return describeChange(deserializeProject(beforeText), after);
  } catch {
    // The label is decoration on a title attribute. A snapshot that will not
    // parse must not cost the user the edit they just made.
    return GENERIC_CHANGE;
  }
}

/** Fields a person edits on a task, parentage and dependencies apart. */
const OWN_FIELDS = ['name', 'nominalDays', 'resourceId', 'progress', 'color', 'disabled'] as const;

const nameOf = (task: ProjectTask) => task.name.trim() || 'unnamed task';
const quoted = (task: ProjectTask) => `"${nameOf(task)}"`;

/**
 * What changed between two states, in the words the undo button uses.
 *
 * One phrase per kind of change, and the first one that fits wins: an edit made
 * through the UI touches one thing at a time, and a script that changes several
 * still gets the most structural of them named.
 */
export function describeChange(before: Project, after: Project): string {
  const beforeTasks = new Map(before.tasks.map((task) => [task.id, task]));
  const afterTasks = new Map(after.tasks.map((task) => [task.id, task]));

  const added = after.tasks.filter((task) => !beforeTasks.has(task.id));
  if (added.length > 0) {
    return added.length === 1
      ? `added ${quoted(added[0])}`
      : `added ${added.length} tasks`;
  }
  const removed = before.tasks.filter((task) => !afterTasks.has(task.id));
  if (removed.length > 0) {
    return removed.length === 1
      ? `deleted ${quoted(removed[0])}`
      : `deleted ${removed.length} tasks`;
  }

  if (!equalValues(before.resources, after.resources)) {
    const knownBefore = new Set(before.resources.map((person) => person.id));
    const knownAfter = new Set(after.resources.map((person) => person.id));
    const arrived = after.resources.filter((person) => !knownBefore.has(person.id));
    const gone = before.resources.filter((person) => !knownAfter.has(person.id));
    if (arrived.length === 1 && gone.length === 0) return `added "${arrived[0].name}"`;
    if (gone.length === 1 && arrived.length === 0) return `removed "${gone[0].name}"`;
    return 'changed people';
  }
  if (!equalValues(before.calendar, after.calendar)) return 'changed calendar';

  const dependencies = countDependencies(after) - countDependencies(before);
  if (dependencies > 0) return 'added a dependency';
  if (dependencies < 0) return 'removed a dependency';

  const moved = after.tasks.filter(
    (task) => beforeTasks.get(task.id)?.parentId !== task.parentId,
  );
  if (moved.length > 0) {
    return moved.length === 1
      ? `moved ${quoted(moved[0])}`
      : `moved ${moved.length} tasks`;
  }

  const edited = after.tasks.filter((task) => {
    const was = beforeTasks.get(task.id);
    return was !== undefined && !sameOwnFields(was, task);
  });
  if (edited.length > 0) {
    return edited.length === 1
      ? `edited ${quoted(edited[0])}`
      : `edited ${edited.length} tasks`;
  }

  const beforeOrder = before.tasks.map((task) => task.id);
  const afterOrder = after.tasks.map((task) => task.id);
  if (!equalValues(beforeOrder, afterOrder)) {
    // The row that was dragged is the one whose removal leaves the two orders
    // equal: a move shifts every row it passed, so the first difference names a
    // row that only got out of the way.
    const dragged = afterOrder.find((id) =>
      equalValues(
        beforeOrder.filter((other) => other !== id),
        afterOrder.filter((other) => other !== id),
      ),
    );
    const task = dragged === undefined ? undefined : afterTasks.get(dragged);
    return task ? `reordered ${quoted(task)}` : 'reordered tasks';
  }

  // Reordered dependencies, or a rename to the same name through a path that
  // rewrote the file: something moved, and there is nothing better to say.
  return GENERIC_CHANGE;
}

function countDependencies(project: Project): number {
  return project.tasks.reduce((total, task) => total + (task.predecessors?.length ?? 0), 0);
}

function sameOwnFields(a: ProjectTask, b: ProjectTask): boolean {
  return (
    a.start.getTime() === b.start.getTime() &&
    OWN_FIELDS.every((field) => (a[field] ?? null) === (b[field] ?? null))
  );
}

/**
 * Deep equality, key order and absent-versus-undefined apart.
 *
 * Comparing two serialised objects would be shorter, but `JSON.stringify` is
 * sensitive to the order the keys were assigned in — and a task built by the
 * grid and the same task read back from a file do not agree on it.
 */
function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, index) => equalValues(entry, b[index]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysOf = (value: object) =>
    Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined);
  const keys = keysOf(a);
  if (keys.length !== keysOf(b).length) return false;
  return keys.every((key) =>
    equalValues((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
