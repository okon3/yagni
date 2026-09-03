import { CRITICAL_CHAIN_LIMIT } from './project';

export interface StatusBarProps {
  taskCount: number;
  /** Label of the active zoom level, already localised by the chart. */
  scale: string;
  /** Whether the tasks the end date depends on are outlined on the chart. */
  markCritical: boolean;
  /** False on a plan too big to measure, where the toggle has nothing to show. */
  canMarkCritical: boolean;
  onCollapseAll(): void;
  onExpandAll(): void;
  onToggleCritical(): void;
  onToday(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomToFit(): void;
}

export function StatusBar({
  taskCount,
  scale,
  markCritical,
  canMarkCritical,
  onCollapseAll,
  onExpandAll,
  onToggleCritical,
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
      {/* The reason is on the face of the bar, not only in the tooltip: a
          control that is simply dead is read as broken. */}
      <button
        type="button"
        className={`statusbar__critical${markCritical && canMarkCritical ? ' statusbar__critical--on' : ''}`}
        disabled={!canMarkCritical}
        aria-pressed={markCritical && canMarkCritical}
        title={
          canMarkCritical
            ? 'Evidenzia le attività da cui dipende la data di fine'
            : `Oltre ${CRITICAL_CHAIN_LIMIT} attività il calcolo non viene eseguito: costa un ricalcolo del piano per ogni attività`
        }
        onClick={onToggleCritical}
      >
        Catena critica
        {!canMarkCritical && <span className="statusbar__off"> non calcolata</span>}
      </button>
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
