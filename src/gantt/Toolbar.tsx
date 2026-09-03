import type { Resource } from '../scheduler';
import { avatarColorOf, initialsOf } from './colors';

export interface ToolbarProps {
  filename: string;
  dirty: boolean;
  people: Resource[];
  /** Whose highlight is pinned, as opposed to borrowed by a hover. */
  pinned: string | null;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
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
  onNew,
  onOpen,
  onSave,
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
