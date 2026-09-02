import { DEFAULT_CALENDAR, type CalendarSpec, type Resource } from '../scheduler';
import type { Project, ProjectTask } from './project';

export const FILE_FORMAT = 'gantt-effort-split';
export const FILE_VERSION = 1;

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

/**
 * Local wall-clock, no timezone suffix.
 *
 * `toISOString` would convert to UTC, which in any positive offset shifts an
 * 08:00 start back to the previous day and silently rewrites the schedule when
 * the file is reopened.
 */
function serializeDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function parseDate(value: unknown, context: string): Date {
  if (typeof value !== 'string') throw new ProjectFileError(`${context}: missing date`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new ProjectFileError(`${context}: malformed date "${value}"`);
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime())) throw new ProjectFileError(`${context}: invalid date "${value}"`);
  return date;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(
    {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      calendar: project.calendar,
      resources: project.resources,
      tasks: project.tasks.map((task) => ({
        ...task,
        start: serializeDate(task.start),
      })),
    },
    null,
    2,
  );
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectFileError(`${context}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new ProjectFileError(`${context}: expected a list`);
  return value;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProjectFileError(`${context}: expected a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectFileError(`${context}: expected a number`);
  }
  return value;
}

export function deserializeProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('Il file non è un JSON valido');
  }

  const root = asRecord(raw, 'file');
  if (root.format !== FILE_FORMAT) {
    throw new ProjectFileError('Il file non è un progetto di questo strumento');
  }
  const version = requireNumber(root.version, 'version');
  // Refusing a newer file beats loading it partially and dropping fields the
  // user cannot see are missing.
  if (version > FILE_VERSION) {
    throw new ProjectFileError(
      `Il file usa la versione ${version}, questa applicazione arriva alla ${FILE_VERSION}`,
    );
  }

  const resources = asArray(root.resources ?? [], 'resources').map((entry, index) => {
    const record = asRecord(entry, `resources[${index}]`);
    const resource: Resource = {
      id: requireString(record.id, `resources[${index}].id`),
      name: requireString(record.name, `resources[${index}].name`),
    };
    if (record.availability !== undefined) {
      resource.availability = requireNumber(record.availability, `resources[${index}].availability`);
    }
    return resource;
  });

  const knownResources = new Set(resources.map((resource) => resource.id));
  const seenTaskIds = new Set<string>();

  const tasks = asArray(root.tasks ?? [], 'tasks').map((entry, index) => {
    const record = asRecord(entry, `tasks[${index}]`);
    const id = requireString(record.id, `tasks[${index}].id`);
    if (seenTaskIds.has(id)) throw new ProjectFileError(`tasks[${index}]: id duplicato "${id}"`);
    seenTaskIds.add(id);

    const task: ProjectTask = {
      id,
      name: typeof record.name === 'string' ? record.name : '',
      nominalDays: Math.max(0, requireNumber(record.nominalDays, `tasks[${index}].nominalDays`)),
      start: parseDate(record.start, `tasks[${index}].start`),
    };
    if (typeof record.resourceId === 'string' && record.resourceId.length > 0) {
      // A task pointing at a deleted resource would contend with nobody and
      // silently show as unassigned; failing here surfaces the broken file.
      if (!knownResources.has(record.resourceId)) {
        throw new ProjectFileError(
          `tasks[${index}]: risorsa sconosciuta "${record.resourceId}"`,
        );
      }
      task.resourceId = record.resourceId;
    }
    if (record.predecessors !== undefined) {
      task.predecessors = asArray(record.predecessors, `tasks[${index}].predecessors`).map(
        (value, position) => requireString(value, `tasks[${index}].predecessors[${position}]`),
      );
    }
    if (record.progress !== undefined) {
      task.progress = requireNumber(record.progress, `tasks[${index}].progress`);
    }
    if (typeof record.color === 'string') task.color = record.color;
    if (typeof record.parentId === 'string' && record.parentId.length > 0) {
      task.parentId = record.parentId;
    }
    return task;
  });

  for (const task of tasks) {
    for (const predecessorId of task.predecessors ?? []) {
      if (!seenTaskIds.has(predecessorId)) {
        throw new ProjectFileError(`Il task "${task.id}" dipende da "${predecessorId}", che non esiste`);
      }
    }
    if (task.parentId !== undefined && !seenTaskIds.has(task.parentId)) {
      throw new ProjectFileError(
        `Il task "${task.id}" ha come padre "${task.parentId}", che non esiste`,
      );
    }
  }

  // A parent loop makes the tree unrenderable, so it is rejected at the door
  // rather than left to surface as a hang while scheduling.
  const parentOf = new Map(tasks.map((task) => [task.id, task.parentId]));
  for (const task of tasks) {
    const seen = new Set<string>([task.id]);
    let cursor = parentOf.get(task.id);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new ProjectFileError(`Gerarchia circolare intorno al task "${task.id}"`);
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }

  return {
    calendar: (root.calendar as CalendarSpec | undefined) ?? DEFAULT_CALENDAR,
    resources,
    tasks,
  };
}
