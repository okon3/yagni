import type { Resource } from '../scheduler';
import { avatarColorOf, initialsOf } from './colors';

export interface ToolbarProps {
  filename: string;
  dirty: boolean;
  people: Resource[];
  /** Whose highlight is pinned, as opposed to borrowed by a hover. */
  pinned: string | null;
  /** What the next undo would take back, or null when there is nothing to undo. */
  undoing: string | null;
  redoing: string | null;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onExportCsv(): void;
  onExportPng(): void;
  onUndo(): void;
  onRedo(): void;
  onAddTask(): void;
  onEditResources(): void;
  onEditCalendar(): void;
  onHighlight(resourceId: string | null): void;
}

export function Toolbar({
  filename,
  dirty,
  people,
  pinned,
  undoing,
  redoing,
  onNew,
  onOpen,
  onSave,
  onExportCsv,
  onExportPng,
  onUndo,
  onRedo,
  onAddTask,
  onEditResources,
  onEditCalendar,
  onHighlight,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button type="button" onClick={onNew}>
          Nuovo
        </button>
        <button type="button" onClick={onOpen}>
          Apri
        </button>
        <button type="button" onClick={onSave}>
          Salva
        </button>
      </div>
      {/* Its own group rather than beside Salva: what Salva writes is the
          project, what this writes is the schedule derived from it — a file
          that comes back in is one thing, a file that only goes out is
          another. */}
      <div className="toolbar__group" role="group" aria-label="Esporta">
        <button
          type="button"
          onClick={onExportCsv}
          title="Esporta il piano risolto in CSV (date, effort e durate)"
        >
          CSV
        </button>
        <button
          type="button"
          onClick={onExportPng}
          title="Esporta il piano come immagine PNG"
        >
          PNG
        </button>
      </div>
      <div className="toolbar__group">
        {/* The title names the step rather than only saying there is one: a
            plan is edited from the grid, the bars, the dialogs and a script
            alike, and a bare "Annulla" leaves the user guessing which of them
            is about to be taken back. */}
        <button
          type="button"
          className="toolbar__icon"
          onClick={onUndo}
          disabled={undoing === null}
          aria-label={undoing ? `Annulla: ${undoing}` : 'Annulla modifica'}
          title={undoing ? `Annulla: ${undoing} (Ctrl+Z)` : 'Niente da annullare'}
        >
          ↶
        </button>
        <button
          type="button"
          className="toolbar__icon"
          onClick={onRedo}
          disabled={redoing === null}
          aria-label={redoing ? `Ripeti: ${redoing}` : 'Ripeti modifica'}
          title={redoing ? `Ripeti: ${redoing} (Ctrl+Shift+Z)` : 'Niente da ripetere'}
        >
          ↷
        </button>
      </div>
      <div className="toolbar__group">
        <button type="button" className="toolbar__primary" onClick={onAddTask}>
          Aggiungi attività
        </button>
        <button type="button" onClick={onEditResources}>
          Persone
        </button>
        <button type="button" onClick={onEditCalendar}>
          Calendario
        </button>
      </div>
      {people.length > 0 && (
        <div className="toolbar__group toolbar__people" role="group" aria-label="Evidenzia">
          {people.map((person) => {
            // The ring follows the pin, never the hover: what is pinned has to
            // stay readable while the pointer borrows the highlight elsewhere.
            const on = pinned === person.id;
            return (
              <button
                key={person.id}
                type="button"
                className={`toolbar__person${on ? ' toolbar__person--on' : ''}`}
                // Inline, like the avatars in the grid: the same person must
                // carry the same colour in both places.
                style={{ background: avatarColorOf(person.name) }}
                aria-pressed={on}
                title={on ? `Non evidenziare più ${person.name}` : `Evidenzia ${person.name}`}
                // Hovering highlights this person for as long as the pointer
                // stays, wherever their avatar is: App tracks the attribute
                // rather than a handler of this button's own.
                data-resource-id={person.id}
                onClick={() => onHighlight(on ? null : person.id)}
              >
                {initialsOf(person.name)}
              </button>
            );
          })}
        </div>
      )}
      <span className="toolbar__file">
        {filename}
        {dirty && <span className="toolbar__dirty" title="Modifiche non salvate" />}
      </span>
    </div>
  );
}
