import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../scheduler';
import {
  CRITICAL_CHAIN_LIMIT,
  TaskCycleError,
  buildHierarchy,
  chainAfterEdit,
  chainOnRequest,
  chainStateOf,
  constraintStart,
  effectiveColorOf,
  emptyProject,
  isMilestone,
  loadByResource,
  rejectionForLink,
  reorderTasks,
  resourcesByTask,
  slackByRow,
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

describe('milestones', () => {
  const milestone: ProjectTask = { id: 'm', name: 'M', nominalDays: 0, start: at(0) };

  it('is a leaf with no effort, and never a summary whatever its children sum to', () => {
    const tasks: ProjectTask[] = [
      { id: 'p', name: 'Rilascio', nominalDays: 0, start: at(0) },
      { id: 'c', name: 'Firma', nominalDays: 0, start: at(0), parentId: 'p' },
      { id: 'a', name: 'A', nominalDays: 2, start: at(0) },
    ];
    const { summaryIds } = solve(project(tasks));
    const marked = tasks.filter((task) => isMilestone(task, summaryIds)).map((task) => task.id);
    expect(marked).toEqual(['c']);
  });

  it('takes no capacity from the person it is assigned to', () => {
    const solved = solve(
      project([
        { id: 'a', name: 'A', nominalDays: 2, start: at(0), resourceId: 'alice' },
        { ...milestone, start: at(0), resourceId: 'alice' },
      ]),
    );
    expect(days(solved.schedule.tasks.get('a')!.elapsedWorkingMinutes)).toBe(2);
  });

  it('sits on the morning of the date it was given', () => {
    const solved = solve(
      project([
        { id: 'a', name: 'A', nominalDays: 1, start: at(0), resourceId: 'alice' },
        { ...milestone, start: at(2) },
      ]),
    );
    const scheduled = solved.schedule.tasks.get('m')!;
    expect(scheduled.start).toEqual(at(2));
    expect(scheduled.end).toEqual(at(2));
  });

  it('lands on its predecessor’s finish, not on the next morning', () => {
    const solved = solve(
      project([
        { id: 'a', name: 'A', nominalDays: 2, start: at(0), resourceId: 'alice' },
        { ...milestone, predecessors: ['a'] },
      ]),
    );
    const scheduled = solved.schedule.tasks.get('m')!;
    expect(scheduled.start).toEqual(solved.schedule.tasks.get('a')!.end);
    expect(scheduled.end).toEqual(scheduled.start);
  });

  it('is inside the span the timeline fits itself to, however late it is dated', () => {
    const solved = solve(
      project([
        { id: 'a', name: 'A', nominalDays: 1, start: at(0), resourceId: 'alice' },
        { ...milestone, start: at(21) },
      ]),
    );
    expect(solved.schedule.projectEnd).toEqual(solved.schedule.tasks.get('m')!.start);
  });

  it('sits exactly where the milestone it is chained to sits', () => {
    const solved = solve(
      project([
        { id: 'a', name: 'A', nominalDays: 1, start: at(0), resourceId: 'alice' },
        { ...milestone, id: 'm1', start: at(2) },
        { ...milestone, id: 'm2', start: at(0), predecessors: ['m1'] },
      ]),
    );
    // m1 is dated rather than gated, so it opens a morning; m2 must follow it
    // there rather than pick the evening before off the same working minute.
    expect(solved.schedule.tasks.get('m1')!.start).toEqual(at(2));
    expect(solved.schedule.tasks.get('m2')!.start).toEqual(at(2));
  });

  it('stays put when the solved start is written back as its constraint', () => {
    // Which is what saving a task does, from the dialog and from a script alike.
    const tasks: ProjectTask[] = [
      { id: 'a', name: 'A', nominalDays: 2, start: at(0), resourceId: 'alice' },
      { ...milestone, predecessors: ['a'] },
    ];
    const once = solve(project(tasks)).schedule.tasks.get('m')!;
    const again = solve(
      project(tasks.map((task) => (task.id === 'm' ? { ...task, start: once.start } : task))),
    ).schedule.tasks.get('m')!;
    expect(again.start).toEqual(once.start);
  });

  it('is bracketed by its parent even when drawn past the last bar under it', () => {
    // The bar closes at 17:00 and the milestone opens at 08:00 next morning on
    // the very same working minute, so the summary cannot take either end from
    // the minutes alone.
    const solved = solve(
      project([
        { id: 'p', name: 'P', nominalDays: 0, start: at(0) },
        { id: 'c', name: 'C', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'alice' },
        { ...milestone, start: at(1), parentId: 'p' },
      ]),
    );
    const summary = solved.schedule.tasks.get('p')!;
    expect(summary.end).toEqual(solved.schedule.tasks.get('m')!.end);
    expect(summary.end.getTime()).toBeGreaterThan(solved.schedule.tasks.get('c')!.end.getTime());
  });

  it('does not leave a summary of milestones ending before it starts', () => {
    const solved = solve(
      project([
        { id: 'a', name: 'A', nominalDays: 1, start: at(0), resourceId: 'alice' },
        { id: 'p', name: 'Traguardi', nominalDays: 0, start: at(0) },
        { id: 'm1', name: 'M1', nominalDays: 0, start: at(1), parentId: 'p' },
        { id: 'm2', name: 'M2', nominalDays: 0, start: at(1), parentId: 'p' },
      ]),
    );
    const summary = solved.schedule.tasks.get('p')!;
    expect(summary.start).toEqual(at(1));
    expect(summary.end).toEqual(at(1));
  });
});

describe('row order', () => {
  const three: ProjectTask[] = [
    { id: 'a', name: 'A', nominalDays: 1, start: at(0) },
    { id: 'b', name: 'B', nominalDays: 1, start: at(0) },
    { id: 'c', name: 'C', nominalDays: 1, start: at(0) },
  ];

  it('takes the order the grid is in', () => {
    expect(reorderTasks(three, ['c', 'a', 'b']).map((task) => task.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps a task the order does not mention rather than dropping it', () => {
    // A view is entitled to an opinion about arrangement, not to delete.
    expect(reorderTasks(three, ['c']).map((task) => task.id)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an id the project does not have, and a repeat of one it does', () => {
    expect(reorderTasks(three, ['ghost', 'b', 'b', 'a']).map((task) => task.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
});

describe('the start constraint', () => {
  const held: ProjectTask[] = [
    { id: 'a', name: 'A', nominalDays: 5, start: at(0), resourceId: 'alice' },
    // Asked to start on the first day, held to the sixth by A.
    { id: 'b', name: 'B', nominalDays: 2, start: at(0), resourceId: 'bob', predecessors: ['a'] },
  ];

  it('keeps the declared start when the caller hands back the solved one', () => {
    const solved = solve(project(held));
    const task = held[1];
    const scheduled = solved.schedule.tasks.get('b')!;
    // What the dialog shows and what a drag reports: later than the constraint.
    expect(scheduled.start).not.toEqual(task.start);
    expect(constraintStart(task, scheduled.start, solved)).toEqual(at(0));
  });

  it('takes a start the caller actually chose', () => {
    const solved = solve(project(held));
    expect(constraintStart(held[1], at(3), solved)).toEqual(at(3));
  });

  it('takes the working day a drop landed on, not the instant under the pointer', () => {
    const solved = solve(project(held));
    const dropped = new Date(2026, 8, 23, 11, 37);
    expect(constraintStart(held[1], dropped, solved)).toEqual(new Date(2026, 8, 23, 8, 0));
  });

  it('moves a drop on a closed day onto the day the plan would run it', () => {
    const solved = solve(project(held));
    // Saturday. Left as it is, the constraint and the start the engine solves
    // from it are two different values that agree only by rounding forward.
    const dropped = new Date(2026, 8, 26, 15, 0);
    expect(constraintStart(held[1], dropped, solved)).toEqual(new Date(2026, 8, 28, 8, 0));
  });

  it('lets a task be pulled ahead of everything else in the plan', () => {
    const solved = solve(project(held));
    // The calendar's origin is the earliest start the plan has, so a day before
    // it has no place on the working-minute axis at all. Asked for one, the
    // constraint used to come back as the origin — the task pinned behind
    // whatever happened to be first, and nothing on screen to say so.
    expect(constraintStart(held[1], at(-7), solved)).toEqual(at(-7));
  });

  it('does not snap the solved start of a task that begins after lunch', () => {
    const tasks: ProjectTask[] = [
      { id: 'a', name: 'A', nominalDays: 0.5, start: at(0), resourceId: 'alice' },
      { id: 'b', name: 'B', nominalDays: 1, start: at(0), resourceId: 'bob', predecessors: ['a'] },
    ];
    const solved = solve(project(tasks));
    const scheduled = solved.schedule.tasks.get('b')!;
    // Snapping before comparing would read 13:00 as a move to 08:00 and walk the
    // declared start of a task nobody dragged.
    expect(scheduled.start.getHours()).toBe(13);
    expect(constraintStart(tasks[1], scheduled.start, solved)).toEqual(at(0));
  });

  it('keeps a milestone on the side of the boundary it was pinned to', () => {
    const tasks: ProjectTask[] = [
      { id: 'a', name: 'A', nominalDays: 2, start: at(0), resourceId: 'alice' },
      { id: 'm', name: 'M', nominalDays: 0, start: at(0), predecessors: ['a'] },
    ];
    const solved = solve(project(tasks));
    const scheduled = solved.schedule.tasks.get('m')!;
    // The diamond sits on A's finish, 17:00 of the second day; writing that back
    // as the constraint is what used to move it across the boundary on a rename.
    expect(scheduled.start.getHours()).toBe(17);
    expect(constraintStart(tasks[1], scheduled.start, solved)).toEqual(at(0));
  });

  it('takes the offered start for a task the schedule does not hold', () => {
    const solved = solve(project(held));
    const stranger: ProjectTask = { id: 'z', name: 'Z', nominalDays: 1, start: at(0) };
    expect(constraintStart(stranger, at(4), solved)).toEqual(at(4));
  });
});

describe('load by resource', () => {
  it('books the work of a branch once, under its leaves', () => {
    const plan = project([
      { id: 'p', name: 'Parent', nominalDays: 99, start: at(9), resourceId: 'alice' },
      { id: 'c1', name: 'C1', nominalDays: 2, start: at(0), parentId: 'p', resourceId: 'alice' },
      { id: 'c2', name: 'C2', nominalDays: 3, start: at(5), parentId: 'p', resourceId: 'alice' },
    ]);
    const alice = loadByResource(plan, solve(plan)).find((load) => load.resourceId === 'alice')!;
    // Five days of leaves, and never the parent's own effort on top of them.
    expect(days(alice.committedMinutes)).toBe(5);
    for (const segment of alice.segments) {
      expect(segment.committed).toBeLessThanOrEqual(segment.capacity);
      expect(segment.shares.map((share) => share.taskId)).not.toContain('p');
    }
  });

  it('answers for everybody, over the plan and no further', () => {
    const plan = project([
      { id: 't', name: 'T', nominalDays: 2, start: at(0), resourceId: 'alice' },
    ]);
    const loads = loadByResource(plan, solve(plan));
    expect(loads.map((load) => load.resourceId)).toEqual(['alice', 'bob']);
    expect(days(loads[1].idleMinutes)).toBe(2);
  });

  it('closes the lanes where the plan closes, not the evening before', () => {
    const plan = project([
      { id: 't', name: 'T', nominalDays: 2, start: at(0), resourceId: 'alice' },
      { id: 'm', name: 'Rilascio', nominalDays: 0, start: at(4) },
    ]);
    const alice = loadByResource(plan, solve(plan)).find((load) => load.resourceId === 'alice')!;
    // The milestone sets the plan's last minute, which falls on a day boundary,
    // and it has already settled which of the two instants that is. Converting
    // the minute again answers 17:00 the evening before, leaving every lane a day
    // short of the diamond drawn above it.
    expect(alice.segments[alice.segments.length - 1].end).toEqual(at(4));
  });
});

describe('slack by row', () => {
  const branch = project([
    { id: 'group', name: 'Gruppo', nominalDays: 0, start: at(0) },
    { id: 'tight', name: 'Stretta', nominalDays: 5, start: at(0), parentId: 'group', resourceId: 'alice' },
    { id: 'loose', name: 'Larga', nominalDays: 1, start: at(0), parentId: 'group', resourceId: 'bob' },
  ]);

  it('gives a summary the tightest float under it', () => {
    const solved = solve(branch);
    const rows = slackByRow(branch, solved, { search: true });
    expect(rows.get('tight')!.floatDays).toBe(0);
    expect(rows.get('loose')!.floatDays).toBe(4);
    // Delaying the branch is delaying its children, and one of them cannot move.
    expect(rows.get('group')!.floatDays).toBe(0);
    expect(rows.get('group')!.isCritical).toBe(true);
  });

  it('is critical as soon as one leaf is', () => {
    const solved = solve(branch);
    const rows = slackByRow(branch, solved);
    expect(rows.get('loose')!.isCritical).toBe(false);
    expect(rows.get('group')!.isCritical).toBe(true);
  });

  it('leaves the figure out when only criticality was measured', () => {
    const solved = solve(branch);
    expect(slackByRow(branch, solved).get('tight')!.floatDays).toBeNull();
  });

  it('names the contention on a branch only when every critical leaf shares it', () => {
    // Both leaves are on Alice and split her, so the branch is critical for one
    // reason and can say which.
    const shared = project([
      { id: 'group', name: 'Gruppo', nominalDays: 0, start: at(0) },
      { id: 'a', name: 'A', nominalDays: 2, start: at(0), parentId: 'group', resourceId: 'alice' },
      { id: 'b', name: 'B', nominalDays: 2, start: at(0), parentId: 'group', resourceId: 'alice' },
    ]);
    const rows = slackByRow(shared, solve(shared), { search: true });
    expect(rows.get('group')!.contendedResourceId).toBe('alice');

    // Adding a critical leaf that contends with nobody leaves the branch with
    // two reasons, and it names neither.
    const mixed = project([
      ...shared.tasks,
      { id: 'c', name: 'C', nominalDays: 6, start: at(0), parentId: 'group', resourceId: 'bob' },
    ]);
    const mixedRows = slackByRow(mixed, solve(mixed), { search: true });
    expect(mixedRows.get('c')!.isCritical).toBe(true);
    expect(mixedRows.get('c')!.contendedResourceId).toBeUndefined();
    expect(mixedRows.get('group')!.contendedResourceId).toBeUndefined();
  });

  it('measures only the rows asked for', () => {
    const solved = solve(branch);
    const rows = slackByRow(branch, solved, { search: true, ids: ['loose'] });
    expect([...rows.keys()]).toEqual(['loose']);
    expect(rows.get('loose')!.floatDays).toBe(4);
  });
});

describe('the chain across an edit', () => {
  const small = project([
    { id: 'a', name: 'A', nominalDays: 3, start: at(0), resourceId: 'alice' },
    { id: 'b', name: 'B', nominalDays: 1, start: at(0), resourceId: 'bob' },
  ]);
  /** One past the limit, so nothing here measures itself along with the schedule. */
  const big = project(
    Array.from({ length: CRITICAL_CHAIN_LIMIT + 1 }, (_, index) => ({
      id: `t${index}`,
      name: `T${index}`,
      nominalDays: 1 + (index % 3),
      start: at(index % 5),
      resourceId: index % 2 ? 'alice' : 'bob',
    })),
  );

  it('measures with the schedule while the plan is small enough', () => {
    const solved = solve(small);
    const chain = chainAfterEdit(small, solved, true, null);
    expect(chain?.fresh).toBe(true);
    expect(chain?.rows.get('a')?.isCritical).toBe(true);
    expect(chainStateOf(true, solved, chain)).toBe('live');
  });

  it('draws nothing, and offers nothing, while nobody is asking', () => {
    const solved = solve(small);
    expect(chainAfterEdit(small, solved, false, null)).toBeNull();
    expect(chainStateOf(false, solved, null)).toBe('off');
  });

  it('waits to be asked on a plan too big to measure per edit', () => {
    const solved = solve(big);
    expect(chainAfterEdit(big, solved, true, null)).toBeNull();
    expect(chainStateOf(true, solved, null)).toBe('asked');
  });

  it('keeps what was measured on request, and calls it old', () => {
    const solved = solve(big);
    const asked = chainOnRequest(big, solved);
    expect(asked.fresh).toBe(true);
    expect(chainStateOf(true, solved, asked)).toBe('fresh');

    // The edit that follows does not pay to measure it again — and seeing
    // nothing while working is worse than seeing an answer that says it is old.
    const after = chainAfterEdit(big, solved, true, asked);
    expect(after?.rows).toBe(asked.rows);
    expect(after?.fresh).toBe(false);
    expect(chainStateOf(true, solved, after)).toBe('stale');
  });

  it('drops an old answer as soon as nobody is asking for it', () => {
    const solved = solve(big);
    const stale = { rows: chainOnRequest(big, solved).rows, fresh: false };
    expect(chainAfterEdit(big, solved, false, stale)).toBeNull();
  });

  it('measures itself again once the plan is back under the limit', () => {
    const stale = { rows: chainOnRequest(big, solve(big)).rows, fresh: false };
    const solved = solve(small);
    const chain = chainAfterEdit(small, solved, true, stale);
    expect(chain?.fresh).toBe(true);
    expect(chain?.rows).not.toBe(stale.rows);
    expect(chainStateOf(true, solved, chain)).toBe('live');
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

describe('resourcesByTask', () => {
  const owners = (tasks: ProjectTask[]) => {
    const map = resourcesByTask(tasks, buildHierarchy(tasks));
    return Object.fromEntries([...map].map(([id, ids]) => [id, [...ids].sort()]));
  };

  it('names nobody on a task with no resource', () => {
    expect(owners([{ id: 'a', name: 'A', nominalDays: 1, start: at(0) }])).toEqual({});
  });

  it('carries a leaf up to every ancestor', () => {
    expect(
      owners([
        { id: 'p', name: 'P', nominalDays: 0, start: at(0) },
        { id: 'c', name: 'C', nominalDays: 0, start: at(0), parentId: 'p' },
        { id: 'g', name: 'G', nominalDays: 1, start: at(0), parentId: 'c', resourceId: 'alice' },
      ]),
    ).toEqual({ p: ['alice'], c: ['alice'], g: ['alice'] });
  });

  it('collects everyone working under a summary', () => {
    expect(
      owners([
        { id: 'p', name: 'P', nominalDays: 0, start: at(0) },
        { id: 'a', name: 'A', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'alice' },
        { id: 'b', name: 'B', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'bob' },
      ]),
    ).toEqual({ p: ['alice', 'bob'], a: ['alice'], b: ['bob'] });
  });

  it('ignores a resource left on a summary, as the rest of the model does', () => {
    expect(
      owners([
        { id: 'p', name: 'P', nominalDays: 1, start: at(0), resourceId: 'bob' },
        { id: 'c', name: 'C', nominalDays: 1, start: at(0), parentId: 'p', resourceId: 'alice' },
      ]),
    ).toEqual({ p: ['alice'], c: ['alice'] });
  });
});
