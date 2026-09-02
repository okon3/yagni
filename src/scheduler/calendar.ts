const MS_PER_DAY = 86_400_000;

/** Minutes from midnight. */
export interface DailyWindow {
  from: number;
  to: number;
}

export interface CalendarSpec {
  /** Working weekdays as JS `Date#getDay` indices, 0 = Sunday. */
  workingDays: number[];
  windows: DailyWindow[];
}

/** Matches the 8-12 / 13-17 working day onlinegantt.com defaults to. */
export const DEFAULT_CALENDAR: CalendarSpec = {
  workingDays: [1, 2, 3, 4, 5],
  windows: [
    { from: 8 * 60, to: 12 * 60 },
    { from: 13 * 60, to: 17 * 60 },
  ],
};

/**
 * Day arithmetic goes through UTC midnights so that a DST shift cannot turn a
 * day into 23 or 25 hours and desynchronise the day index from the wall clock.
 */
function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

function dateAtDayIndex(index: number, minuteOfDay: number): Date {
  const utc = new Date(index * MS_PER_DAY);
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    0,
    0,
  );
}

function weekdayOf(index: number): number {
  // 1970-01-01 was a Thursday.
  return (((index + 4) % 7) + 7) % 7;
}

/**
 * Maps wall-clock dates onto a linear axis of working minutes and back.
 *
 * Collapsing nights, weekends and lunch breaks out of the time axis is what lets
 * the simulation treat resource capacity as constant: one working minute of
 * elapsed time is exactly one man-minute of capacity per full-time resource.
 */
export class WorkingCalendar {
  private readonly workingDaySet: Set<number>;
  private readonly workingDaysPerWeek: number;
  private readonly windows: DailyWindow[];
  readonly minutesPerDay: number;
  /** Normalised to the first working day at or after the requested origin. */
  private readonly originDay: number;

  constructor(origin: Date, spec: CalendarSpec = DEFAULT_CALENDAR) {
    this.workingDaySet = new Set(spec.workingDays);
    this.workingDaysPerWeek = this.workingDaySet.size;
    if (this.workingDaysPerWeek === 0) {
      throw new Error('Calendar has no working days');
    }
    this.windows = [...spec.windows].sort((a, b) => a.from - b.from);
    if (this.windows.length === 0) {
      throw new Error('Calendar has no working hours');
    }
    this.minutesPerDay = this.windows.reduce((sum, w) => sum + (w.to - w.from), 0);

    let day = dayIndex(origin);
    while (!this.workingDaySet.has(weekdayOf(day))) day++;
    this.originDay = day;
  }

  get origin(): Date {
    return dateAtDayIndex(this.originDay, this.windows[0].from);
  }

  /** Working days in `[originDay, day)`. Counts whole weeks, then scans at most six days. */
  private workingDaysBefore(day: number): number {
    const delta = day - this.originDay;
    if (delta <= 0) return 0;
    const weeks = Math.floor(delta / 7);
    let count = weeks * this.workingDaysPerWeek;
    for (let offset = weeks * 7; offset < delta; offset++) {
      if (this.workingDaySet.has(weekdayOf(this.originDay + offset))) count++;
    }
    return count;
  }

  /** Inverse of `workingDaysBefore`: the day index holding the nth working day. */
  private dayOfNthWorkingDay(n: number): number {
    const weeks = Math.floor(n / this.workingDaysPerWeek);
    let remaining = n - weeks * this.workingDaysPerWeek;
    let day = this.originDay + weeks * 7;
    while (!this.workingDaySet.has(weekdayOf(day)) || remaining > 0) {
      if (this.workingDaySet.has(weekdayOf(day))) {
        if (remaining === 0) break;
        remaining--;
      }
      day++;
    }
    return day;
  }

  private workedMinutesInDayUpTo(minuteOfDay: number): number {
    let worked = 0;
    for (const window of this.windows) {
      if (minuteOfDay <= window.from) break;
      worked += Math.min(minuteOfDay, window.to) - window.from;
    }
    return worked;
  }

  private minuteOfDayAfterWorking(minutes: number): number {
    let remaining = minutes;
    for (const window of this.windows) {
      const span = window.to - window.from;
      if (remaining < span) return window.from + remaining;
      remaining -= span;
    }
    // Exactly at the end of the day: report the closing edge rather than rolling over,
    // so a task finishing at 17:00 does not render as starting the next morning.
    return this.windows[this.windows.length - 1].to;
  }

  /** Dates falling outside working time round forward to the next working minute. */
  toWorkingMinutes(date: Date): number {
    const day = dayIndex(date);
    if (day < this.originDay) return 0;
    const minuteOfDay = date.getHours() * 60 + date.getMinutes();
    const daysPart = this.workingDaysBefore(day) * this.minutesPerDay;
    if (!this.workingDaySet.has(weekdayOf(day))) return daysPart;
    return daysPart + this.workedMinutesInDayUpTo(minuteOfDay);
  }

  /**
   * A value landing exactly on a day boundary denotes two wall-clock instants —
   * 17:00 on the day it completes and 08:00 on the next working day — separated
   * only by non-working time. `edge` picks the one the caller means: a bar ending
   * at such a value must render as closing at 17:00, a bar starting there as
   * opening at 08:00, otherwise every full-day task looks one day too long.
   */
  fromWorkingMinutes(minutes: number, edge: 'start' | 'end' = 'start'): Date {
    const clamped = Math.max(0, minutes);
    let wholeDays = Math.floor(clamped / this.minutesPerDay);
    let remainder = clamped - wholeDays * this.minutesPerDay;
    if (edge === 'end' && remainder === 0 && wholeDays > 0) {
      wholeDays--;
      remainder = this.minutesPerDay;
    }
    return dateAtDayIndex(
      this.dayOfNthWorkingDay(wholeDays),
      this.minuteOfDayAfterWorking(remainder),
    );
  }

  /** Convenience for callers that think in days, such as duration columns. */
  daysToMinutes(days: number): number {
    return days * this.minutesPerDay;
  }

  minutesToDays(minutes: number): number {
    return minutes / this.minutesPerDay;
  }
}
