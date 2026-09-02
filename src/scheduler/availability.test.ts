import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, WorkingCalendar } from './calendar';
import { schedule } from './simulate';
import type { CalendarSpec } from './calendar';
import type { Resource, Task } from './types';

const MINUTES_PER_DAY = 8 * 60;
/** Monday 7 September 2026. */
const MONDAY = new Date(2026, 8, 7, 8, 0);
const day = (offset: number, hour = 8) => new Date(2026, 8, 7 + offset, hour, 0);
const days = (count: number) => count * MINUTES_PER_DAY;

function run(tasks: Task[], resources: Resource[], calendar: CalendarSpec = DEFAULT_CALENDAR) {
  return schedule(tasks, resources, { origin: MONDAY, calendar });
}

const elapsedDays = (result: ReturnType<typeof run>, id: string) =>
  result.tasks.get(id)!.elapsedWorkingMinutes / MINUTES_PER_DAY;

const alice: Resource = { id: 'alice', name: 'Alice' };

describe('company shutdowns', () => {
  const withHolidays = (holidays: { from: string; to: string }[]): CalendarSpec => ({
    ...DEFAULT_CALENDAR,
    holidays,
  });

  it('pushes the end date past a single closed day', () => {
    // Wednesday 9 September is closed, so 3 days of work end on Thursday.
    const result = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [alice],
      withHolidays([{ from: '2026-09-09', to: '2026-09-09' }]),
    );
    expect(elapsedDays(result, 'a')).toBe(3);
    expect(result.tasks.get('a')!.end).toEqual(day(3, 17));
  });

  it('costs nothing when the closure falls on a weekend', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(5), startConstraint: MONDAY, resourceId: 'alice' }],
      [alice],
      withHolidays([{ from: '2026-09-12', to: '2026-09-13' }]),
    );
    // Still Monday to Friday.
    expect(result.tasks.get('a')!.end).toEqual(day(4, 17));
  });

  it('skips a multi-day shutdown', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(4), startConstraint: MONDAY, resourceId: 'alice' }],
      [alice],
      // Tuesday to Thursday closed: work runs Monday, then Friday and the next
      // Monday and Tuesday.
      withHolidays([{ from: '2026-09-08', to: '2026-09-10' }]),
    );
    expect(result.tasks.get('a')!.end).toEqual(day(8, 17));
  });

  it('keeps the axis consistent in both directions', () => {
    const calendar = new WorkingCalendar(
      MONDAY,
      withHolidays([{ from: '2026-09-09', to: '2026-09-09' }]),
    );
    // Wednesday is closed, so Thursday is the third working day.
    expect(calendar.toWorkingMinutes(day(3))).toBe(days(2));
    expect(calendar.fromWorkingMinutes(days(2), 'start')).toEqual(day(3));
    // A date inside the shutdown rounds forward to the next working minute.
    expect(calendar.toWorkingMinutes(day(2, 10))).toBe(days(2));
  });

  it('does not let a shutdown change the effort', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' }],
      [alice],
      withHolidays([{ from: '2026-09-08', to: '2026-09-08' }]),
    );
    // Two days of work remain two days of work; only the calendar span grows.
    expect(elapsedDays(result, 'a')).toBe(2);
  });
});

describe('personal absences', () => {
  it('suspends the task and resumes it after the absence', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-09', to: '2026-09-09', availability: 0 }] }],
      );
    // Monday and Tuesday worked, Wednesday off, Thursday finishes it: the span
    // covers 4 working days for 3 days of work.
    expect(elapsedDays(result, 'a')).toBe(4);
    expect(result.tasks.get('a')!.end).toEqual(day(3, 17));
  });

  it('leaves a gap in the allocation profile', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-09', to: '2026-09-09', availability: 0 }] }],
    );
    const segments = result.tasks.get('a')!.segments;
    expect(segments).toHaveLength(2);
    // Two working days before the absence, one after, and nothing during it.
    expect(segments[0].endWorkingMinutes).toBe(days(2));
    expect(segments[1].startWorkingMinutes).toBe(days(3));
    const burnt = segments.reduce(
      (total, segment) =>
        total + segment.rate * (segment.endWorkingMinutes - segment.startWorkingMinutes),
      0,
    );
    expect(burnt).toBeCloseTo(days(3), 6);
  });

  it('delays the start when the absence covers it', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-08', availability: 0 }] }],
    );
    // Monday and Tuesday are off, so work starts Wednesday.
    expect(result.tasks.get('a')!.start).toEqual(day(2));
    expect(elapsedDays(result, 'a')).toBe(1);
  });

  it('only affects the person who is away', () => {
    const result = run(
      [
        { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
        { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'bob' },
      ],
      [
        { ...alice, availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-08', availability: 0 }] },
        { id: 'bob', name: 'Bob' },
      ],
    );
    expect(elapsedDays(result, 'a')).toBe(3);
    expect(elapsedDays(result, 'b')).toBe(2);
  });

  it('pauses every task sharing the resource, without changing the split', () => {
    const result = run(
      [
        { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
        { id: 'b', name: 'B', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      ],
      // Tuesday off, in the middle of the two days these tasks would take.
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-08', availability: 0 }] }],
    );
    // A day of effort each at 50% is two working days, and the absence adds one.
    expect(elapsedDays(result, 'a')).toBe(3);
    expect(elapsedDays(result, 'b')).toBe(3);
    // Both were still at 50% before and after: the absence pauses, it does not
    // hand one task the other's share.
    for (const id of ['a', 'b']) {
      for (const segment of result.tasks.get(id)!.segments) {
        expect(segment.rate).toBe(0.5);
      }
    }
  });

  it('costs nothing when the absence falls on a weekend', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(5), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-12', to: '2026-09-13', availability: 0 }] }],
    );
    expect(elapsedDays(result, 'a')).toBe(5);
  });

  it('handles an absence spanning more than a week', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-21', availability: 0 }] }],
    );
    // One day Monday, then away until 21 September; work resumes on the 22nd.
    expect(result.tasks.get('a')!.end).toEqual(new Date(2026, 8, 22, 17, 0));
  });

  it('combines with partial availability', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availability: 0.5, availabilityOverrides: [{ from: '2026-09-09', to: '2026-09-09', availability: 0 }] }],
    );
    // 2 days of effort at 50% is 4 working days, plus the day off.
    expect(elapsedDays(result, 'a')).toBe(5);
  });

  it('reports a task whose resource is never available', () => {
    expect(() =>
      run(
        [{ id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' }],
        [{ ...alice, availability: 0 }],
      ),
    ).toThrow(/no active task received capacity/);
  });
});

describe('availability that varies over time', () => {
  it('applies a reduced rate for the period and the default outside it', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      // Monday and Tuesday at 25%, full time from Wednesday.
      [
        {
          ...alice,
          availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-08', availability: 0.25 }],
        },
      ],
    );
    const segments = result.tasks.get('a')!.segments;
    expect(segments.map((segment) => segment.rate)).toEqual([0.25, 1]);
    // 0.5 days burnt over the two slow days, 2.5 left at full rate.
    expect(elapsedDays(result, 'a')).toBeCloseTo(4.5, 9);
  });

  it('overrides the default availability rather than multiplying it', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' }],
      [
        {
          ...alice,
          availability: 0.5,
          availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-11', availability: 0.25 }],
        },
      ],
    );
    // 25%, not 12.5%: the period replaces the default for its duration.
    expect(result.tasks.get('a')!.segments[0].rate).toBe(0.25);
    expect(elapsedDays(result, 'a')).toBe(4);
  });

  it('compounds a reduced period with the split between tasks', () => {
    const result = run(
      [
        { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
        { id: 'b', name: 'B', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      ],
      [
        {
          ...alice,
          availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-30', availability: 0.5 }],
        },
      ],
    );
    // Half a person split two ways is a quarter each.
    expect(result.tasks.get('a')!.segments[0].rate).toBe(0.25);
    expect(elapsedDays(result, 'a')).toBe(4);
  });

  it('lets a later override win over an earlier one that overlaps', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' }],
      [
        {
          ...alice,
          availabilityOverrides: [
            // A broad half-time spell, then one day carved out of it as leave.
            { from: '2026-09-07', to: '2026-09-30', availability: 0.5 },
            { from: '2026-09-08', to: '2026-09-08', availability: 0 },
          ],
        },
      ],
    );
    const rates = result.tasks.get('a')!.segments.map((segment) => segment.rate);
    // Monday at 50%, Tuesday away, back to 50% afterwards.
    expect(rates).toEqual([0.5, 0.5]);
    expect(result.tasks.get('a')!.segments[0].endWorkingMinutes).toBe(days(1));
    expect(result.tasks.get('a')!.segments[1].startWorkingMinutes).toBe(days(2));
  });

  it('treats a zero override exactly like an absence', () => {
    const away = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [
        {
          ...alice,
          availabilityOverrides: [{ from: '2026-09-09', to: '2026-09-09', availability: 0 }],
        },
      ],
    );
    expect(elapsedDays(away, 'a')).toBe(4);
  });

  it('conserves effort across changing rates', () => {
    const effort = days(4);
    const result = run(
      [{ id: 'a', name: 'A', effort, startConstraint: MONDAY, resourceId: 'alice' }],
      [
        {
          ...alice,
          availabilityOverrides: [
            { from: '2026-09-08', to: '2026-09-09', availability: 0.25 },
            { from: '2026-09-10', to: '2026-09-11', availability: 0 },
          ],
        },
      ],
    );
    const burnt = result.tasks
      .get('a')!
      .segments.reduce(
        (total, segment) =>
          total + segment.rate * (segment.endWorkingMinutes - segment.startWorkingMinutes),
        0,
      );
    expect(burnt).toBeCloseTo(effort, 6);
  });
});

describe('shutdowns and absences together', () => {
  it('does not double-count an absence inside a shutdown', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ ...alice, availabilityOverrides: [{ from: '2026-09-09', to: '2026-09-09', availability: 0 }] }],
      // The same Wednesday is already closed for everybody.
      { ...DEFAULT_CALENDAR, holidays: [{ from: '2026-09-09', to: '2026-09-09' }] },
    );
    // The closure alone accounts for the day; the absence adds nothing.
    expect(elapsedDays(result, 'a')).toBe(3);
    expect(result.tasks.get('a')!.end).toEqual(day(3, 17));
  });
});

describe('isWorkingDate', () => {
  const calendar = (spec: CalendarSpec = DEFAULT_CALENDAR) => new WorkingCalendar(MONDAY, spec);

  it('accepts a working weekday and refuses the weekend', () => {
    const subject = calendar();
    expect(subject.isWorkingDate(day(0))).toBe(true);
    // Saturday 12 and Sunday 13 September 2026.
    expect(subject.isWorkingDate(day(5))).toBe(false);
    expect(subject.isWorkingDate(day(6))).toBe(false);
  });

  it('refuses a company shutdown', () => {
    const subject = calendar({
      ...DEFAULT_CALENDAR,
      holidays: [{ from: '2026-09-09', to: '2026-09-10' }],
    });
    expect(subject.isWorkingDate(day(1))).toBe(true);
    expect(subject.isWorkingDate(day(2))).toBe(false);
    expect(subject.isWorkingDate(day(3))).toBe(false);
    expect(subject.isWorkingDate(day(4))).toBe(true);
  });

  it('follows a shortened working week', () => {
    const subject = calendar({ ...DEFAULT_CALENDAR, workingDays: [1, 2, 3] });
    expect(subject.isWorkingDate(day(2))).toBe(true);
    expect(subject.isWorkingDate(day(3))).toBe(false);
  });

  // The time of day is irrelevant: a working day is a whole calendar day.
  it('ignores the time of day', () => {
    expect(calendar().isWorkingDate(day(0, 23))).toBe(true);
  });
});
