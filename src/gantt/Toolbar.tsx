import {
  FilePlus2,
  FolderOpen,
  Save,
  FileSpreadsheet,
  Image,
  Printer,
  Undo2,
  Redo2,
  Plus,
  Users,
  CalendarDays,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
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
  /** Whether the task grid is collapsed to zero width, to render the toggle pressed. */
  gridCollapsed: boolean;
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
  onToggleGridCollapsed(): void;
}

export function Toolbar({
  filename,
  dirty,
  people,
  pinned,
  undoing,
  redoing,
  gridCollapsed,
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
  onToggleGridCollapsed,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button type="button" onClick={onNew}>
          <FilePlus2 size={15} />
          New
        </button>
        <button type="button" onClick={onOpen}>
          <FolderOpen size={15} />
          Open
        </button>
        <button type="button" onClick={onSave}>
          <Save size={15} />
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
          <FileSpreadsheet size={15} />
          CSV
        </button>
        <button
          type="button"
          onClick={onExportPng}
          title="Export the plan as a PNG image"
        >
          <Image size={15} />
          PNG
        </button>
        <button
          type="button"
          onClick={onPrint}
          title="Print the plan, or save it as PDF from the print dialog (Ctrl+P)"
        >
          <Printer size={15} />
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
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="toolbar__icon"
          onClick={onRedo}
          disabled={redoing === null}
          aria-label={redoing ? `Redo: ${redoing}` : 'Redo change'}
          title={redoing ? `Redo: ${redoing} (Ctrl+Shift+Z)` : 'Nothing to redo'}
        >
          <Redo2 size={15} />
        </button>
      </div>
      <div className="toolbar__group">
        <button type="button" className="toolbar__primary" onClick={onAddTask}>
          <Plus size={15} />
          Add task
        </button>
        <button type="button" onClick={onEditResources}>
          <Users size={15} />
          People
        </button>
        <button type="button" onClick={onEditCalendar}>
          <CalendarDays size={15} />
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
      <div className="toolbar__group">
        <button
          type="button"
          className={`toolbar__icon${gridCollapsed ? ' toolbar__icon--on' : ''}`}
          onClick={onToggleGridCollapsed}
          aria-pressed={gridCollapsed}
          aria-label={gridCollapsed ? 'Show the task grid' : 'Hide the task grid'}
          title={gridCollapsed ? 'Show the task grid' : 'Hide the task grid, for the chart alone'}
        >
          {gridCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      <span className="toolbar__file">
        {filename}
        {dirty && <span className="toolbar__dirty" title="Unsaved changes" />}
      </span>
    </div>
  );
}
