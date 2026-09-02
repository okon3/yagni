export interface StatusBarProps {
  taskCount: number;
  /** Label of the active zoom level, already localised by the chart. */
  scale: string;
  onToday(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomToFit(): void;
}

export function StatusBar({
  taskCount,
  scale,
  onToday,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>{taskCount} attività</span>
      <span className="statusbar__spacer" />
      <button type="button" onClick={onToday}>
        Oggi
      </button>
      <span className="statusbar__scale">
        Scala: <strong>{scale}</strong>
      </span>
      <div className="statusbar__zoom">
        <button type="button" onClick={onZoomOut} title="Riduci">
          −
        </button>
        <button type="button" onClick={onZoomIn} title="Ingrandisci">
          +
        </button>
      </div>
      <button type="button" onClick={onZoomToFit}>
        Adatta
      </button>
    </footer>
  );
}
