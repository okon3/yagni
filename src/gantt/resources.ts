import type { AvailabilityOverride, Resource } from '../scheduler';

/**
 * The rules and transformations of the people list, with no form and no chart
 * around them.
 *
 * `ResourceDialog`, the agent API and the file parser all go through here: the
 * validation rules and the released-resource diff decide whether tasks silently
 * lose their assignee, which is not a thing that may exist in two versions.
 *
 * Availability is a fraction of a full working day, as the model and the file
 * format hold it. The percentage is the form's own unit and stays in the form.
 */
export interface ResourcePatch {
  name?: string;
  /** Share of a full working day, `0..1`. */
  availability?: number;
  availabilityOverrides?: AvailabilityOverride[];
}

/** `r{n+1}`, ignoring any id that does not follow the pattern. */
export function nextResourceId(resources: Resource[]): string {
  const highest = resources.reduce((max, resource) => {
    const match = /^r(\d+)$/.exec(resource.id);
    const numeric = match ? Number(match[1]) : 0;
    return numeric > max ? numeric : max;
  }, 0);
  return `r${highest + 1}`;
}

/**
 * An empty override list is omitted rather than stored, to keep the saved file
 * free of fields that say nothing.
 */
function applied(resource: Resource, patch: ResourcePatch): Resource {
  const overrides = patch.availabilityOverrides ?? resource.availabilityOverrides ?? [];
  const next: Resource = {
    id: resource.id,
    name: (patch.name ?? resource.name).trim(),
    availability: patch.availability ?? resource.availability ?? 1,
  };
  if (overrides.length > 0) next.availabilityOverrides = overrides;
  return next;
}

export function withResourceAdded(resources: Resource[], patch: ResourcePatch): Resource[] {
  const blank: Resource = { id: nextResourceId(resources), name: '', availability: 1 };
  return [...resources, applied(blank, patch)];
}

export function withResourceUpdated(
  resources: Resource[],
  id: string,
  patch: ResourcePatch,
): Resource[] {
  return resources.map((resource) => (resource.id === id ? applied(resource, patch) : resource));
}

export function withResourceRemoved(resources: Resource[], id: string): Resource[] {
  return resources.filter((resource) => resource.id !== id);
}

/** Replaces the whole ordered list: where two overrides overlap, the last wins. */
export function withAvailability(
  resources: Resource[],
  id: string,
  overrides: AvailabilityOverride[],
): Resource[] {
  return withResourceUpdated(resources, id, { availabilityOverrides: overrides });
}

/**
 * The first thing wrong with the list, or null.
 *
 * The message is user-facing Italian: it reaches the dialog's error line and the
 * `Error` an agent gets back.
 */
export function validateResources(resources: Resource[]): string | null {
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  for (const resource of resources) {
    const name = resource.name.trim();
    if (!name) return 'Ogni persona deve avere un nome';
    if (seenNames.has(name.toLowerCase())) return `Nome duplicato: "${name}"`;
    seenNames.add(name.toLowerCase());
    if (seenIds.has(resource.id)) return `Id duplicato: "${resource.id}"`;
    seenIds.add(resource.id);
    const availability = resource.availability ?? 1;
    // Zero is refused as a default because a person who never works is a person
    // to remove; as an override it is exactly how an absence is expressed.
    if (!Number.isFinite(availability) || availability <= 0 || availability > 1) {
      return `Disponibilità non valida per "${name}": attesa una quota fra 0 (escluso) e 1`;
    }
    for (const period of resource.availabilityOverrides ?? []) {
      if (!period.from || !period.to) return `Un periodo di "${name}" non ha inizio o fine`;
      if (period.availability < 0 || period.availability > 1) {
        return `Un periodo di "${name}" ha una quota fuori da 0..1`;
      }
    }
  }
  return null;
}

/**
 * The resources that `next` no longer has.
 *
 * Their tasks are released to "no resource"; getting this list wrong unassigns
 * somebody's work without saying so, which is why the caller never builds it.
 */
export function releasedBy(previous: Resource[], next: Resource[]): string[] {
  const surviving = new Set(next.map((resource) => resource.id));
  return previous.map((resource) => resource.id).filter((id) => !surviving.has(id));
}
