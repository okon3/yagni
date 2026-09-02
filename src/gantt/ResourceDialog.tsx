import { useEffect, useRef, useState } from 'react';
import { countWorkingDaysInRange, type AvailabilityOverride, type Resource } from '../scheduler';
import { AvailabilityList } from './AvailabilityList';

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

function nextResourceId(drafts: DraftResource[]): string {
  const highest = drafts.reduce((max, draft) => {
    const match = /^r(\d+)$/.exec(draft.id);
    const numeric = match ? Number(match[1]) : 0;
    return numeric > max ? numeric : max;
  }, 0);
  return `r${highest + 1}`;
}

/** Mounted only while open, so the drafts initialise from props without an effect. */
export function ResourceDialog({
  resources,
  usage,
  workingWeekdays,
  onCancel,
  onSave,
}: {
  resources: Resource[];
  usage: ResourceUsage;
  workingWeekdays: number[];
  onCancel(): void;
  onSave(resources: Resource[], releasedTaskIds: string[]): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [drafts, setDrafts] = useState<DraftResource[]>(() => toDraft(resources));
  const [error, setError] = useState<string | null>(null);
  /** Which person's absences are expanded; only one at a time keeps it readable. */
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  /** Short summary for the collapsed row: how many days are away, how many reduced. */
  const periodSummary = (draft: DraftResource) => {
    let away = 0;
    let reduced = 0;
    for (const period of draft.periods) {
      const working = countWorkingDaysInRange(period, workingWeekdays);
      if (period.availability === 0) away += working;
      else reduced += working;
    }
    if (away === 0 && reduced === 0) return 'nessuno';
    const parts = [];
    if (away > 0) parts.push(`${away} g via`);
    if (reduced > 0) parts.push(`${reduced} g ridotti`);
    return parts.join(', ');
  };

  const update = (index: number, patch: Partial<DraftResource>) => {
    setDrafts((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  };

  const remove = (index: number) => {
    const draft = drafts[index];
    const assigned = usage.taskCounts.get(draft.id) ?? 0;
    if (
      assigned > 0 &&
      !window.confirm(
        `${draft.name || 'Questa risorsa'} è assegnata a ${assigned} attività. ` +
          'Rimuovendola, quelle attività restano senza risorsa e non condivideranno più effort. Continuare?',
      )
    ) {
      return;
    }
    setDrafts((current) => current.filter((_, position) => position !== index));
  };

  const add = () => {
    setDrafts((current) => [
      ...current,
      { id: nextResourceId(current), name: '', availability: '100', periods: [] },
    ]);
  };

  const save = () => {
    const cleaned: Resource[] = [];
    const seenNames = new Set<string>();
    for (const draft of drafts) {
      const name = draft.name.trim();
      if (!name) {
        setError('Ogni persona deve avere un nome');
        return;
      }
      if (seenNames.has(name.toLowerCase())) {
        setError(`Nome duplicato: "${name}"`);
        return;
      }
      seenNames.add(name.toLowerCase());
      const percentage = Number(draft.availability);
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
        setError(`Disponibilità non valida per "${name}": usa un valore tra 1 e 100`);
        return;
      }
      const incomplete = draft.periods.find((period) => !period.from || !period.to);
      if (incomplete) {
        setError(`Un periodo di "${name}" non ha inizio o fine`);
        return;
      }
      cleaned.push({
        id: draft.id,
        name,
        availability: percentage / 100,
        // Omitted rather than an empty array, to keep the saved file free of
        // fields that say nothing.
        ...(draft.periods.length > 0 ? { availabilityOverrides: draft.periods } : {}),
      });
    }

    const survivingIds = new Set(cleaned.map((resource) => resource.id));
    const released = [...usage.taskCounts.keys()].filter((id) => !survivingIds.has(id));
    onSave(cleaned, released);
  };

  return (
    <dialog ref={dialog} className="resources" onCancel={onCancel} onClose={onCancel}>
      <h2>Persone</h2>
      <p className="resources__hint">
        La disponibilità è la quota di giornata lavorativa che la persona dedica al progetto: 50%
        significa mezza giornata. Nei <strong>periodi</strong> puoi sovrascriverla per intervalli
        specifici — 0% è un&apos;assenza. L&apos;effort disponibile si divide comunque in parti uguali
        fra le attività concorrenti.
      </p>

      <table className="resources__table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Disponibilità</th>
            <th>Periodi</th>
            <th>Attività</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {drafts.flatMap((draft, index) => [
            <tr key={draft.id}>
              <td>
                <input
                  value={draft.name}
                  placeholder="Nome e cognome"
                  onChange={(event) => update(index, { name: event.target.value })}
                />
              </td>
              <td>
                <input
                  className="resources__pct"
                  type="number"
                  min={1}
                  max={100}
                  value={draft.availability}
                  onChange={(event) => update(index, { availability: event.target.value })}
                />
                <span className="resources__unit">%</span>
              </td>
              <td className="resources__count">
                <button
                  type="button"
                  className={`resources__absences${
                    expanded === draft.id ? ' resources__absences--open' : ''
                  }`}
                  onClick={() => setExpanded(expanded === draft.id ? null : draft.id)}
                >
                  {periodSummary(draft)}
                </button>
              </td>
              <td className="resources__count">{usage.taskCounts.get(draft.id) ?? 0}</td>
              <td>
                <button type="button" onClick={() => remove(index)} title="Rimuovi">
                  ✕
                </button>
              </td>
            </tr>,
            expanded === draft.id ? (
              <tr key={`${draft.id}-off`} className="resources__offRow">
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
              <td colSpan={5} className="resources__empty">
                Nessuna persona. Aggiungine una per poter assegnare le attività.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {error && (
        <p className="resources__error" role="alert">
          {error}
        </p>
      )}

      <div className="resources__actions">
        <button type="button" onClick={add}>
          Aggiungi persona
        </button>
        <span className="resources__spacer" />
        <button type="button" onClick={onCancel}>
          Annulla
        </button>
        <button type="button" className="resources__primary" onClick={save}>
          Salva
        </button>
      </div>
    </dialog>
  );
}
