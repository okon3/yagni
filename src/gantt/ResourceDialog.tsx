import { useState } from 'react';
import { countWorkingDaysInRange, type AvailabilityOverride, type Resource } from '../scheduler';
import { AvailabilityList } from './AvailabilityList';
import { Dialog } from './Dialog';
import { nextResourceId, releasedBy, validateResources } from './resources';

export interface ResourceUsage {
  /** Number of tasks assigned to each resource id. */
  taskCounts: Map<string, number>;
}

interface DraftResource {
  id: string;
  name: string;
  /** Percentage, 100 = full time. Kept as text so a half-typed value survives. */
  availability: string;
  periods: AvailabilityOverride[];
}

function toDraft(resources: Resource[]): DraftResource[] {
  return resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    availability: String(Math.round((resource.availability ?? 1) * 100)),
    periods: resource.availabilityOverrides ?? [],
  }));
}

/**
 * The drafts as the model would hold them.
 *
 * The percentage is the form's own unit; everything downstream — the rules, the
 * engine, the file — works in fractions of a working day.
 */
function toResources(drafts: DraftResource[]): Resource[] {
  return drafts.map((draft) => ({
    id: draft.id,
    name: draft.name.trim(),
    availability: Number(draft.availability) / 100,
    ...(draft.periods.length > 0 ? { availabilityOverrides: draft.periods } : {}),
  }));
}

/** Mounted only while open, so the drafts initialise from props without an effect. */
export function ResourceDialog({
  resources,
  usage,
  workingWeekdays,
  confirm,
  onCancel,
  onSave,
}: {
  resources: Resource[];
  usage: ResourceUsage;
  workingWeekdays: number[];
  /** Native dialogs are suppressed in embedded browsers; App owns the real one. */
  confirm(message: string, confirmLabel: string): Promise<boolean>;
  onCancel(): void;
  onSave(resources: Resource[], releasedTaskIds: string[]): void;
}) {
  const [drafts, setDrafts] = useState<DraftResource[]>(() => toDraft(resources));
  const [error, setError] = useState<string | null>(null);
  /** Which person's absences are expanded; only one at a time keeps it readable. */
  const [expanded, setExpanded] = useState<string | null>(null);

  /** Short summary for the collapsed row: how many days are away, how many reduced. */
  const periodSummary = (draft: DraftResource) => {
    let away = 0;
    let reduced = 0;
    for (const period of draft.periods) {
      const working = countWorkingDaysInRange(period, workingWeekdays);
      if (period.availability === 0) away += working;
      else reduced += working;
    }
    if (away === 0 && reduced === 0) return 'none';
    const parts = [];
    if (away > 0) parts.push(`${away} d away`);
    if (reduced > 0) parts.push(`${reduced} d reduced`);
    return parts.join(', ');
  };

  const update = (index: number, patch: Partial<DraftResource>) => {
    setDrafts((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  };

  const remove = async (index: number) => {
    const draft = drafts[index];
    const assigned = usage.taskCounts.get(draft.id) ?? 0;
    if (assigned > 0) {
      const confirmed = await confirm(
        `${draft.name || 'This resource'} is assigned to ${assigned} tasks. ` +
          'Removing it leaves those tasks with no resource, and they will no longer share effort. Continue?',
        'Remove',
      );
      if (!confirmed) return;
    }
    setDrafts((current) => current.filter((_, position) => position !== index));
  };

  const add = () => {
    setDrafts((current) => [
      ...current,
      { id: nextResourceId(toResources(current)), name: '', availability: '100', periods: [] },
    ]);
  };

  const save = () => {
    const next = toResources(drafts);
    const problem = validateResources(next);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(next, releasedBy(resources, next));
  };

  return (
    <Dialog
      title="People"
      width={640}
      className="people"
      onDismiss={onCancel}
      error={error}
      footer={
        <>
          <button type="button" className="dialog__btn" onClick={add}>
            Add person
          </button>
          <span className="dialog__spacer" />
          <button type="button" className="dialog__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog__btn dialog__btn--primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog__hint">
        Availability is the share of a working day the person gives to the project: 50% means half
        a day. In <strong>periods</strong> you can override it for specific ranges — 0% is an
        absence. Available effort is still split evenly across concurrent tasks.
      </p>

      <table className="people__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Availability</th>
            <th>Periods</th>
            <th>Tasks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {drafts.flatMap((draft, index) => [
            <tr key={draft.id}>
              <td>
                <input
                  className="dialog__control"
                  value={draft.name}
                  placeholder="Full name"
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </td>
              <td>
                <input
                  className="dialog__control people__pct"
                  type="number"
                  min={1}
                  max={100}
                  value={draft.availability}
                  onChange={(event) => update(index, { availability: event.target.value })}
                />
                <span className="dialog__unit">%</span>
              </td>
              <td className="people__count">
                <button
                  type="button"
                  className={`people__absences${
                    expanded === draft.id ? ' people__absences--open' : ''
                  }`}
                  onClick={() => setExpanded(expanded === draft.id ? null : draft.id)}
                >
                  {periodSummary(draft)}
                </button>
              </td>
              <td className="people__count">{usage.taskCounts.get(draft.id) ?? 0}</td>
              <td>
                <button
                  type="button"
                  className="dialog__btn dialog__btn--danger people__remove"
                  onClick={() => void remove(index)}
                  title="Remove"
                >
                  ✕
                </button>
              </td>
            </tr>,
            expanded === draft.id ? (
              <tr key={`${draft.id}-off`} className="people__offRow">
                <td colSpan={5}>
                  <AvailabilityList
                    periods={draft.periods}
                    workingWeekdays={workingWeekdays}
                    onChange={(periods) => update(index, { periods })}
                  />
                </td>
              </tr>
            ) : null,
          ])}
          {drafts.length === 0 && (
            <tr>
              <td colSpan={5} className="people__empty">
                No people yet. Add one to be able to assign tasks.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
