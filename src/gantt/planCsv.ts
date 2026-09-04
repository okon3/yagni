import type { Resource } from '../scheduler';
import { formatDays } from './format';
import type { Plan, PlanTask } from './plan';

/**
 * The solved plan as a spreadsheet reads it.
 *
 * Built from `Plan` rather than from the schedule, which is what keeps the day
 * boundary honest: `buildPlan` has already chosen a side for every instant, and
 * this only reshapes the strings it produced. Nothing here converts working
 * minutes a second time.
 *
 * The dialect is the one Excel expects in the locale this application speaks:
 * `;` as the separator, a comma for decimals, CRLF, and a BOM so accented names
 * survive the default import. A file that needs a wizard to open is not an
 * export.
 */

const SEPARATOR = ';';
const NEWLINE = '\r\n';
/** U+FEFF, spelled out rather than pasted: an invisible character in a source file. */
const BOM = String.fromCharCode(0xfeff);

const HEADERS = [
  'Id',
  'Attività',
  'Livello',
  'Riepilogo',
  'Persona',
  'Inizio',
  'Fine',
  'Effort (g)',
  'Durata (g)',
  'Contesa',
  'Predecessori',
];

/** `YYYY-MM-DDTHH:mm` as the day comes first here, purely textual. */
function localDateTime(wallClock: string): string {
  const [date, time] = wallClock.split('T');
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} ${time}`;
}

/** Decimal comma, or the figure lands in a text cell nobody can sum. */
function decimal(days: number): string {
  return formatDays(days).replace('.', ',');
}

function escape(value: string): string {
  if (!/[;"\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function row(task: PlanTask, nameOfResource: (id: string) => string): string[] {
  return [
    task.id,
    task.name,
    String(task.depth + 1),
    // A summary's effort is the rollup of its children's, so a column summed
    // without this flag counts every leaf twice.
    task.isSummary ? 'sì' : '',
    task.resourceId ? nameOfResource(task.resourceId) : '',
    localDateTime(task.start),
    localDateTime(task.end),
    decimal(task.effortDays),
    decimal(task.elapsedDays),
    task.shared ? 'sì' : '',
    task.predecessors.join(' '),
  ];
}

export function planToCsv(plan: Plan, resources: Resource[]): string {
  const names = new Map(resources.map((resource) => [resource.id, resource.name]));
  // An id with no resource behind it cannot reach here — the file, the dialogs
  // and the agent API all refuse one — so falling back to the id is a last
  // resort rather than a case.
  const nameOfResource = (id: string) => names.get(id) ?? id;
  const lines = [HEADERS, ...plan.tasks.map((task) => row(task, nameOfResource))];
  return BOM + lines.map((line) => line.map(escape).join(SEPARATOR)).join(NEWLINE) + NEWLINE;
}
