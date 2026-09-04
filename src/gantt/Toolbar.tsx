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
  onPrint(): void;
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
  onPrint,
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
          New
        </button>
        <button type="button" onClick={onOpen}>
          Open
        </button>
        <button type="button" onClick={onSave}>
          Save
        </button>
      </div>
      {/* Its own group rather than beside Save: what Save writes is the
          project, what this writes is the schedule derived from it — a file
          that comes back in is one thing, a file that only goes out is
          another. */}
      <div className="toolbar__group" role="group" aria-label="Export">
        <button
          type="button"
          onClick={onExportCsv}
          title="Export the solved plan to CSV (dates, effort and durations)"
        >
          CSV
        </button>
        <button
          type="button"
          onClick={onExportPng}
          title="Export the plan as a PNG image"
        >
          PNG
        </button>
        <button
          type="button"
          onClick={onPrint}
          title="Print the plan, or save it as PDF from the print dialog (Ctrl+P)"
        >
          Print
        </button>
      </div>
      <div className="toolbar__group">
        {/* The title names the step rather than only saying there is one: a
            plan is edited from the grid, the bars, the dialogs and a script
            alike, and a bare "Undo" leaves the user guessing which of them
            is about to be taken back. */}
        <button
          type="button"
          className="toolbar__icon"
          onClick={onUndo}
          disabled={undoing === null}
          aria-label={undoing ? `Undo: ${undoing}` : 'Undo change'}
          title={undoing ? `Undo: ${undoing} (Ctrl+Z)` : 'Nothing to undo'}
        >
          ↶
        </button>
        <button
          type="button"
          className="toolbar__icon"
          onClick={onRedo}
          disabled={redoing === null}
          aria-label={redoing ? `Redo: ${redoing}` : 'Redo change'}
          title={redoing ? `Redo: ${redoing} (Ctrl+Shift+Z)` : 'Nothing to redo'}
        >
          ↷
        </button>
      </div>
      <div className="toolbar__group">
        <button type="button" className="toolbar__primary" onClick={onAddTask}>
          Add task
        </button>
        <button type="button" onClick={onEditResources}>
          People
        </button>
        <button type="button" onClick={onEditCalendar}>
          Calendar
        </button>
      </div>
      {people.length > 0 && (
        <div className="toolbar__group toolbar__people" role="group" aria-label="Highlight">
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
                title={on ? `Stop highlighting ${person.name}` : `Highlight ${person.name}`}
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
        {dirty && <span className="toolbar__dirty" title="Unsaved changes" />}
      </span>
    </div>
  );
}
