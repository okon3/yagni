import { useEffect, useRef } from 'react';
import { CRITICAL_CHAIN_LIMIT } from './project';

/**
 * The person both tasks in the diagram are assigned to.
 *
 * Invented, and her avatar is drawn rather than derived: `avatarColorOf` answers
 * for somebody in the project, and nobody in the diagram is.
 */
const PERSON = { initials: 'AL', colour: '#5b6ebd' };

/** The colours a shared bar actually renders with, kept in step with gantt.css. */
const TRACK = '#edf1f7';
const TRACK_LINE = '#c3cddc';
const FILL = '#3b74d6';
const FILL_LINE = '#2a539a';

const DAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D', 'L'];
const COLUMN = 60;
const AXIS_X = 110;
const BAR_HEIGHT = 28;

const dayX = (day: number) => AXIS_X + day * COLUMN;
/** The top edge of the fill for a given rate: the profile hangs from the floor. */
const rateY = (top: number, rate: number) => top + BAR_HEIGHT * (1 - rate);

/**
 * The one thing a Gantt of this kind shows that an ordinary one does not: two
 * tasks on the same person, and the dip in the middle where they share her.
 *
 * Drawn rather than screenshotted. A screenshot would be a binary in the repo
 * that goes stale the first time a colour or a radius changes, and it could not
 * be as legible as this at 620px — the real chart carries a grid, a scale and a
 * toolbar that are noise to the point being made. The geometry below is the same
 * one `segmentBar.ts` computes: the fill hangs from the bottom of the bar and
 * its height is the share of the day that person is giving the task.
 */
function EffortDiagram() {
  const rowA = 44;
  const rowB = 96;
  const label = (x: number, y: number, text: string) => (
    <text x={x} y={y} className="help__pct" textAnchor="middle" dominantBaseline="middle">
      {text}
    </text>
  );

  return (
    <svg
      className="help__diagram"
      viewBox="0 0 620 162"
      role="img"
      aria-label="Due attività della stessa persona che si sovrappongono: nei giorni in comune ciascuna avanza al 50%."
    >
      <defs>
        <clipPath id="help-bar-a">
          <rect x={dayX(0)} y={rowA} width={COLUMN * 8} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} />
        </clipPath>
        <clipPath id="help-bar-b">
          <rect x={dayX(2)} y={rowB} width={COLUMN * 2} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} />
        </clipPath>
      </defs>

      {/* Saturday and Sunday, in the same translucent grey the timeline uses. */}
      <rect x={dayX(5)} y={22} width={COLUMN * 2} height={108} className="help__weekend" />

      {DAYS.map((day, index) => (
        <g key={index}>
          <line x1={dayX(index)} y1={22} x2={dayX(index)} y2={130} className="help__gridline" />
          <text x={dayX(index) + COLUMN / 2} y={14} className="help__day" textAnchor="middle">
            {day}
          </text>
        </g>
      ))}
      <line x1={dayX(8)} y1={22} x2={dayX(8)} y2={130} className="help__gridline" />

      {[
        { y: rowA, name: 'Analisi', effort: '5g' },
        { y: rowB, name: 'Report', effort: '1g' },
      ].map((row) => (
        <g key={row.name}>
          <circle cx={16} cy={row.y + BAR_HEIGHT / 2} r={10} fill={PERSON.colour} />
          <text
            x={16}
            y={row.y + BAR_HEIGHT / 2}
            className="help__avatar"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {PERSON.initials}
          </text>
          <text x={32} y={row.y + BAR_HEIGHT / 2} className="help__rowname" dominantBaseline="middle">
            {row.name} · {row.effort}
          </text>
        </g>
      ))}

      {/* Analisi: five days of effort, at full rate until Report joins it. */}
      <rect
        x={dayX(0)}
        y={rowA}
        width={COLUMN * 8}
        height={BAR_HEIGHT}
        rx={BAR_HEIGHT / 2}
        fill={TRACK}
        stroke={TRACK_LINE}
      />
      <path
        clipPath="url(#help-bar-a)"
        fill={FILL}
        stroke={FILL_LINE}
        strokeWidth={1.5}
        strokeLinejoin="round"
        d={
          `M ${dayX(0)},${rowA + BAR_HEIGHT}` +
          ` L ${dayX(0)},${rateY(rowA, 1)} L ${dayX(2)},${rateY(rowA, 1)}` +
          ` L ${dayX(2)},${rateY(rowA, 0.5)} L ${dayX(4)},${rateY(rowA, 0.5)}` +
          // The weekend is not a pause in working time, so the level carries
          // across it as one segment — exactly as the real bar draws it.
          ` L ${dayX(4)},${rateY(rowA, 1)} L ${dayX(8)},${rateY(rowA, 1)}` +
          ` L ${dayX(8)},${rowA + BAR_HEIGHT} Z`
        }
      />
      {label(dayX(1), rateY(rowA, 1) + BAR_HEIGHT / 2, '100%')}
      {label(dayX(3), rateY(rowA, 0.5) + BAR_HEIGHT / 4, '50%')}
      {label(dayX(6), rateY(rowA, 1) + BAR_HEIGHT / 2, '100%')}

      {/* Report: one day of effort, never alone, so it takes two. */}
      <rect
        x={dayX(2)}
        y={rowB}
        width={COLUMN * 2}
        height={BAR_HEIGHT}
        rx={BAR_HEIGHT / 2}
        fill={TRACK}
        stroke={TRACK_LINE}
      />
      <path
        clipPath="url(#help-bar-b)"
        fill={FILL}
        stroke={FILL_LINE}
        strokeWidth={1.5}
        strokeLinejoin="round"
        d={
          `M ${dayX(2)},${rowB + BAR_HEIGHT}` +
          ` L ${dayX(2)},${rateY(rowB, 0.5)} L ${dayX(4)},${rateY(rowB, 0.5)}` +
          ` L ${dayX(4)},${rowB + BAR_HEIGHT} Z`
        }
      />
      {label(dayX(3), rateY(rowB, 0.5) + BAR_HEIGHT / 4, '50%')}

      {/* Effort against elapsed time: the one comparison the picture exists for. */}
      <path
        className="help__span"
        d={`M ${dayX(0)},${136} L ${dayX(0)},${144} M ${dayX(0)},${140} L ${dayX(8)},${140} M ${dayX(8)},${136} L ${dayX(8)},${144}`}
      />
      <text x={dayX(4)} y={155} className="help__spanlabel" textAnchor="middle">
        5 giornate di effort, 8 giorni di calendario
      </text>
    </svg>
  );
}

/**
 * What the chart is showing, for whoever did not build it.
 *
 * Reachable from the header and from the empty state, because those are the two
 * moments someone looks for it: in front of a plan they cannot read, and in
 * front of nothing at all.
 */
export function HelpDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    // showModal hands the focus to the first focusable child, and here that is
    // the close button at the very bottom: a dialog this long opens already
    // scrolled past everything it is meant to say. Taking the focus onto the
    // dialog keeps Escape and Tab working, but the scroll the button caused
    // stays behind it, so it has to be undone as well.
    node?.focus();
    if (node) node.scrollTop = 0;
  }, []);

  return (
    <dialog ref={dialog} className="resources help" tabIndex={-1} onCancel={onClose}>
      <h2>Come funziona</h2>
      <p className="resources__hint">
        Di un&apos;attività si dichiarano due cose: quanto lavoro costa e da quando può partire.
        Tutto il resto — durata, data di fine, chi è in ritardo su chi — lo calcola il motore, e non
        si può scrivere a mano.
      </p>

      <section className="help__section">
        <h3>Effort e inizio sono input, la fine è un risultato</h3>
        <p>
          L&apos;<strong>effort</strong> è il lavoro che l&apos;attività costa, in giornate-persona.
          L&apos;<strong>inizio</strong> è il giorno prima del quale non può partire. La{' '}
          <strong>fine</strong> non esiste come dato: dipende da quanta capacità la persona assegnata
          riesce davvero a darle, giorno per giorno.
        </p>
      </section>

      <section className="help__section">
        <h3>Chi ha due attività insieme le fa entrambe a metà</h3>
        <figure className="help__figure">
          <EffortDiagram />
          <figcaption className="help__caption">
            Ada ha <strong>Analisi</strong> (5 giorni di effort, dal lunedì) e{' '}
            <strong>Report</strong> (1 giorno, dal mercoledì). Mercoledì e giovedì sono attive
            entrambe: la sua giornata si divide in due e ognuna avanza al 50%. Analisi torna al 100%
            il venerdì, quando resta da sola.
          </figcaption>
        </figure>
        <p>
          È questo il profilo altalenante dentro le barre: l&apos;altezza del riempimento è la quota
          di giornata che quella persona sta dedicando all&apos;attività in quel momento. Il{' '}
          <strong>lavoro non cambia mai</strong> — cinque giornate restano cinque giornate. Cambia
          solo il tempo di calendario che serve a smaltirle: Analisi ne occupa otto.
        </p>
      </section>

      <section className="help__section">
        <h3>Il tempo che nessuno lavora non conta</h3>
        <p>
          Notti, weekend, festività e chiusure aziendali non stanno sull&apos;asse: una durata non li
          conta mai. Nel diagramma il sabato e la domenica passano senza consumare effort, e Analisi
          finisce il lunedì. Sul grafico le <strong>fasce grigie</strong> sono giorni non lavorativi;
          le <strong>fasce rosse</strong> sono assenze di una persona o chiusure di tutti.
        </p>
      </section>

      <section className="help__section">
        <h3>La disponibilità sostituisce, non moltiplica</h3>
        <p>
          Una persona al 50% dà mezza giornata al progetto. Un periodo di disponibilità{' '}
          <strong>rimpiazza</strong> la percentuale di base invece di moltiplicarla: chi sta al 50%
          con un periodo al 25% lavora al 25%, non al 12,5%. Dove due periodi si sovrappongono vince
          l&apos;ultimo dichiarato, così un&apos;eccezione stretta si ritaglia dentro una larga. Una
          disponibilità a zero è un&apos;assenza — non serve altro concetto.
        </p>
      </section>

      <section className="help__section">
        <h3>Un raggruppamento non viene mai schedulato</h3>
        <p>
          Un&apos;attività con sottoattività non consuma capacità: se lo facesse contenderebbe la
          stessa persona ai propri figli, dimezzandoli. Effort e date le somma dai figli, e il colore
          scelto sul livello alto scende su tutto il ramo. Una dipendenza su un raggruppamento vale
          per le sue foglie.
        </p>
      </section>

      <section className="help__section">
        <h3>Senza persona non si contende</h3>
        <p>
          Un&apos;attività a cui non è assegnato nessuno avanza sempre al 100%: la sua durata è il
          suo effort, e nessun altro può rallentarla.
        </p>
      </section>

      <section className="help__section">
        <h3>Il bordo rosso è la catena critica</h3>
        <p>
          Le attività cerchiate di <strong>rosso</strong> sono quelle da cui dipende la data di
          fine: farle partire più tardi, o dargli un giorno di lavoro in più, la sposta. Nel
          dettaglio della riga il <strong>margine</strong> dice di quanti giorni un&apos;attività
          può slittare prima di spostarla.
        </p>
        <p>
          Non è il percorso critico dei manuali, che guarda solo le dipendenze. Qui una persona
          divisa fra due attività le allunga entrambe, quindi un&apos;attività può essere critica
          senza dipendere da niente, solo perché condivide una risorsa con la catena — e il
          dettaglio dice quale dei due casi è. Una <strong>contesa</strong> si scioglie spostando o
          riassegnando un&apos;altra attività di quella persona; una criticità di sequenza si
          scioglie accorciando la catena.
        </p>
        <p>
          Le due cose convivono: chi è occupato dal primo giorno lascia margine su ogni singola
          attività — spostarne una la fa recuperare da sola — ma un giorno di lavoro in più su
          qualunque di esse sposta la fine. Oltre {CRITICAL_CHAIN_LIMIT} attività il calcolo si
          spegne e lo dice: misurarlo costa un ricalcolo del piano per ogni attività.
        </p>
      </section>

      <div className="resources__actions">
        <span className="resources__spacer" />
        <button type="button" className="resources__primary" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </dialog>
  );
}
