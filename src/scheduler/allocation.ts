import type { Resource, TaskId } from './types';

export interface AllocationCandidate {
  id: TaskId;
  /** Man-minutes still to burn. */
  remaining: number;
}

export interface AllocationRequest {
  /** Absent for the pool of unassigned tasks, which never contend. */
  resource: Resource | undefined;
  candidates: AllocationCandidate[];
}

/**
 * Decides how much of a resource each concurrently active task receives.
 *
 * Rates are fractions of a full-time resource, so 0.5 means the task burns one
 * man-minute every two working minutes. Per-task fixed or capped allocation
 * plugs in here: only this function has to change, the simulation loop does not.
 */
export type AllocationPolicy = (request: AllocationRequest) => Map<TaskId, number>;

/** Splits the resource evenly, which is what makes two concurrent tasks run at 50%. */
export const equalSplit: AllocationPolicy = ({ resource, candidates }) => {
  const rates = new Map<TaskId, number>();
  if (candidates.length === 0) return rates;
  // Unassigned tasks have no owner to share, so each one progresses at full rate.
  const capacity = resource ? (resource.availability ?? 1) : candidates.length;
  const rate = capacity / candidates.length;
  for (const candidate of candidates) rates.set(candidate.id, rate);
  return rates;
};
