import { dayIndexOf, expandRanges, type DayRange } from './dayRange';

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
  /** Company-wide shutdowns: removed from the axis, like weekends. */
  holidays?: DayRange[];
}

/** Matches the 8-12 / 13-17 working day onlinegantt.com defaults to. */
export const DEFAULT_CALENDAR: CalendarSpec = {
  workingDays: [1, 2, 3, 4, 5],
  windows: [
    { from: 8 * 60, to: 12 * 60 },
    { from: 13 * 60, to: 17 * 60 },
  ],
};

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

/** Number of entries in the sorted array that are strictly below `value`. */
function countBelow(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Maps wall-clock dates onto a linear axis of working minutes and back.
 *
 * Collapsing nights, weekends, lunch breaks and company shutdowns out of the
 * time axis is what lets the simulation treat resource capacity as constant: one
 * working minute of elapsed time is exactly one man-minute of capacity per
 * full-time resource.
 */
export class WorkingCalendar {
  private readonly workingDaySet: Set<number>;
  private readonly workingDaysPerWeek: number;
  private readonly windows: DailyWindow[];
  /**
   * Sorted day indices of holidays that would otherwise have been working days.
   * Ones falling on a weekend are dropped, or they would be subtracted twice.
   */
  private readonly holidays: number[];
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

    this.holidays = [...expandRanges(spec.holidays)]
      .filter((day) => this.workingDaySet.has(weekdayOf(day)))
      .sort((a, b) => a - b);

    let day = dayIndexOf(origin);
    while (!this.isWorkingDay(day)) day++;
    this.originDay = day;
  }

  private isWorkingDay(day: number): boolean {
    return this.workingDaySet.has(weekdayOf(day)) && countBelow(this.holidays, day + 1) === countBelow(this.holidays, day);
  }

  get origin(): Date {
    return dateAtDayIndex(this.originDay, this.windows[0].from);
  }

  /** Holidays in `[originDay, day)`. */
  private holidaysBefore(day: number): number {
    return countBelow(this.holidays, day) - countBelow(this.holidays, this.originDay);
  }

  /**
   * Working days in `[originDay, day)`.
   *
   * Whole weeks are counted arithmetically and the holidays inside the span are
   * subtracted, which keeps this O(log h) instead of walking day by day.
   */
  private workingDaysBefore(day: number): number {
    const delta = day - this.originDay;
    if (delta <= 0) return 0;
    const weeks = Math.floor(delta / 7);
    let count = weeks * this.workingDaysPerWeek;
    for (let offset = weeks * 7; offset < delta; offset++) {
      if (this.workingDaySet.has(weekdayOf(this.originDay + offset))) count++;
    }
    return count - this.holidaysBefore(day);
  }

  /** Inverse of `workingDaysBefore`: the day index holding the nth working day. */
  private dayOfNthWorkingDay(n: number): number {
    // Start from the holiday-free estimate, then keep pushing it out by however
    // many holidays the span swallowed. Each pass can only reveal holidays
    // further along, so this settles in a couple of rounds.
    let target = n;
    for (let pass = 0; pass < 64; pass++) {
      const day = this.weeklyNthWorkingDay(target);
      const skipped = this.holidaysBefore(day + 1);
      if (target === n + skipped && this.isWorkingDay(day)) return day;
      target = n + skipped;
      if (!this.isWorkingDay(day)) target++;
    }
    throw new Error('Calendar could not resolve a working day: too many holidays');
  }

  /** The nth weekly working day, ignoring holidays. */
  private weeklyNthWorkingDay(n: number): number {
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
    const day = dayIndexOf(date);
    if (day < this.originDay) return 0;
    const minuteOfDay = date.getHours() * 60 + date.getMinutes();
    const daysPart = this.workingDaysBefore(day) * this.minutesPerDay;
    if (!this.isWorkingDay(day)) return daysPart;
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

  /**
   * The opening of the working day this date falls on, or of the next one.
   *
   * A declared start is a day, not an instant: the hours a task is available to
   * run in are the calendar's, so the only part of a start anyone chooses is
   * which day it is. A Saturday collapses onto the Monday the engine would have
   * pushed it to anyway, which keeps the stored constraint and the solved start
   * the same value rather than two that agree by accident.
   *
   * Walked out day by day rather than gone through the working-minute axis,
   * which starts at the origin and therefore cannot express a day before it:
   * `dayStartInWorkingMinutes` clamps, and the origin is the earliest start the
   * plan currently has — an artefact of the plan, not a rule about dates. Going
   * through the axis turned "start this a month earlier" into "start this on
   * the day the project already starts", silently, and left a task unable to
   * move ahead of whatever is first.
   */
  startOfWorkingDay(date: Date): Date {
    let day = dayIndexOf(date);
    // A run of closed days is weekends plus the shutdowns the spec declares,
    // and both are finite — but a calendar can still be given enough holidays
    // to swallow every day there is.
    const limit = this.holidays.length * 2 + 7;
    for (let skipped = 0; !this.isWorkingDay(day); skipped++) {
      if (skipped > limit) throw new Error('Calendar has no working day to start on');
      day++;
    }
    return dateAtDayIndex(day, this.windows[0].from);
  }

  /**
   * Start of the given day on the working-minute axis.
   *
   * Days that are not working days collapse onto the next working day, which is
   * what makes an absence that falls entirely on a weekend a zero-width interval.
   */
  dayStartInWorkingMinutes(day: number): number {
    return this.workingDaysBefore(Math.max(day, this.originDay)) * this.minutesPerDay;
  }

  /**
   * Whether any work happens on the calendar day this date falls on.
   *
   * The view shades non-working days on the timeline, and asking the calendar
   * keeps weekends, working weeks and company shutdowns defined in exactly one
   * place.
   */
  isWorkingDate(date: Date): boolean {
    return this.isWorkingDay(dayIndexOf(date));
  }

  /**
   * Whether this date falls inside a company shutdown.
   *
   * Only the closures that actually cost a working day: one landing on a weekend
   * was dropped from the axis, and the view shades it as the weekend it is.
   */
  isShutdownDate(date: Date): boolean {
    const day = dayIndexOf(date);
    return countBelow(this.holidays, day + 1) !== countBelow(this.holidays, day);
  }

  /** Convenience for callers that think in days, such as duration columns. */
  daysToMinutes(days: number): number {
    return days * this.minutesPerDay;
  }

  minutesToDays(minutes: number): number {
    return minutes / this.minutesPerDay;
  }
}
