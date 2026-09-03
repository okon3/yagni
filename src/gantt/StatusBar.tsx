import { CRITICAL_CHAIN_LIMIT, type ChainState } from './project';

export interface StatusBarProps {
  taskCount: number;
  /** Label of the active zoom level, already localised by the chart. */
  scale: string;
  /** What the chart is showing of the critical chain, which decides what the control offers. */
  chainState: ChainState;
  onCollapseAll(): void;
  onExpandAll(): void;
  onCriticalChain(): void;
  onToday(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomToFit(): void;
}

/**
 * One control, and the label always says what the click does.
 *
 * A current answer is there to be hidden; anything else is there to be asked
 * for. Past the limit nothing measures on its own, so the wording changes from
 * a switch to a request — and once an edit has outdated the answer, to a
 * request to do it again.
 */
const CHAIN_LABEL: Record<ChainState, string> = {
  off: 'Catena critica',
  live: 'Catena critica',
  fresh: 'Catena critica',
  asked: 'Calcola catena critica',
  stale: 'Ricalcola catena critica',
};

const CHAIN_TITLE: Record<ChainState, string> = {
  off: 'Evidenzia le attività da cui dipende la data di fine',
  live: 'Non evidenziare più le attività critiche',
  fresh: `Calcolata su richiesta: oltre ${CRITICAL_CHAIN_LIMIT} attività non si aggiorna da sola`,
  asked: `Oltre ${CRITICAL_CHAIN_LIMIT} attività si calcola su richiesta: costa un ricalcolo del piano per ogni attività`,
  stale: 'Il piano è cambiato dopo il calcolo: il tratteggio è la marcatura di prima',
};

/** Drawn on the chart, so the control shows itself as pressed. */
const CHAIN_SHOWN: Record<ChainState, boolean> = {
  off: false,
  live: true,
  fresh: true,
  asked: false,
  stale: true,
};

export function StatusBar({
  taskCount,
  scale,
  chainState,
  onCollapseAll,
  onExpandAll,
  onCriticalChain,
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
      {/* Never disabled: a control that is dead reads as broken, and past the
          limit there is something to offer — the measurement itself. */}
      <button
        type="button"
        className={
          'statusbar__critical' +
          (CHAIN_SHOWN[chainState] ? ' statusbar__critical--on' : '') +
          (chainState === 'stale' ? ' statusbar__critical--old' : '')
        }
        aria-pressed={CHAIN_SHOWN[chainState]}
        title={CHAIN_TITLE[chainState]}
        onClick={onCriticalChain}
      >
        {CHAIN_LABEL[chainState]}
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
