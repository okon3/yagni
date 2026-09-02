import { CyclicDependencyError, UnknownPredecessorError, type Task, type TaskId } from './types';

/**
 * Rejects unknown predecessors and dependency cycles before simulation.
 *
 * The simulation would otherwise deadlock on a cycle — every task in it waits for
 * a predecessor that can never finish — and report it as an unreachable state
 * instead of pointing at the offending tasks.
 */
export function assertAcyclic(tasks: Task[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const predecessorId of task.predecessors ?? []) {
      if (!byId.has(predecessorId)) {
        throw new UnknownPredecessorError(task.id, predecessorId);
      }
    }
  }

  const visiting = new Set<TaskId>();
  const done = new Set<TaskId>();
  const path: TaskId[] = [];

  const visit = (id: TaskId): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new CyclicDependencyError([...path.slice(path.indexOf(id)), id]);
    }
    visiting.add(id);
    path.push(id);
    for (const predecessorId of byId.get(id)?.predecessors ?? []) visit(predecessorId);
    path.pop();
    visiting.delete(id);
    done.add(id);
  };

  for (const task of tasks) visit(task.id);
}

export function buildSuccessorIndex(tasks: Task[]): Map<TaskId, TaskId[]> {
  const successors = new Map<TaskId, TaskId[]>();
  for (const task of tasks) {
    for (const predecessorId of task.predecessors ?? []) {
      const list = successors.get(predecessorId);
      if (list) list.push(task.id);
      else successors.set(predecessorId, [task.id]);
    }
  }
  return successors;
}
