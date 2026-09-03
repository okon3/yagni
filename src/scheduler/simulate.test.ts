import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from './calendar';
import { isContended, schedule } from './simulate';
import { CyclicDependencyError, UnknownPredecessorError, type Resource, type Task } from './types';

const HOURS_PER_DAY = 8;
const MINUTES_PER_DAY = HOURS_PER_DAY * 60;

/** Monday. */
const MONDAY = new Date(2026, 8, 7, 8, 0);
const day = (offset: number, hour = 8) => new Date(2026, 8, 7 + offset, hour, 0);
const days = (count: number) => count * MINUTES_PER_DAY;

const alice: Resource = { id: 'alice', name: 'Alice' };
const bob: Resource = { id: 'bob', name: 'Bob' };

function run(tasks: Task[], resources: Resource[] = [alice, bob]) {
  return schedule(tasks, resources, { origin: MONDAY, calendar: DEFAULT_CALENDAR });
}

const elapsedDays = (result: ReturnType<typeof run>, id: string) =>
  result.tasks.get(id)!.elapsedWorkingMinutes / MINUTES_PER_DAY;

describe('single task', () => {
  it('is untouched when nothing competes with it', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(4), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(elapsedDays(result, 'a')).toBe(4);
    expect(result.tasks.get('a')!.start).toEqual(MONDAY);
    // Four working days from Monday morning close on Thursday at 17:00.
    expect(result.tasks.get('a')!.end).toEqual(day(3, 17));
  });

  it('skips the weekend', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(6), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    // Six working days: Mon-Fri then the following Monday.
    expect(result.tasks.get('a')!.end).toEqual(day(7, 17));
  });

  it('runs at full rate when unassigned, even alongside other unassigned tasks', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY },
    ]);
    expect(elapsedDays(result, 'a')).toBe(2);
    expect(elapsedDays(result, 'b')).toBe(2);
  });
});

describe('effort splitting', () => {
  it('halves the rate of two tasks overlapping from the start', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(elapsedDays(result, 'a')).toBe(4);
    expect(elapsedDays(result, 'b')).toBe(4);
    expect(result.tasks.get('a')!.segments).toHaveLength(1);
    expect(result.tasks.get('a')!.segments[0].rate).toBe(0.5);
  });

  it('splits three ways at one third each', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'c', name: 'C', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    for (const id of ['a', 'b', 'c']) {
      expect(elapsedDays(result, id)).toBeCloseTo(3, 9);
      expect(result.tasks.get(id)!.segments[0].rate).toBeCloseTo(1 / 3, 9);
    }
  });

  it('does not split across different resources', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'bob' },
    ]);
    expect(elapsedDays(result, 'a')).toBe(2);
    expect(elapsedDays(result, 'b')).toBe(2);
  });

  it('changes allocation regime mid-task when a second task arrives', () => {
    // A alone Mon-Tue at 100%, then A and B share from Wednesday: both close together.
    const result = run([
      { id: 'a', name: 'A', effort: days(4), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: day(2), resourceId: 'alice' },
    ]);
    expect(elapsedDays(result, 'a')).toBe(6);
    expect(elapsedDays(result, 'b')).toBe(4);
    expect(result.tasks.get('a')!.end).toEqual(result.tasks.get('b')!.end);

    const segments = result.tasks.get('a')!.segments;
    expect(segments).toHaveLength(2);
    expect(segments[0].rate).toBe(1);
    expect(segments[0].end).toEqual(day(1, 17));
    expect(segments[1].rate).toBe(0.5);
  });

  it('returns to full rate once the competing task finishes', () => {
    const result = run([
      { id: 'long', name: 'Long', effort: days(4), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'short', name: 'Short', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    // Short burns 1 day of effort at 50% -> closes after 2 elapsed days; Long has
    // 3 days of effort left and then runs alone.
    expect(elapsedDays(result, 'short')).toBe(2);
    expect(elapsedDays(result, 'long')).toBe(5);
    const segments = result.tasks.get('long')!.segments;
    expect(segments.map((segment) => segment.rate)).toEqual([0.5, 1]);
  });

  it('conserves effort: the sum of rate times elapsed time equals the effort', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: day(1), resourceId: 'alice' },
      { id: 'c', name: 'C', effort: days(4), startConstraint: day(2), resourceId: 'alice' },
    ];
    const result = run(tasks);
    for (const task of tasks) {
      const burnt = result.tasks
        .get(task.id)!
        .segments.reduce(
          (total, segment) =>
            total + segment.rate * (segment.endWorkingMinutes - segment.startWorkingMinutes),
          0,
        );
      expect(burnt).toBeCloseTo(task.effort, 6);
    }
  });

  it('honours partial resource availability', () => {
    const result = run(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'halftime' }],
      [{ id: 'halftime', name: 'Half time', availability: 0.5 }],
    );
    expect(elapsedDays(result, 'a')).toBe(4);
  });

  it('compounds partial staffing with the split between concurrent tasks', () => {
    // Someone staffed 50% on the project, running two tasks at once, gives each
    // of them a quarter of a full-time person.
    const result = run(
      [
        { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'halftime' },
        { id: 'b', name: 'B', effort: days(1), startConstraint: MONDAY, resourceId: 'halftime' },
      ],
      [{ id: 'halftime', name: 'Half time', availability: 0.5 }],
    );
    expect(result.tasks.get('a')!.segments[0].rate).toBe(0.25);
    expect(elapsedDays(result, 'a')).toBe(4);
    expect(elapsedDays(result, 'b')).toBe(4);
  });

  it('never lets a resource exceed its own availability', () => {
    const result = run(
      [
        { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'part' },
        { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'part' },
        { id: 'c', name: 'C', effort: days(2), startConstraint: MONDAY, resourceId: 'part' },
      ],
      [{ id: 'part', name: 'Part time', availability: 0.6 }],
    );
    const totalRate = ['a', 'b', 'c'].reduce(
      (sum, id) => sum + result.tasks.get(id)!.segments[0].rate,
      0,
    );
    expect(totalRate).toBeCloseTo(0.6, 9);
  });
});

describe('dependencies', () => {
  it('pushes a successor past its predecessor', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      {
        id: 'b',
        name: 'B',
        effort: days(1),
        startConstraint: MONDAY,
        resourceId: 'bob',
        predecessors: ['a'],
      },
    ]);
    expect(result.tasks.get('b')!.startWorkingMinutes).toBe(
      result.tasks.get('a')!.endWorkingMinutes,
    );
    // B is no longer concurrent with A, so it keeps its nominal duration.
    expect(elapsedDays(result, 'b')).toBe(1);
  });

  it('waits for the latest of several predecessors', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(3), startConstraint: MONDAY, resourceId: 'bob' },
      { id: 'c', name: 'C', effort: days(1), predecessors: ['a', 'b'], resourceId: 'alice' },
    ]);
    expect(result.tasks.get('c')!.startWorkingMinutes).toBe(
      result.tasks.get('b')!.endWorkingMinutes,
    );
  });

  it('keeps a start constraint later than the predecessor finish', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      {
        id: 'b',
        name: 'B',
        effort: days(1),
        startConstraint: day(4),
        resourceId: 'alice',
        predecessors: ['a'],
      },
    ]);
    expect(result.tasks.get('b')!.start).toEqual(day(4));
  });

  it('reports cycles instead of hanging', () => {
    expect(() =>
      run([
        { id: 'a', name: 'A', effort: days(1), predecessors: ['b'] },
        { id: 'b', name: 'B', effort: days(1), predecessors: ['a'] },
      ]),
    ).toThrow(CyclicDependencyError);
  });

  it('reports unknown predecessors', () => {
    expect(() => run([{ id: 'a', name: 'A', effort: days(1), predecessors: ['ghost'] }])).toThrow(
      UnknownPredecessorError,
    );
  });
});

describe('milestones', () => {
  it('closes a zero-effort task at its ready time without consuming capacity', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'm', name: 'Milestone', effort: 0, startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(result.tasks.get('m')!.start).toEqual(result.tasks.get('m')!.end);
    // The milestone must not have taken half of Alice away from A.
    expect(elapsedDays(result, 'a')).toBe(2);
  });

  it('cascades through chained milestones', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'm1', name: 'M1', effort: 0, predecessors: ['a'] },
      { id: 'm2', name: 'M2', effort: 0, predecessors: ['m1'] },
      { id: 'b', name: 'B', effort: days(1), predecessors: ['m2'], resourceId: 'alice' },
    ]);
    const endOfA = result.tasks.get('a')!.endWorkingMinutes;
    expect(result.tasks.get('m2')!.endWorkingMinutes).toBe(endOfA);
    expect(result.tasks.get('b')!.startWorkingMinutes).toBe(endOfA);
  });
});

describe('edge cases', () => {
  it('handles an empty project', () => {
    const result = run([]);
    expect(result.tasks.size).toBe(0);
  });

  it('scales to a wide fan of concurrent tasks', () => {
    const tasks: Task[] = Array.from({ length: 200 }, (_, index) => ({
      id: `t${index}`,
      name: `T${index}`,
      effort: days(1),
      startConstraint: day(index % 20),
      resourceId: 'alice',
    }));
    const result = run(tasks);
    expect(result.tasks.size).toBe(200);
    for (const task of tasks) {
      expect(result.tasks.get(task.id)!.elapsedWorkingMinutes).toBeGreaterThan(0);
    }
  });
});

describe('isContended', () => {
  it('is false for a task that had the resource to itself', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(4), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(isContended(result.tasks.get('a')!)).toBe(false);
  });

  it('is true for two tasks splitting one resource', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(isContended(result.tasks.get('a')!)).toBe(true);
    expect(isContended(result.tasks.get('b')!)).toBe(true);
  });

  it('is false at part time, which stretches a task just as much', () => {
    // The distinction the caller acts on: contention means move a task,
    // part-time means change the person.
    const result = run(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' }],
      [{ id: 'alice', name: 'Alice', availability: 0.5 }],
    );
    expect(elapsedDays(result, 'a')).toBe(4);
    expect(isContended(result.tasks.get('a')!)).toBe(false);
  });

  it('is false for an absence, and true for contention around one', () => {
    const away: Resource = {
      id: 'alice',
      name: 'Alice',
      availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-09', availability: 0 }],
    };
    const alone = run(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [away],
    );
    expect(elapsedDays(alone, 'a')).toBeGreaterThan(3);
    expect(isContended(alone.tasks.get('a')!)).toBe(false);

    const together = run(
      [
        { id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' },
        { id: 'b', name: 'B', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' },
      ],
      [away],
    );
    expect(isContended(together.tasks.get('a')!)).toBe(true);
  });

  it('is false for an unassigned task, which never contends', () => {
    const result = run([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY },
    ]);
    expect(isContended(result.tasks.get('a')!)).toBe(false);
    expect(elapsedDays(result, 'a')).toBe(2);
  });
});
