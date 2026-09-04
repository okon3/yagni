import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, WorkingCalendar } from './calendar';
import { resourceLoad } from './load';
import { schedule } from './simulate';
import type { Resource, Task } from './types';

const MINUTES_PER_DAY = 8 * 60;

/** Monday. */
const MONDAY = new Date(2026, 8, 7, 8, 0);
const day = (offset: number, hour = 8) => new Date(2026, 8, 7 + offset, hour, 0);
const days = (count: number) => count * MINUTES_PER_DAY;

const alice: Resource = { id: 'alice', name: 'Alice' };
const bob: Resource = { id: 'bob', name: 'Bob' };

function load(tasks: Task[], resources: Resource[] = [alice, bob]) {
  const calendar = new WorkingCalendar(MONDAY, DEFAULT_CALENDAR);
  const result = schedule(tasks, resources, { origin: MONDAY, calendar: DEFAULT_CALENDAR });
  return new Map(
    resourceLoad(tasks, resources, result, calendar).map((entry) => [entry.resourceId, entry]),
  );
}

describe('one person, one task', () => {
  it('is one stretch across the days it spans, not one per day', () => {
    // The wall-clock dates differ — 08:00 Monday to 17:00 Wednesday — while the
    // working minutes run without a break, which is what decides the stretch.
    const lane = load([
      { id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' },
    ]).get('alice')!;
    expect(lane.segments).toHaveLength(1);
    expect(lane.segments[0]).toMatchObject({
      startWorkingMinutes: 0,
      endWorkingMinutes: days(3),
      committed: 1,
      capacity: 1,
    });
    expect(lane.segments[0].start).toEqual(MONDAY);
    expect(lane.segments[0].end).toEqual(day(2, 17));
    expect(lane.idleMinutes).toBe(0);
  });

  it('books the effort of the task and nothing else', () => {
    const lane = load([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
    ]).get('alice')!;
    expect(lane.committedMinutes).toBeCloseTo(days(2), 6);
  });
});

describe('two tasks on one person', () => {
  it('reads as fully committed, not as half of each', () => {
    const lane = load([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' },
    ]).get('alice')!;
    // A burns its day at 50% and closes after two; B has three days left and
    // then runs alone. Alice is booked solid throughout either way.
    expect(lane.segments).toHaveLength(2);
    expect(lane.segments.map((segment) => segment.committed)).toEqual([1, 1]);
    expect(lane.segments[0].shares).toEqual([
      { taskId: 'a', rate: 0.5 },
      { taskId: 'b', rate: 0.5 },
    ]);
    expect(lane.segments[1].shares).toEqual([{ taskId: 'b', rate: 1 }]);
    expect(lane.idleMinutes).toBe(0);
    expect(lane.committedMinutes).toBeCloseTo(days(4), 6);
  });

  it('never commits more than the resource has', () => {
    const lane = load([
      { id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: day(1), resourceId: 'alice' },
      { id: 'c', name: 'C', effort: days(4), startConstraint: day(2), resourceId: 'alice' },
    ]).get('alice')!;
    for (const segment of lane.segments) {
      expect(segment.committed).toBeLessThanOrEqual(segment.capacity + 1e-9);
    }
  });
});

describe('idle capacity', () => {
  it('fills the gap between two tasks with a segment at zero', () => {
    const lane = load([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(1), startConstraint: day(4), resourceId: 'alice' },
    ]).get('alice')!;
    expect(lane.segments.map((segment) => segment.committed)).toEqual([1, 0, 1]);
    expect(lane.segments[1]).toMatchObject({
      startWorkingMinutes: days(1),
      endWorkingMinutes: days(4),
      capacity: 1,
      shares: [],
    });
    expect(lane.idleMinutes).toBe(days(3));
  });

  it('counts the room left beside a task that does not fill the person', () => {
    // Two people, one task each, but Bob's runs a day longer: Alice's lane has
    // a day of capacity nothing claims.
    const lanes = load([
      { id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'b', name: 'B', effort: days(2), startConstraint: MONDAY, resourceId: 'bob' },
    ]);
    expect(lanes.get('alice')!.idleMinutes).toBe(days(1));
    expect(lanes.get('bob')!.idleMinutes).toBe(0);
  });

  it('answers for a resource nobody is using', () => {
    const lanes = load([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
    ]);
    const idle = lanes.get('bob')!;
    expect(idle.committedMinutes).toBe(0);
    expect(idle.segments).toEqual([
      expect.objectContaining({ committed: 0, capacity: 1, startWorkingMinutes: 0 }),
    ]);
    expect(idle.idleMinutes).toBe(days(2));
  });
});

describe('capacity below full time', () => {
  it('reads a part-timer working flat out as committed, not as over-allocated', () => {
    const lane = load(
      [{ id: 'a', name: 'A', effort: days(1), startConstraint: MONDAY, resourceId: 'half' }],
      [{ id: 'half', name: 'Half', availability: 0.5 }],
    ).get('half')!;
    expect(lane.segments).toHaveLength(1);
    expect(lane.segments[0]).toMatchObject({ committed: 0.5, capacity: 0.5 });
    expect(lane.idleMinutes).toBe(0);
  });

  it('follows an override rather than the default it replaces', () => {
    const lane = load(
      [{ id: 'a', name: 'A', effort: days(4), startConstraint: MONDAY, resourceId: 'half' }],
      [
        {
          id: 'half',
          name: 'Half',
          availability: 0.5,
          // Tuesday at a quarter: the override replaces the default, it does not
          // scale it.
          availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-08', availability: 0.25 }],
        },
      ],
    ).get('half')!;
    const capacities = lane.segments.map((segment) => segment.capacity);
    expect(capacities).toEqual([0.5, 0.25, 0.5]);
    expect(lane.segments[1]).toMatchObject({
      startWorkingMinutes: days(1),
      endWorkingMinutes: days(2),
      committed: 0.25,
    });
    expect(lane.idleMinutes).toBe(0);
  });

  it('shows an absence as no capacity rather than as idle time', () => {
    const lane = load(
      [{ id: 'a', name: 'A', effort: days(3), startConstraint: MONDAY, resourceId: 'alice' }],
      [
        {
          ...alice,
          // Tuesday and Wednesday off, inside the task's span.
          availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-09', availability: 0 }],
        },
      ],
    ).get('alice')!;
    expect(lane.segments.map((segment) => [segment.committed, segment.capacity])).toEqual([
      [1, 1],
      [0, 0],
      [1, 1],
    ]);
    // Nobody wasted anything: there was nothing to waste on those two days.
    expect(lane.idleMinutes).toBe(0);
    expect(lane.committedMinutes).toBeCloseTo(days(3), 6);
  });
});

describe('what never contributes', () => {
  it('leaves an unassigned task out of every lane', () => {
    const lanes = load([
      { id: 'a', name: 'A', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
      { id: 'free', name: 'Free', effort: days(2), startConstraint: MONDAY },
    ]);
    for (const lane of lanes.values()) {
      for (const segment of lane.segments) {
        expect(segment.shares.map((share) => share.taskId)).not.toContain('free');
      }
    }
    expect(lanes.get('alice')!.committedMinutes).toBeCloseTo(days(2), 6);
  });

  it('ignores a task with no allocation segments', () => {
    // The shape a summary row has: assigned on paper, never scheduled. Passing
    // one in must not book anything, or a parent would double-count its leaves.
    const calendar = new WorkingCalendar(MONDAY, DEFAULT_CALENDAR);
    const leaves: Task[] = [
      { id: 'leaf', name: 'Leaf', effort: days(2), startConstraint: MONDAY, resourceId: 'alice' },
    ];
    const result = schedule(leaves, [alice], { origin: MONDAY, calendar: DEFAULT_CALENDAR });
    const rolled = result.tasks.get('leaf')!;
    result.tasks.set('parent', { ...rolled, id: 'parent', segments: [] });

    const withParent: Task[] = [
      ...leaves,
      { id: 'parent', name: 'Parent', effort: days(2), resourceId: 'alice' },
    ];
    const lane = resourceLoad(withParent, [alice], result, calendar)[0];
    expect(lane.committedMinutes).toBeCloseTo(days(2), 6);
    for (const segment of lane.segments) {
      expect(segment.committed).toBeLessThanOrEqual(1);
    }
  });
});
