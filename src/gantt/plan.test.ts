import { describe, expect, it } from 'vitest';
import { buildPlan } from './plan';
import { sampleProject, solve, type Project } from './project';
import { DEFAULT_CALENDAR } from '../scheduler';

const at = (dayOffset: number) => new Date(2026, 8, 7 + dayOffset, 8, 0);

const planOf = (project: Project) => buildPlan(solve(project));

describe('buildPlan', () => {
  it('returns every task exactly once', () => {
    const plan = planOf(sampleProject);
    expect(plan.tasks).toHaveLength(sampleProject.tasks.length);
    expect(new Set(plan.tasks.map((task) => task.id)).size).toBe(sampleProject.tasks.length);
  });

  it('puts a parent immediately before its own subtree, recursively', () => {
    // Declared out of tree order on purpose: project.tasks is not the tree.
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [],
      tasks: [
        { id: 'leaf', name: 'Foglia', nominalDays: 1, start: at(0), parentId: 'mid' },
        { id: 'last', name: 'Ultima', nominalDays: 1, start: at(0) },
        { id: 'top', name: 'Cima', nominalDays: 1, start: at(0) },
        { id: 'mid', name: 'Mezzo', nominalDays: 1, start: at(0), parentId: 'top' },
        { id: 'first', name: 'Prima', nominalDays: 1, start: at(0) },
      ],
    };
    expect(planOf(project).tasks.map((task) => `${'  '.repeat(task.depth)}${task.id}`)).toEqual([
      'last',
      'top',
      '  mid',
      '    leaf',
      'first',
    ]);
  });

  it('is stable: the same project yields identical output twice', () => {
    expect(JSON.stringify(planOf(sampleProject))).toBe(JSON.stringify(planOf(sampleProject)));
  });

  it('writes dates as local wall clock, never as UTC', () => {
    const plan = planOf(sampleProject);
    expect(plan.tasks[0].start).toBe('2026-09-07T08:00');
    expect(plan.projectStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('rolls a summary up and leaves it without a resource', () => {
    const plan = planOf(sampleProject);
    const summary = plan.tasks.find((task) => task.id === '7');
    expect(summary).toMatchObject({ isSummary: true, parentId: null, resourceId: null });
    // Its two children declare two and one day of effort.
    expect(summary?.effortDays).toBeCloseTo(3);
  });

  it('hides the resource a summary kept from before it had children', () => {
    // A leaf assigned to r1 that later gained a child keeps its own resourceId
    // in the model, where it is inert; reading it out would report an
    // assignment nobody is working.
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [
        { id: 'r1', name: 'Marta' },
        { id: 'r2', name: 'Gino' },
      ],
      tasks: [
        { id: 'group', name: 'Gruppo', nominalDays: 0, start: at(0), resourceId: 'r1' },
        { id: 'work', name: 'Lavoro', nominalDays: 2, start: at(0), resourceId: 'r2', parentId: 'group' },
      ],
    };
    const [group, work] = planOf(project).tasks;
    expect(group).toMatchObject({ id: 'group', isSummary: true, resourceId: null });
    expect(work).toMatchObject({ id: 'work', resourceId: 'r2' });
  });

  it('reports contention as shared, with elapsed above effort', () => {
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [{ id: 'r1', name: 'Marta' }],
      tasks: [
        { id: '1', name: 'Una', nominalDays: 2, start: at(0), resourceId: 'r1' },
        { id: '2', name: 'Due', nominalDays: 2, start: at(0), resourceId: 'r1' },
      ],
    };
    for (const task of planOf(project).tasks) {
      expect(task.shared).toBe(true);
      expect(task.elapsedDays).toBeGreaterThan(task.effortDays);
    }
  });

  it('does not call part-time shared, though it stretches just as much', () => {
    // The distinction the caller acts on: contention means move a task,
    // part-time means change the person.
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [{ id: 'r1', name: 'Marta', availability: 0.5 }],
      tasks: [{ id: '1', name: 'Una', nominalDays: 2, start: at(0), resourceId: 'r1' }],
    };
    const [task] = planOf(project).tasks;
    expect(task.shared).toBe(false);
    expect(task.elapsedDays).toBeCloseTo(4);
    expect(task.effortDays).toBeCloseTo(2);
  });

  it('does not call an absence shared either', () => {
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [
        {
          id: 'r1',
          name: 'Marta',
          availabilityOverrides: [{ from: '2026-09-08', to: '2026-09-09', availability: 0 }],
        },
      ],
      tasks: [{ id: '1', name: 'Una', nominalDays: 3, start: at(0), resourceId: 'r1' }],
    };
    const [task] = planOf(project).tasks;
    expect(task.shared).toBe(false);
    expect(task.elapsedDays).toBeGreaterThan(task.effortDays);
  });

  it('calls contention on a part-timer shared, since it is still contention', () => {
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [{ id: 'r1', name: 'Marta', availability: 0.5 }],
      tasks: [
        { id: '1', name: 'Una', nominalDays: 2, start: at(0), resourceId: 'r1' },
        { id: '2', name: 'Due', nominalDays: 2, start: at(0), resourceId: 'r1' },
      ],
    };
    for (const task of planOf(project).tasks) expect(task.shared).toBe(true);
  });

  it('leaves an unassigned task unshared at full rate', () => {
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [],
      tasks: [
        { id: '1', name: 'Una', nominalDays: 2, start: at(0) },
        { id: '2', name: 'Due', nominalDays: 2, start: at(0) },
      ],
    };
    for (const task of planOf(project).tasks) {
      expect(task).toMatchObject({ shared: false, resourceId: null });
      expect(task.elapsedDays).toBeCloseTo(task.effortDays);
    }
  });
});
