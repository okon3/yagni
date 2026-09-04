import { describe, expect, it } from 'vitest';
import {
  GENERIC_CHANGE,
  HISTORY_LIMIT,
  describeChange,
  historyOf,
  recordedChange,
  redoLabel,
  redone,
  undoLabel,
  undone,
} from './history';
import { emptyProject, type Project, type ProjectTask } from './project';
import { serializeProject } from './serialization';

const at = (dayOffset: number) => new Date(2026, 8, 7 + dayOffset, 8, 0);

const task = (overrides: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 't1',
  name: 'Requisiti',
  nominalDays: 3,
  start: at(0),
  ...overrides,
});

const projectOf = (tasks: ProjectTask[], rest: Partial<Project> = {}): Project => ({
  ...emptyProject(),
  ...rest,
  tasks,
});

const textOf = (project: Project) => serializeProject(project);

describe('the snapshot stack', () => {
  it('has nothing to undo when it holds one state', () => {
    const history = historyOf(textOf(emptyProject()));
    expect(undoLabel(history)).toBeNull();
    expect(redoLabel(history)).toBeNull();
    expect(undone(history)).toBe(history);
    expect(redone(history)).toBe(history);
  });

  it('walks back and forth over the states it recorded', () => {
    const first = projectOf([task()]);
    const second = projectOf([task(), task({ id: 't2', name: 'Modello dati' })]);
    let history = historyOf(textOf(emptyProject()));
    history = recordedChange(history, first);
    history = recordedChange(history, second);

    history = undone(history);
    expect(history.present.text).toBe(textOf(first));
    history = undone(history);
    expect(history.present.text).toBe(textOf(emptyProject()));
    expect(undoLabel(history)).toBeNull();

    history = redone(history);
    expect(history.present.text).toBe(textOf(first));
    history = redone(history);
    expect(history.present.text).toBe(textOf(second));
    expect(redoLabel(history)).toBeNull();
  });

  it('names what each step would take back', () => {
    let history = historyOf(textOf(emptyProject()));
    history = recordedChange(history, projectOf([task()]));
    expect(undoLabel(history)).toBe('added "Requisiti"');

    history = recordedChange(history, projectOf([task({ nominalDays: 8 })]));
    expect(undoLabel(history)).toBe('edited "Requisiti"');

    history = undone(history);
    expect(undoLabel(history)).toBe('added "Requisiti"');
    expect(redoLabel(history)).toBe('edited "Requisiti"');
  });

  it('ignores an edit that leaves the project as it was', () => {
    const project = projectOf([task()]);
    const history = recordedChange(historyOf(textOf(emptyProject())), project);
    expect(recordedChange(history, project)).toBe(history);
  });

  it('drops the redo branch as soon as the plan moves elsewhere', () => {
    let history = historyOf(textOf(emptyProject()));
    history = recordedChange(history, projectOf([task()]));
    history = undone(history);
    expect(redoLabel(history)).not.toBeNull();

    history = recordedChange(history, projectOf([task({ id: 't9', name: 'Altro' })]));
    expect(history.future).toEqual([]);
    expect(redoLabel(history)).toBeNull();
  });

  it('keeps the most recent steps once it is full', () => {
    let history = historyOf(textOf(emptyProject()));
    for (let day = 1; day <= HISTORY_LIMIT + 10; day += 1) {
      history = recordedChange(history, projectOf([task({ nominalDays: day })]));
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    // The oldest states are gone, the last one taken is not.
    expect(history.past[history.past.length - 1].text).toBe(
      textOf(projectOf([task({ nominalDays: HISTORY_LIMIT + 9 })])),
    );
  });

  it('falls back to a generic label when the previous snapshot cannot be read', () => {
    const history = recordedChange(
      { past: [], present: { text: 'not a project', label: '' }, future: [] },
      projectOf([task()]),
    );
    expect(undoLabel(history)).toBe(GENERIC_CHANGE);
  });
});

describe('naming a change', () => {
  const before = projectOf([task(), task({ id: 't2', name: 'Modello dati' })]);

  it('counts several tasks appearing or disappearing', () => {
    expect(describeChange(projectOf([]), before)).toBe('added 2 tasks');
    expect(describeChange(before, projectOf([]))).toBe('deleted 2 tasks');
  });

  it('names the one task deleted', () => {
    expect(describeChange(before, projectOf([task()]))).toBe(
      'deleted "Modello dati"',
    );
  });

  it('names the row that was dragged, not the one that got out of its way', () => {
    const three = projectOf([
      task(),
      task({ id: 't2', name: 'Modello dati' }),
      task({ id: 't3', name: 'Collaudo' }),
    ]);
    // t3 to the front. Every other row shifts down, so the first difference is
    // "Collaudo" arriving where the first task used to be — and naming the row
    // it displaced would name the wrong one.
    const dragged = projectOf([
      task({ id: 't3', name: 'Collaudo' }),
      task(),
      task({ id: 't2', name: 'Modello dati' }),
    ]);
    expect(describeChange(three, dragged)).toBe('reordered "Collaudo"');
  });

  it('says nothing more than a reorder when several rows changed places', () => {
    const three = projectOf([
      task(),
      task({ id: 't2', name: 'Modello dati' }),
      task({ id: 't3', name: 'Collaudo' }),
    ]);
    const shuffled = projectOf([
      task({ id: 't3', name: 'Collaudo' }),
      task({ id: 't2', name: 'Modello dati' }),
      task(),
    ]);
    expect(describeChange(three, shuffled)).toBe('reordered tasks');
  });

  it('tells a dependency added from one removed', () => {
    const linked = projectOf([task(), task({ id: 't2', name: 'Modello dati', predecessors: ['t1'] })]);
    expect(describeChange(before, linked)).toBe('added a dependency');
    expect(describeChange(linked, before)).toBe('removed a dependency');
  });

  it('tells a task re-parented from a task edited', () => {
    const nested = projectOf([task(), task({ id: 't2', name: 'Modello dati', parentId: 't1' })]);
    expect(describeChange(before, nested)).toBe('moved "Modello dati"');
    const later = projectOf([task({ start: at(4) }), task({ id: 't2', name: 'Modello dati' })]);
    expect(describeChange(before, later)).toBe('edited "Requisiti"');
  });

  it('names people and calendar changes before task ones', () => {
    const staffed = projectOf([task({ resourceId: 'r1' }), task({ id: 't2', name: 'Modello dati' })], {
      resources: [{ id: 'r1', name: 'Marco Bianchi' }],
    });
    // The assignment moved too, and the person arriving is the reason why.
    expect(describeChange(before, staffed)).toBe('added "Marco Bianchi"');
    expect(describeChange(staffed, before)).toBe('removed "Marco Bianchi"');
    const shutdown = projectOf(before.tasks, {
      calendar: { ...before.calendar, holidays: [{ from: '2026-12-24', to: '2026-12-31' }] },
    });
    expect(describeChange(before, shutdown)).toBe('changed calendar');
  });

  it('does not mistake a reordered availability list for the same one', () => {
    const periods = [
      { from: '2026-09-07', to: '2026-09-11', availability: 0.5 },
      { from: '2026-09-09', to: '2026-09-09', availability: 0 },
    ];
    const withPeriods = projectOf(before.tasks, {
      resources: [{ id: 'r1', name: 'Elena Rossi', availabilityOverrides: periods }],
    });
    const reordered = projectOf(before.tasks, {
      resources: [{ id: 'r1', name: 'Elena Rossi', availabilityOverrides: [...periods].reverse() }],
    });
    // The last override declared wins, so the order is meaning, not noise.
    expect(describeChange(withPeriods, reordered)).toBe('changed people');
    expect(describeChange(withPeriods, withPeriods)).toBe(GENERIC_CHANGE);
  });

  it('names a task with no name at all', () => {
    expect(describeChange(projectOf([]), projectOf([task({ name: '  ' })]))).toBe(
      'added "unnamed task"',
    );
  });
});
