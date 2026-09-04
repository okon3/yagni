import { describe, expect, it, vi } from 'vitest';
import { createAgentApi, type AgentApi } from './agentApi';
import type { GanttHandle } from './GanttChart';
import type { TaskDetails } from './TaskDialog';
import type { Resource } from '../scheduler';

const ALICE: Resource = { id: 'r1', name: 'Alice' };

const details = (overrides: Partial<TaskDetails> = {}): TaskDetails => ({
  id: 't1',
  name: 'Analisi',
  nominalDays: 2,
  start: new Date(2026, 8, 7, 8, 0),
  end: new Date(2026, 8, 8, 17, 0),
  resourceId: 'r1',
  color: '#3b82f6',
  ownsColor: true,
  progress: 0,
  isSummary: false,
  descendantCount: 0,
  elapsedDays: 2,
  effortDays: 2,
  shared: false,
  contended: false,
  disabled: false,
  ...overrides,
});

/**
 * The API against a handle that only answers what these writes ask it, so a
 * call reaching the chart is visible as a call on the spy.
 */
function harness(task: TaskDetails = details()) {
  const handle = {
    getResources: () => [ALICE],
    getTaskDetails: (id: string) => (id === task.id ? task : null),
    addTask: vi.fn(() => 'tNew'),
    updateTask: vi.fn(),
  };
  const api: AgentApi = createAgentApi({
    handle: () => handle as unknown as GanttHandle,
    filename: () => 'piano.gantt',
    dirty: () => false,
    setFilename: () => {},
    adopt: () => {},
    newProject: () => {},
  });
  return { api, handle };
}

describe('agent API resource assignment', () => {
  it('refuses an id nobody has, naming it', () => {
    const { api } = harness();
    expect(() => api.addTask({ name: 'T', resourceId: 'nope' })).toThrow(/"nope".*does not exist/);
  });

  it('writes nothing when addTask names an unknown resource', () => {
    const { api, handle } = harness();
    expect(() => api.addTask({ resourceId: 'nope' })).toThrow();
    expect(handle.addTask).not.toHaveBeenCalled();
  });

  it('writes nothing when updateTask names an unknown resource', () => {
    const { api, handle } = harness();
    expect(() => api.updateTask('t1', { resourceId: 'nope' })).toThrow(/does not exist/);
    expect(handle.updateTask).not.toHaveBeenCalled();
  });

  it('accepts a resource the project has', () => {
    const { api, handle } = harness();
    expect(api.addTask({ resourceId: 'r1' })).toBe('tNew');
    api.updateTask('t1', { resourceId: 'r1' });
    expect(handle.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({ resourceId: 'r1' }));
  });

  it('leaves an unassigned write alone', () => {
    const { api, handle } = harness();
    api.addTask({ name: 'T' });
    api.updateTask('t1', { resourceId: null });
    expect(handle.addTask).toHaveBeenCalledWith(expect.objectContaining({ resourceId: undefined }));
    expect(handle.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({ resourceId: undefined }));
  });
});

describe('agent API disabled flag', () => {
  it('passes a disabled write through to the patch', () => {
    const { api, handle } = harness();
    api.updateTask('t1', { disabled: true });
    expect(handle.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({ disabled: true }));
  });

  it('keeps the current flag when the caller leaves it out', () => {
    const { api, handle } = harness(details({ disabled: true }));
    api.updateTask('t1', { name: 'Rinominata' });
    expect(handle.updateTask).toHaveBeenCalledWith('t1', expect.objectContaining({ disabled: true }));
  });

  it('passes it through addTask too', () => {
    const { api, handle } = harness();
    api.addTask({ name: 'T', disabled: true });
    expect(handle.addTask).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
  });
});
