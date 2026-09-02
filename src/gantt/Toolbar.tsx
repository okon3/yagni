export interface ToolbarProps {
  filename: string;
  dirty: boolean;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onAddTask(): void;
  onEditResources(): void;
  onEditCalendar(): void;
  onToday(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomToFit(): void;
}

export function Toolbar({
  filename,
  dirty,
  onNew,
  onOpen,
  onSave,
  onAddTask,
  onEditResources,
  onEditCalendar,
  onToday,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
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
        <button type="button" onClick={onAddTask}>
          Aggiungi attività
        </button>
        <button type="button" onClick={onEditResources}>
          Persone
        </button>
        <button type="button" onClick={onEditCalendar}>
          Calendario
        </button>
      </div>
      <div className="toolbar__group">
        <button type="button" onClick={onToday}>
          Oggi
        </button>
        <button type="button" onClick={onZoomOut} title="Riduci">
          −
        </button>
        <button type="button" onClick={onZoomIn} title="Ingrandisci">
          +
        </button>
        <button type="button" onClick={onZoomToFit}>
          Adatta
        </button>
      </div>
      <span className="toolbar__file">
        {filename}
        {dirty && <span className="toolbar__dirty" title="Modifiche non salvate" />}
      </span>
    </div>
  );
}
