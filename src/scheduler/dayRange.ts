const MS_PER_DAY = 86_400_000;

/** An inclusive span of whole days, as `YYYY-MM-DD`. */
export interface DayRange {
  from: string;
  to: string;
  label?: string;
}

/**
 * Days off are calendar days, not instants, so they are stored as plain
 * `YYYY-MM-DD` strings: a `Date` would carry a time and a timezone that could
 * shift a holiday onto the neighbouring day.
 */
export function isDayString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Day arithmetic goes through UTC midnights so that a DST shift cannot turn a
 * day into 23 or 25 hours and desynchronise the day index from the wall clock.
 */
export function dayIndexOf(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

export function dayIndexOfString(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

export function dayStringOf(index: number): string {
  const utc = new Date(index * MS_PER_DAY);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/** Expands ranges into day indices, tolerating reversed from/to. */
export function expandRanges(ranges: DayRange[] | undefined): Set<number> {
  const days = new Set<number>();
  for (const range of ranges ?? []) {
    if (!isDayString(range.from) || !isDayString(range.to)) continue;
    const first = dayIndexOfString(range.from);
    const last = dayIndexOfString(range.to);
    for (let day = Math.min(first, last); day <= Math.max(first, last); day++) {
      days.add(day);
    }
  }
  return days;
}

/**
 * Working days a range covers, given which weekdays are worked.
 *
 * Used to tell the user what an absence actually costs: a period falling
 * entirely on a weekend covers no working days at all.
 */
export function countWorkingDaysInRange(range: DayRange, workingWeekdays: number[]): number {
  if (!isDayString(range.from) || !isDayString(range.to)) return 0;
  const first = dayIndexOfString(range.from);
  const last = dayIndexOfString(range.to);
  if (last < first) return 0;
  const allowed = new Set(workingWeekdays);
  let count = 0;
  for (let day = first; day <= last; day++) {
    // 1970-01-01 was a Thursday.
    if (allowed.has((((day + 4) % 7) + 7) % 7)) count++;
  }
  return count;
}
