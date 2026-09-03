import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from './calendar';
import { totalFloat } from './float';
import { schedule } from './simulate';
import type { Resource, Task } from './types';

const MINUTES_PER_DAY = 8 * 60;

/** Monday. */
const MONDAY = new Date(2026, 8, 7, 8, 0);
const days = (count: number) => count * MINUTES_PER_DAY;

const alice: Resource = { id: 'alice', name: 'Alice' };
const bob: Resource = { id: 'bob', name: 'Bob' };

function analyse(tasks: Task[], resources: Resource[] = [alice, bob]) {
  const options = { origin: MONDAY, calendar: DEFAULT_CALENDAR };
  const floats = totalFloat(tasks, resources, schedule(tasks, resources, options), options);
  return {
    floatDays: (id: string) => floats.get(id)!.floatMinutes / MINUTES_PER_DAY,
    critical: (id: string) => floats.get(id)!.isCritical,
    contendedOn: (id: string) => floats.get(id)!.contendedResourceId,
  };
}

describe('float along a dependency chain', () => {
  it('leaves none on a chain that ends the plan', () => {
    const result = analyse([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(3), resourceId: 'bob', predecessors: ['a'] },
    ]);
    expect(result.floatDays('a')).toBe(0);
    expect(result.floatDays('b')).toBe(0);
    expect(result.critical('a')).toBe(true);
    expect(result.critical('b')).toBe(true);
    expect(result.contendedOn('a')).toBeUndefined();
  });

  it('gives a parallel branch what its slack is worth', () => {
    // Alice's chain runs five days, Bob's single task two: Bob can start three
    // days later, and three more days of work on it still cost nothing.
    const result = analyse([
      { id: 'a1', name: 'A1', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'a2', name: 'A2', effort: days(3), resourceId: 'alice', predecessors: ['a1'] },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'bob' },
    ]);
    expect(result.floatDays('b')).toBe(3);
    expect(result.critical('b')).toBe(false);
    expect(result.critical('a1')).toBe(true);
    expect(result.critical('a2')).toBe(true);
  });

  it('shares one window of float between the tasks inside it', () => {
    // The two short tasks run back to back inside a five-day window, so the
    // pair has two days of float between them, not two days each.
    const result = analyse([
      { id: 'long', name: 'Long', effort: days(5), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 's1', name: 'S1', effort: days(1), startConstraint: MONDAY, resourceId: 'bob' },
      { id: 's2', name: 'S2', effort: days(2), resourceId: 'bob', predecessors: ['s1'] },
    ]);
    expect(result.floatDays('s1')).toBe(2);
    expect(result.floatDays('s2')).toBe(2);
    expect(result.critical('s1')).toBe(false);
    expect(result.critical('long')).toBe(true);
  });

  it('measures from where a task landed, not from the start it asked for', () => {
    // B asks for Monday and A holds it to day two. The plan ends on day six, so
    // B has three days of room. Delaying the start it *declared* would buy the
    // first two days for nothing and read five.
    const result = analyse([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      {
        id: 'b',
        name: 'B',
        effort: days(1),
        startConstraint: MONDAY,
        resourceId: 'bob',
        predecessors: ['a'],
      },
      { id: 'c', name: 'C', effort: days(4), resourceId: 'alice', predecessors: ['a'] },
    ]);
    expect(result.floatDays('b')).toBe(3);
  });
});

describe('float under contention', () => {
  it('marks a task with no dependency at all as critical when it shares a person', () => {
    // Z holds Alice from Monday; Y arrives on day four, when Z still has a day
    // of work left, and the two split her. A day of delay on Z leaves it in
    // Y's window for longer and pushes the plan out — with nothing linking Z to
    // anything.
    const result = analyse([
      { id: 'x', name: 'X', effort: days(4), startConstraint: MONDAY, resourceId: 'bob' },
      { id: 'y', name: 'Y', effort: days(2), resourceId: 'alice', predecessors: ['x'] },
      { id: 'z', name: 'Z', effort: days(5), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(result.critical('z')).toBe(true);
    expect(result.floatDays('z')).toBe(0);
    expect(result.contendedOn('z')).toBe('alice');
    // And the chain into the contention is not: letting X run a day longer lets
    // Z finish alone, so Y still fits.
    expect(result.critical('x')).toBe(false);
    expect(result.contendedOn('x')).toBeUndefined();
  });

  it('reports a task that can be moved but not grown', () => {
    // Four days of Alice's work asked for on Monday. Either task can start two
    // days late and catch up alone, so both have float — while one more day of
    // work on either pushes the plan out, because she is the constraint.
    const result = analyse([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    expect(result.floatDays('a')).toBe(2);
    expect(result.floatDays('b')).toBe(2);
    expect(result.critical('a')).toBe(true);
    expect(result.critical('b')).toBe(true);
    expect(result.contendedOn('a')).toBe('alice');
    expect(result.contendedOn('b')).toBe('alice');
  });

  it('does not call part-time contention, though it stretches the task the same', () => {
    const result = analyse(
      [{ id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'half' }],
      [{ id: 'half', name: 'Half time', availability: 0.5 }],
    );
    expect(result.critical('a')).toBe(true);
    expect(result.contendedOn('a')).toBeUndefined();
  });

  it('never contends an unassigned task, which runs at full rate', () => {
    const result = analyse([
      { id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY },
      { id: 'b', name: 'B', effort: days(3), startConstraint: MONDAY },
    ]);
    expect(result.contendedOn('a')).toBeUndefined();
    expect(result.critical('a')).toBe(true);
    expect(result.critical('b')).toBe(true);
  });
});

describe('milestones', () => {
  it('is critical at the end of the plan, where it cannot move at all', () => {
    const result = analyse([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'm', name: 'M', effort: 0, predecessors: ['a'] },
    ]);
    expect(result.critical('m')).toBe(true);
    expect(result.floatDays('m')).toBe(0);
  });

  it('is free where the work around it is, and is never grown to find out', () => {
    const result = analyse([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'long', name: 'Long', effort: days(5), startConstraint: MONDAY, resourceId: 'bob' },
      { id: 'm', name: 'M', effort: 0, predecessors: ['a'] },
    ]);
    expect(result.floatDays('m')).toBe(3);
    expect(result.critical('m')).toBe(false);
  });
});

describe('what it does to the plan it measures', () => {
  it('leaves the tasks it was handed untouched', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(1), startConstraint: MONDAY, resourceId: 'bob' },
    ];
    const before = structuredClone(tasks);
    analyse(tasks);
    expect(tasks).toEqual(before);
  });

  it('measures only the tasks asked for', () => {
    const tasks: Task[] = [
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(1), startConstraint: MONDAY, resourceId: 'bob' },
    ];
    const solved = schedule(tasks, [alice, bob], { origin: MONDAY });
    const floats = totalFloat(tasks, [alice, bob], solved, { origin: MONDAY, ids: ['b'] });
    expect([...floats.keys()]).toEqual(['b']);
  });

  it('answers at the resolution it is given', () => {
    // Half a day of room is no float at day resolution and one step at half-day
    // resolution: rounding down is the conservative side.
    const tasks: Task[] = [
      { id: 'long', name: 'Long', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'short', name: 'Short', effort: days(1.5), startConstraint: MONDAY, resourceId: 'bob' },
    ];
    const solved = schedule(tasks, [alice, bob], { origin: MONDAY });
    const perDay = totalFloat(tasks, [alice, bob], solved, { origin: MONDAY });
    expect(perDay.get('short')!.floatMinutes).toBe(0);

    const perHalfDay = totalFloat(tasks, [alice, bob], solved, {
      origin: MONDAY,
      stepMinutes: MINUTES_PER_DAY / 2,
    });
    expect(perHalfDay.get('short')!.floatMinutes).toBe(MINUTES_PER_DAY / 2);
  });

  it('holds the axis still while it probes the earliest task', () => {
    // With no origin given, the axis is read off the tasks — and a probe that
    // moved the earliest constraint would take the whole axis with it, leaving
    // every end reading the same and the plan looking free throughout.
    const tasks: Task[] = [
      { id: 'first', name: 'First', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'next', name: 'Next', effort: days(2), resourceId: 'alice', predecessors: ['first'] },
    ];
    const floats = totalFloat(tasks, [alice], schedule(tasks, [alice]));
    expect(floats.get('first')!.isCritical).toBe(true);
    expect(floats.get('first')!.floatMinutes).toBe(0);
  });

  it('treats a delay the simulation refuses as a delay that costs something', () => {
    // Somebody at 0% with a window at full rate. Inside the window the task
    // runs; pushed past it there is no capacity left in the plan at all and the
    // simulation refuses the schedule — which must read as "not free" rather
    // than escape, since this runs inside the handler applying an edit.
    const window: Resource = {
      id: 'window',
      name: 'Window',
      availability: 0,
      availabilityOverrides: [{ from: '2026-09-07', to: '2026-09-11', availability: 1 }],
    };
    const tasks: Task[] = [
      { id: 'long', name: 'Long', effort: days(10), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'inside', name: 'Inside', effort: days(2), startConstraint: MONDAY, resourceId: 'window' },
    ];
    const options = { origin: MONDAY, calendar: DEFAULT_CALENDAR };
    const solved = schedule(tasks, [alice, window], options);
    const floats = totalFloat(tasks, [alice, window], solved, options);
    // The window is the working week and the task needs two days of it, so the
    // Thursday is the last start that fits: three days late.
    expect(floats.get('inside')!.floatMinutes / MINUTES_PER_DAY).toBe(3);
  });

  it('caps the search at the span of the plan', () => {
    // Nothing constrains this task and nothing follows it, so the honest answer
    // is the whole plan: it can start any time up to the end without moving it.
    const result = analyse([
      { id: 'long', name: 'Long', effort: days(10), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'loose', name: 'Loose', effort: days(1), startConstraint: MONDAY, resourceId: 'bob' },
    ]);
    expect(result.floatDays('loose')).toBe(9);
    expect(result.critical('loose')).toBe(false);
  });
});
