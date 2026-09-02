import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../scheduler';
import { sampleProject, type Project } from './project';
import {
  FILE_VERSION,
  ProjectFileError,
  deserializeProject,
  serializeProject,
} from './serialization';

describe('round trip', () => {
  it('preserves the sample project', () => {
    const restored = deserializeProject(serializeProject(sampleProject));
    expect(restored.tasks).toEqual(sampleProject.tasks);
    expect(restored.resources).toEqual(sampleProject.resources);
    expect(restored.calendar).toEqual(sampleProject.calendar);
  });

  it('keeps the local wall-clock date, not the UTC instant', () => {
    // 08:00 local would roll back to the previous day if serialized as UTC.
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [],
      tasks: [{ id: '1', name: 'A', nominalDays: 1, start: new Date(2026, 0, 5, 8, 0) }],
    };
    const text = serializeProject(project);
    expect(text).toContain('2026-01-05T08:00');
    const restored = deserializeProject(text);
    expect(restored.tasks[0].start.getDate()).toBe(5);
    expect(restored.tasks[0].start.getHours()).toBe(8);
  });

  it('preserves partial staffing', () => {
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [
        { id: 'r1', name: 'Mezza giornata', availability: 0.5 },
        { id: 'r2', name: 'Pieno', availability: 1 },
      ],
      tasks: [{ id: '1', name: 'A', nominalDays: 2, start: new Date(2026, 0, 5, 8, 0), resourceId: 'r1' }],
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.resources[0].availability).toBe(0.5);
    expect(restored.resources[1].availability).toBe(1);
  });

  it('preserves the hierarchy and the bar colour', () => {
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [{ id: 'r1', name: 'Alice' }],
      tasks: [
        { id: 'p', name: 'Parent', nominalDays: 0, start: new Date(2026, 0, 5, 8, 0) },
        {
          id: 'c',
          name: 'Child',
          nominalDays: 2,
          start: new Date(2026, 0, 5, 8, 0),
          parentId: 'p',
          resourceId: 'r1',
          color: '#2f9e6e',
        },
      ],
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.tasks[1].parentId).toBe('p');
    expect(restored.tasks[1].color).toBe('#2f9e6e');
  });

  it('preserves company shutdowns and personal absences', () => {
    const project: Project = {
      calendar: {
        ...DEFAULT_CALENDAR,
        workingDays: [1, 2, 3, 4],
        holidays: [
          { from: '2026-12-24', to: '2027-01-06', label: 'Chiusura invernale' },
          { from: '2026-08-14', to: '2026-08-14' },
        ],
      },
      resources: [
        {
          id: 'r1',
          name: 'Marta',
          availability: 0.5,
          daysOff: [{ from: '2026-07-01', to: '2026-07-15', label: 'Ferie' }],
        },
        { id: 'r2', name: 'Ugo' },
      ],
      tasks: [
        { id: '1', name: 'A', nominalDays: 2, start: new Date(2026, 5, 1, 8, 0), resourceId: 'r1' },
      ],
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.calendar.holidays).toEqual(project.calendar.holidays);
    expect(restored.calendar.workingDays).toEqual([1, 2, 3, 4]);
    expect(restored.resources[0].daysOff).toEqual(project.resources[0].daysOff);
    // A resource with no absences must not gain an empty array.
    expect(restored.resources[1].daysOff).toBeUndefined();
  });

  it('survives a DST boundary', () => {
    // Italy moves the clock on the last Sunday of March.
    const project: Project = {
      calendar: DEFAULT_CALENDAR,
      resources: [],
      tasks: [{ id: '1', name: 'A', nominalDays: 1, start: new Date(2026, 2, 29, 8, 0) }],
    };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.tasks[0].start.getDate()).toBe(29);
    expect(restored.tasks[0].start.getHours()).toBe(8);
  });
});

describe('rejects broken files', () => {
  const cases: [string, string][] = [
    ['not json', 'nope{'],
    ['a foreign format', JSON.stringify({ format: 'something-else', version: 1 })],
    [
      'a future version',
      JSON.stringify({ format: 'gantt-effort-split', version: FILE_VERSION + 1 }),
    ],
    [
      'a malformed date',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        tasks: [{ id: '1', nominalDays: 1, start: '05/01/2026' }],
      }),
    ],
    [
      'a duplicate task id',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        tasks: [
          { id: '1', nominalDays: 1, start: '2026-01-05T08:00' },
          { id: '1', nominalDays: 1, start: '2026-01-06T08:00' },
        ],
      }),
    ],
    [
      'a task assigned to an unknown resource',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        resources: [],
        tasks: [{ id: '1', nominalDays: 1, start: '2026-01-05T08:00', resourceId: 'ghost' }],
      }),
    ],
    [
      'a parent that does not exist',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        tasks: [{ id: '1', nominalDays: 1, start: '2026-01-05T08:00', parentId: 'ghost' }],
      }),
    ],
    [
      'a circular hierarchy',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        tasks: [
          { id: '1', nominalDays: 1, start: '2026-01-05T08:00', parentId: '2' },
          { id: '2', nominalDays: 1, start: '2026-01-05T08:00', parentId: '1' },
        ],
      }),
    ],
    [
      'a malformed holiday date',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        calendar: { workingDays: [1], windows: [{ from: 480, to: 960 }], holidays: [{ from: '24/12/2026', to: '2026-12-24' }] },
        tasks: [],
      }),
    ],
    [
      'an absence that is not a day range',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        resources: [{ id: 'r1', name: 'X', daysOff: [{ from: '2026-07-01' }] }],
        tasks: [],
      }),
    ],
    [
      'a dangling predecessor',
      JSON.stringify({
        format: 'gantt-effort-split',
        version: 1,
        tasks: [{ id: '1', nominalDays: 1, start: '2026-01-05T08:00', predecessors: ['99'] }],
      }),
    ],
  ];

  for (const [label, text] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => deserializeProject(text)).toThrow(ProjectFileError);
    });
  }

  it('accepts a file with no tasks', () => {
    const project = deserializeProject(
      JSON.stringify({ format: 'gantt-effort-split', version: 1 }),
    );
    expect(project.tasks).toEqual([]);
    expect(project.calendar).toEqual(DEFAULT_CALENDAR);
  });
});
