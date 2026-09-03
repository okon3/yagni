import { dayIndexOfString, isDayString } from './dayRange';
import type { Resource } from './types';

/**
 * The share of a full working day a resource can give on a calendar day.
 *
 * An override replaces the default rather than scaling it — somebody at 50%
 * with a period at 25% works at 25% — and where two overlap the last declared
 * wins, so a narrow exception can be carved out of a broad period. Both the
 * simulation and the timeline shading resolve capacity through here, or the
 * chart could show an absence the schedule does not honour.
 */
export function availabilityOnDay(resource: Resource, day: number): number {
  let availability = resource.availability ?? 1;
  for (const override of resource.availabilityOverrides ?? []) {
    if (!isDayString(override.from) || !isDayString(override.to)) continue;
    const first = dayIndexOfString(override.from);
    const last = dayIndexOfString(override.to);
    if (day < Math.min(first, last) || day > Math.max(first, last)) continue;
    availability = Math.max(0, override.availability);
  }
  return availability;
}
