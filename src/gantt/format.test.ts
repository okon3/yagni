import { describe, expect, it } from 'vitest';
import { endToShow, formatDays } from './format';
import { DEFAULT_CALENDAR } from '../scheduler';
import { solve, type Project } from './project';

const at = (dayOffset: number) => new Date(2026, 8, 7 + dayOffset, 8, 0);

const solvedEnds = (tasks: Project['tasks']) => {
  const solved = solve({ calendar: DEFAULT_CALENDAR, resources: [], tasks });
  return new Map(
    tasks.map((task) => {
      const scheduled = solved.schedule.tasks.get(task.id);
      if (!scheduled) throw new Error(`"${task.id}" was not scheduled`);
      return [task.id, { scheduled, shown: endToShow(scheduled) }];
    }),
  );
};

describe('formatDays', () => {
  it('prints a whole number of days without decimals', () => {
    expect(formatDays(1)).toBe('1');
    expect(formatDays(2)).toBe('2');
    expect(formatDays(9)).toBe('9');
  });

  it('keeps the fraction the editor can produce', () => {
    expect(formatDays(0.25)).toBe('0.25');
    expect(formatDays(0.5)).toBe('0.5');
    expect(formatDays(2.75)).toBe('2.75');
  });

  it('drops the trailing zero of a fraction that ends in one', () => {
    expect(formatDays(1.5)).toBe('1.5');
    expect(formatDays(4.1)).toBe('4.1');
  });

  it('shows nothing for a task with no effort at all', () => {
    expect(formatDays(0)).toBe('0');
  });

  it('hides the noise a rollup picks up from floating point', () => {
    // 0.25 + 0.5 in minutes and back is not exactly 0.75 on every axis.
    expect(formatDays(0.7500000000000001)).toBe('0.75');
    expect(formatDays(8.999999999999998)).toBe('9');
  });

  it('rounds a duration that no number of days divides evenly', () => {
    // Three tasks sharing one person for a day each: 8/3 working days.
    expect(formatDays(8 / 3)).toBe('2.67');
  });
});

describe('endToShow', () => {
  it('keeps a whole-day task inside the day it was worked', () => {
    // Monday 08:00 plus one day of effort finishes Monday, not Tuesday.
    const ends = solvedEnds([{ id: '1', name: 'Un giorno', nominalDays: 1, start: at(0) }]);
    expect(ends.get('1')?.shown.getDate()).toBe(7);
  });

  it('gives a task with no effort the same date at both ends', () => {
    const ends = solvedEnds([
      // Anchors the working-minute axis before the milestone: on the axis's own
      // origin there is no earlier boundary for the end to fall back onto.
      { id: '1', name: 'Prima', nominalDays: 1, start: at(0) },
      { id: 'm', name: 'Rilascio', nominalDays: 0, start: at(14) },
    ]);
    const entry = ends.get('m');
    // The engine's own end is the previous working day, one instant expressed
    // as the far side of the boundary — which as a date reads backwards.
    expect(entry?.scheduled.end.getTime()).toBeLessThan(entry!.scheduled.start.getTime());
    expect(entry?.shown.getTime()).toBe(entry?.scheduled.start.getTime());
  });

  it('leaves an end the engine computed alone whenever the task took time', () => {
    const ends = solvedEnds([{ id: '1', name: 'Tre giorni', nominalDays: 3, start: at(0) }]);
    const entry = ends.get('1');
    expect(entry?.shown.getTime()).toBe(entry?.scheduled.end.getTime());
  });
});
