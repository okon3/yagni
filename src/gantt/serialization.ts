import {
  DEFAULT_CALENDAR,
  isDayString,
  type AvailabilityOverride,
  type CalendarSpec,
  type DayRange,
  type Resource,
} from '../scheduler';
import { parseWallClock, serializeDate } from './dates';
import type { Project, ProjectTask } from './project';
import { validateResources } from './resources';

export const FILE_FORMAT = 'gantt-effort-split';
export const FILE_VERSION = 2;

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

function parseDate(value: unknown, context: string): Date {
  if (typeof value !== 'string') throw new ProjectFileError(`${context}: missing date`);
  const date = parseWallClock(value);
  if (!date) throw new ProjectFileError(`${context}: malformed date "${value}"`);
  return date;
}

function parseDayRanges(value: unknown, context: string): DayRange[] {
  return asArray(value, context).map((entry, index) => {
    const record = asRecord(entry, `${context}[${index}]`);
    if (!isDayString(record.from) || !isDayString(record.to)) {
      throw new ProjectFileError(`${context}[${index}]: attesa una data YYYY-MM-DD`);
    }
    const range: DayRange = { from: record.from, to: record.to };
    if (typeof record.label === 'string' && record.label.length > 0) range.label = record.label;
    return range;
  });
}

export function serializeProject(project: Project): string {
  const parentIds = new Set(project.tasks.map((task) => task.parentId));
  return JSON.stringify(
    {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      calendar: project.calendar,
      resources: project.resources,
      tasks: project.tasks.map((task) => ({
        ...task,
        start: serializeDate(task.start),
        // A summary may still hold the resource it had while it was a leaf.
        // The engine ignores it, but nothing in the file says the field is
        // inert, and a reader took it for an assignment. Dropped here rather
        // than on parse, which refuses rather than repairs.
        resourceId: parentIds.has(task.id) ? undefined : task.resourceId,
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
    const overrides: AvailabilityOverride[] = [];
    // Version 1 stored absences separately; they are overrides at zero now, so
    // files written before the change still load with the same meaning.
    for (const range of record.daysOff !== undefined
      ? parseDayRanges(record.daysOff, `resources[${index}].daysOff`)
      : []) {
      overrides.push({ ...range, availability: 0 });
    }
    if (record.availabilityOverrides !== undefined) {
      const context = `resources[${index}].availabilityOverrides`;
      asArray(record.availabilityOverrides, context).forEach((entry, position) => {
        const [range] = parseDayRanges([entry], `${context}[${position}]`);
        const share = requireNumber(
          asRecord(entry, `${context}[${position}]`).availability,
          `${context}[${position}].availability`,
        );
        overrides.push({ ...range, availability: share });
      });
    }
    if (overrides.length > 0) resource.availabilityOverrides = overrides;
    return resource;
  });

  // The people list has one set of rules, and the dialogs and the agent API
  // already answer to them. A file that skips them parses a person the scheduler
  // cannot serve — capacity at zero stalls it from inside the load, with the
  // open project already replaced.
  const brokenResources = validateResources(resources);
  if (brokenResources) throw new ProjectFileError(brokenResources);

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
    if (record.color !== undefined) {
      // Now that the colour comes from a free picker rather than a fixed list,
      // the only guarantee left is the notation: anything else reaches the DOM
      // as a style the browser drops without a word.
      const color = requireString(record.color, `tasks[${index}].color`);
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        throw new ProjectFileError(`tasks[${index}]: colore non valido "${color}", atteso #rrggbb`);
      }
      task.color = color;
    }
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

  const calendar = (root.calendar as CalendarSpec | undefined) ?? DEFAULT_CALENDAR;
  if (calendar.holidays !== undefined) {
    calendar.holidays = parseDayRanges(calendar.holidays, 'calendar.holidays');
  }

  return { calendar, resources, tasks };
}
