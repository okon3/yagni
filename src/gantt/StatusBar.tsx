export interface StatusBarProps {
  taskCount: number;
  /** Label of the active zoom level, already localised by the chart. */
  scale: string;
  onCollapseAll(): void;
  onExpandAll(): void;
  onToday(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomToFit(): void;
}

export function StatusBar({
  taskCount,
  scale,
  onCollapseAll,
  onExpandAll,
  onToday,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>{taskCount} attività</span>
      <div className="statusbar__rows">
        <button type="button" onClick={onCollapseAll} title="Comprimi tutte le attività">
          Comprimi
        </button>
        <button type="button" onClick={onExpandAll} title="Espandi tutte le attività">
          Espandi
        </button>
      </div>
      {/* An agent reads the page text and the accessibility tree before it reads
          anything else, so the scripting surface has to be named there. */}
      <span className="statusbar__agent">
        Per agenti: <code>window.yagni.help()</code>
      </span>
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
