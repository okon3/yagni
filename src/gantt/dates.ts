/**
 * The one place a date becomes text and text becomes a date.
 *
 * Everything outside the model — the file, the agent API — speaks
 * `YYYY-MM-DDTHH:mm` in local wall clock. Anything that reaches for `Date`'s own
 * parsing or `toISOString` shifts the value into UTC, which in any positive
 * offset moves an 08:00 start to the previous day and silently rewrites the
 * schedule.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function serializeDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Null rather than a thrown error: the file format and the API each report a
 * bad date in their own vocabulary, and neither should import the other's.
 */
export function parseWallClock(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(date.getTime()) ? null : date;
}
