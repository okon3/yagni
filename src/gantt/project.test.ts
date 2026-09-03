import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../scheduler';
import {
  TaskCycleError,
  buildHierarchy,
  effectiveColorOf,
  emptyProject,
  rejectionForLink,
  solve,
  subtreeOf,
  type Project,
  type ProjectTask,
} from './project';

const MINUTES_PER_DAY = 8 * 60;
const at = (dayOffset: number) => new Date(2026, 8, 7 + dayOffset, 8, 0);

function project(tasks: ProjectTask[]): Project {
  return {
    calendar: DEFAULT_CALENDAR,
    resources: [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ],
    tasks,
  };
}

const days = (minutes: number) => minutes / MINUTES_PER_DAY;

describe('hierarchy', () => {
  it('treats a task with children as a summary', () => {
    const hierarchy = buildHierarchy([
      { id: 'p', name: 'P', nominalDays: 0, start: at(0) },
      { id: 'c', name: 'C', nominalDays: 1, start: at(0), parentId: 'p' },
    ]);
    expect(hierarchy.isSummary('p')).toBe(true);
    expect(hierarchy.isSummary('c')).toBe(false);
    expect(hierarchy.leavesUnder('p')).toEqual(['c']);
  });

  it('re-parents orphans to the root instead of hiding them', () => {
    const hierarchy = buildHierarchy([
      { id: 'a', name: 'A', nominalDays: 1, start: at(0), parentId: 'ghost' },
    ]);
    expect(hierarchy.childrenOf(undefined).map((task) => task.id)).toEqual(['a']);
  });

  it('reports a parent chain that loops', () => {
    const hierarchy = buildHierarchy([
      { id: 'a', name: 'A', nominalDays: 1, start: at(0), parentId: 'b' },
      { id: 'b', name: 'B', nominalDays: 1, start: at(0), parentId: 'a' },
    ]);
    expect(() => hierarchy.ancestorsOf('a')).toThrow(TaskCycleError);
  });
});

describe('rollup', () => {
  it('derives effort and dates from the children', () => {
    const solved = solve(
      project([
        { id: 'p', name: 'Parent', nominalDays: 99, start: at(9) },
        { id: 'c1', name: 'C1', nominalDays: 2, start: at(0), parentId: 'p', resourceId: 'alice' },
        { id: 'c2', name: 'C2', nominalDays: 3, start: at(5), parentId: 'p', resourceId: 'bob' },
      ]),
    );
    const parent = solved.schedule.tasks.get('p')!;
    // The parent's own nominalDays and start are ignored entirely.
    expect(days(parent.effortMinutes)).toBe(5);
    expect(parent.startWorkingMinutes).toBe(solved.schedule.tasks.get('c1')!.startWorkingMinutes);
    expect(parent.endWorkingMinutes).toBe(solved.schedule.tasks.get('c2')!.endWorkingMinutes);
    expect(solved.summaryIds.has('p')).toBe(true);
  });

  it('spans the gap when children do not run back to back', () => {
    const solved = solve(
      project([
        { id: 'p', name: 'Parent', nominalDays: 0, start: at(0) },
        { id: 'c1', name: 'C1', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'alice' },
        { id: 'c2', name: 'C2', nominalDays: 1, start: at(8), parentId: 'p', resourceId: 'alice' },
      ]),
    );
    const parent = solved.schedule.tasks.get('p')!;
    // Effort is 2 days but the span covers the idle stretch in between.
    expect(days(parent.effortMinutes)).toBe(2);
    expect(days(parent.elapsedWorkingMinutes)).toBeGreaterThan(2);
  });

  it('carries no allocation segments', () => {
    const solved = solve(
      project([
        { id: 'p', name: 'Parent', nominalDays: 0, start: at(0) },
        { id: 'c1', name: 'C1', nominalDays: 2, start: at(0), parentId: 'p', resourceId: 'alice' },
        { id: 'c2', name: 'C2', nominalDays: 2, start: at(0), parentId: 'p', resourceId: 'alice' },
      ]),
    );
    expect(solved.schedule.tasks.get('p')!.segments).toEqual([]);
    // The children still share Alice and stretch to 4 days each.
    expect(days(solved.schedule.tasks.get('c1')!.elapsedWorkingMinutes)).toBe(4);
  });

  it('rolls up through several levels', () => {
    const solved = solve(
      project([
        { id: 'root', name: 'Root', nominalDays: 0, start: at(0) },
        { id: 'mid', name: 'Mid', nominalDays: 0, start: at(0), parentId: 'root' },
        { id: 'leaf1', name: 'L1', nominalDays: 2, start: at(0), parentId: 'mid', resourceId: 'alice' },
        { id: 'leaf2', name: 'L2', nominalDays: 3, start: at(0), parentId: 'root', resourceId: 'bob' },
      ]),
    );
    expect(days(solved.schedule.tasks.get('mid')!.effortMinutes)).toBe(2);
    expect(days(solved.schedule.tasks.get('root')!.effortMinutes)).toBe(5);
  });

  it('does not let a summary consume resource capacity', () => {
    // If the summary were scheduled too, it would contend with its own child
    // for Alice and halve its rate.
    const solved = solve(
      project([
        { id: 'p', name: 'Parent', nominalDays: 4, start: at(0), resourceId: 'alice' },
        { id: 'c', name: 'C', nominalDays: 2, start: at(0), parentId: 'p', resourceId: 'alice' },
      ]),
    );
    expect(days(solved.schedule.tasks.get('c')!.elapsedWorkingMinutes)).toBe(2);
    expect(solved.schedule.tasks.get('c')!.segments[0].rate).toBe(1);
  });
});

describe('empty project', () => {
  it('starts with no people', () => {
    expect(emptyProject().resources).toEqual([]);
    expect(emptyProject().tasks).toEqual([]);
  });

  it('schedules unassigned tasks at full rate, contending with nobody', () => {
    const solved = solve({
      calendar: DEFAULT_CALENDAR,
      resources: [],
      tasks: [
        { id: 'a', name: 'A', nominalDays: 2, start: at(0) },
        { id: 'b', name: 'B', nominalDays: 2, start: at(0) },
      ],
    });
    // Without a resource there is nothing to share, so neither stretches.
    expect(days(solved.schedule.tasks.get('a')!.elapsedWorkingMinutes)).toBe(2);
    expect(days(solved.schedule.tasks.get('b')!.elapsedWorkingMinutes)).toBe(2);
  });
});

describe('colour inheritance', () => {
  const tasks: ProjectTask[] = [
    { id: 'root', name: 'Root', nominalDays: 0, start: at(0), color: '#2f9e6e' },
    { id: 'mid', name: 'Mid', nominalDays: 0, start: at(0), parentId: 'root' },
    { id: 'leaf', name: 'Leaf', nominalDays: 1, start: at(0), parentId: 'mid', color: '#c0533f' },
    { id: 'lone', name: 'Lone', nominalDays: 1, start: at(0) },
  ];
  const hierarchy = buildHierarchy(tasks);

  it('resolves the top-level ancestor at any depth', () => {
    expect(hierarchy.rootOf('leaf')).toBe('root');
    expect(hierarchy.rootOf('mid')).toBe('root');
    expect(hierarchy.rootOf('root')).toBe('root');
    expect(hierarchy.rootOf('lone')).toBe('lone');
  });

  it('gives every descendant the root colour, overriding its own', () => {
    expect(effectiveColorOf(tasks, hierarchy, 'mid')).toBe('#2f9e6e');
    // The leaf carries #c0533f but inherits regardless.
    expect(effectiveColorOf(tasks, hierarchy, 'leaf')).toBe('#2f9e6e');
  });

  it('leaves a task without a coloured root undefined', () => {
    expect(effectiveColorOf(tasks, hierarchy, 'lone')).toBeUndefined();
  });

  it('recolours a branch when it is re-parented', () => {
    const moved = tasks.map((task) =>
      task.id === 'mid' ? { ...task, parentId: undefined } : task,
    );
    const rebuilt = buildHierarchy(moved);
    expect(effectiveColorOf(moved, rebuilt, 'leaf')).toBeUndefined();
  });
});

describe('dependencies across the hierarchy', () => {
  it('pushes a summary predecessor down to the children', () => {
    const solved = solve(
      project([
        { id: 'before', name: 'Before', nominalDays: 2, start: at(0), resourceId: 'bob' },
        { id: 'p', name: 'Parent', nominalDays: 0, start: at(0), predecessors: ['before'] },
        { id: 'c', name: 'C', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'alice' },
      ]),
    );
    // The child inherits the parent's dependency even though it declares none.
    expect(solved.schedule.tasks.get('c')!.startWorkingMinutes).toBe(
      solved.schedule.tasks.get('before')!.endWorkingMinutes,
    );
  });

  it('waits for the last leaf when depending on a summary', () => {
    const solved = solve(
      project([
        { id: 'p', name: 'Parent', nominalDays: 0, start: at(0) },
        { id: 'c1', name: 'C1', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'alice' },
        { id: 'c2', name: 'C2', nominalDays: 4, start: at(0), parentId: 'p', resourceId: 'bob' },
        { id: 'after', name: 'After', nominalDays: 1, start: at(0), predecessors: ['p'] },
      ]),
    );
    expect(solved.schedule.tasks.get('after')!.startWorkingMinutes).toBe(
      solved.schedule.tasks.get('c2')!.endWorkingMinutes,
    );
  });

  it('ignores a dependency on its own descendant instead of deadlocking', () => {
    const solved = solve(
      project([
        { id: 'p', name: 'Parent', nominalDays: 0, start: at(0) },
        { id: 'c', name: 'C', nominalDays: 1, start: at(0), parentId: 'p', predecessors: ['p'] },
      ]),
    );
    expect(solved.schedule.tasks.get('c')!.startWorkingMinutes).toBe(0);
  });
});

describe('subtreeOf', () => {
  const leaf = (id: string, parentId?: string): ProjectTask => ({
    id,
    name: id,
    nominalDays: 1,
    start: at(0),
    parentId,
  });

  it('returns the task alone when it has no children', () => {
    expect([...subtreeOf([leaf('a'), leaf('b')], 'a')]).toEqual(['a']);
  });

  it('collects children and grandchildren', () => {
    const tasks = [leaf('a'), leaf('b', 'a'), leaf('c', 'b'), leaf('d')];
    expect([...subtreeOf(tasks, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });

  // The task list carries no ordering guarantee, and a file may well declare a
  // grandchild before its parent.
  it('does not depend on declaration order', () => {
    const tasks = [leaf('c', 'b'), leaf('b', 'a'), leaf('a')];
    expect([...subtreeOf(tasks, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves a sibling branch out', () => {
    const tasks = [leaf('a'), leaf('b', 'a'), leaf('x'), leaf('y', 'x')];
    expect([...subtreeOf(tasks, 'x')].sort()).toEqual(['x', 'y']);
  });
});

describe('rejectionForLink', () => {
  const task = (id: string, predecessors?: string[], parentId?: string): ProjectTask => ({
    id,
    name: id.toUpperCase(),
    nominalDays: 1,
    start: at(0),
    predecessors,
    parentId,
  });

  it('accepts a link that closes nothing', () => {
    expect(rejectionForLink(project([task('a'), task('b')]), 'a', 'b')).toBeNull();
  });

  it('refuses the reverse of an existing dependency', () => {
    const problem = rejectionForLink(project([task('a'), task('b', ['a'])]), 'b', 'a');
    expect(problem).toMatch(/ciclo/);
  });

  it('refuses a cycle several hops long', () => {
    const tasks = [task('a'), task('b', ['a']), task('c', ['b'])];
    expect(rejectionForLink(project(tasks), 'c', 'a')).toMatch(/ciclo/);
  });

  it('refuses a task depending on itself', () => {
    expect(rejectionForLink(project([task('a')]), 'a', 'a')).toMatch(/se stessa/);
  });

  it('names an id that does not exist', () => {
    expect(rejectionForLink(project([task('a')]), 'a', 'ghost')).toMatch(/inesistente/);
  });

  /**
   * The reason the check is a trial solve() rather than assertAcyclic on the
   * declared graph: two summaries depending on each other's subtree read as
   * acyclic while declared, and deadlock once pushed down to the leaves.
   */
  it('refuses a cycle that only exists once summaries expand to their leaves', () => {
    // Nothing here is a declared cycle: s1 and s2 have no predecessors of their
    // own. It is a cycle only after a depends on leaves(s2) and b on leaves(s1).
    const tasks = [
      task('s1'),
      task('a', ['s2'], 's1'),
      task('s2'),
      task('b', undefined, 's2'),
    ];
    expect(rejectionForLink(project(tasks), 's1', 'b')).toMatch(/ciclo/);
  });

  it('leaves the project untouched whatever it decides', () => {
    const tasks = [task('a'), task('b', ['a'])];
    const subject = project(tasks);
    rejectionForLink(subject, 'b', 'a');
    expect(subject.tasks.map((entry) => entry.predecessors)).toEqual([undefined, ['a']]);
  });
});
