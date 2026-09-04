import { useEffect, useRef, useState } from 'react';
import type { Resource } from '../scheduler';
import { formatDays } from './format';
import { CRITICAL_CHAIN_LIMIT, type MeasuredSlack } from './project';

/** Everything the dialog shows, resolved by the chart: inputs and derived alike. */
export interface TaskDetails {
  id: string;
  name: string;
  nominalDays: number;
  start: Date;
  end: Date;
  resourceId: string;
  color: string;
  /** Only a top-level task owns its colour; a subtask inherits it. */
  ownsColor: boolean;
  progress: number;
  isSummary: boolean;
  /** How many tasks sit under this one; they go with it when it is deleted. */
  descendantCount: number;
  /** Working days the task actually spans, stretching included. */
  elapsedDays: number;
  /** Effort rolled up from the leaves; equals `nominalDays` on a leaf. */
  effortDays: number;
  /** Ran below full rate, for whatever reason: the duration then exceeds the effort. */
  shared: boolean;
  /** Ran below full rate *because* the resource was split with another task. */
  contended: boolean;
}

export interface TaskPatch {
  name: string;
  nominalDays: number;
  start: Date;
  resourceId: string | undefined;
  color: string | undefined;
  progress: number;
}

const dayFormat = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const pad = (value: number) => String(value).padStart(2, '0');
const toDayInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Mounted only while open, so the draft initialises from props without an effect. */
export function TaskDialog({
  task,
  slack,
  resources,
  colors,
  onCancel,
  onSave,
  onDelete,
}: {
  task: TaskDetails;
  /** Null when the plan is past the size the app will measure. */
  slack: MeasuredSlack | null;
  resources: Resource[];
  colors: { key: string; label: string }[];
  onCancel(): void;
  onSave(patch: TaskPatch): void;
  onDelete(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(task.name);
  // Kept as text so a half-typed number survives a re-render.
  const [effort, setEffort] = useState(String(task.nominalDays));
  const [start, setStart] = useState(toDayInput(task.start));
  const [resourceId, setResourceId] = useState(task.resourceId);
  const [color, setColor] = useState(task.color);
  const [progress, setProgress] = useState(String(Math.round(task.progress * 100)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Il nome non può essere vuoto');
      return;
    }
    const days = Number(effort);
    if (!Number.isFinite(days) || days < 0) {
      setError("L'effort deve essere un numero di giorni non negativo");
      return;
    }
    const percentage = Number(progress);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setError('L’avanzamento va da 0 a 100');
      return;
    }
    const [year, month, day] = start.split('-').map(Number);
    if (!year || !month || !day) {
      setError('Data di inizio non valida');
      return;
    }
    // Keeps the time of day the engine assigned: only the calendar day is edited
    // here, and a start at midnight would sit outside the working window.
    const startDate = new Date(year, month - 1, day, task.start.getHours(), task.start.getMinutes());
    onSave({
      name: trimmed,
      nominalDays: days,
      start: startDate,
      resourceId: resourceId || undefined,
      color: task.ownsColor ? color || undefined : undefined,
      progress: percentage / 100,
    });
  };

  // Read off the field being edited rather than off the task, so the dialog
  // changes register while the zero is typed: that is the whole of what makes
  // "effort 0" and "milestone" one concept rather than two. An empty field is not
  // a zero — `Number('')` is — and would otherwise announce a milestone the user
  // is in the middle of not typing.
  const isMilestone = !task.isSummary && effort.trim() !== '' && Number(effort) === 0;

  const fromChildren = <span className="taskinfo__derived">dalle sottoattività</span>;
  const contendedWith = resources.find(
    (resource) => resource.id === slack?.contendedResourceId,
  )?.name;
  /** Contention explains the criticality, so it is that note's to say. */
  const namesContention = Boolean(slack?.isCritical && contendedWith);
  /** Reads on from either opening, so it starts lower case. */
  const whatCostsWhat = slack?.floatDays
    ? `può iniziare fino a ${formatDays(slack.floatDays)} g più tardi, ma un giorno di lavoro in più sposta la fine del progetto`
    : 'ogni ritardo qui sposta la fine del progetto';

  return (
    <dialog ref={dialog} className="resources taskinfo" onCancel={onCancel} onClose={onCancel}>
      <h2>
        {task.isSummary ? 'Attività di riepilogo' : isMilestone ? 'Milestone' : 'Dettaglio attività'}
      </h2>
      <p className="resources__hint">
        {isMilestone ? (
          <>
            Effort <strong>0</strong>: una milestone, cioè una data che il piano raggiunge e non
            lavoro che consuma. Non occupa nessuno e sul diagramma è un rombo. Rimettere un effort
            maggiore di zero la fa tornare un&apos;attività.
          </>
        ) : (
          <>
            La <strong>fine</strong> e la <strong>durata</strong> non si impostano: le calcola il
            motore da effort, inizio, calendario e dalla quota di risorsa che l&apos;attività riceve.
          </>
        )}
      </p>

      <div className="taskinfo__grid">
        <label className="taskinfo__field taskinfo__field--wide">
          <span>Nome</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>

        <label className="taskinfo__field">
          <span>Risorsa</span>
          {task.isSummary ? (
            fromChildren
          ) : (
            <select value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
              <option value="">&mdash;</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="taskinfo__field">
          <span>Effort</span>
          {task.isSummary ? (
            fromChildren
          ) : (
            <>
              <span className="taskinfo__inline">
                <input
                  type="number"
                  min={0}
                  max={999}
                  step={0.25}
                  value={effort}
                  onChange={(event) => setEffort(event.target.value)}
                />
                <span className="resources__unit">giorni</span>
              </span>
              {/* The only way to make a milestone, so the field has to say so:
                  there is no second control, because there is no second concept. */}
              {!isMilestone && <span className="taskinfo__hint">0 = milestone</span>}
            </>
          )}
        </label>

        <label className="taskinfo__field">
          <span>Inizio</span>
          {task.isSummary ? (
            fromChildren
          ) : (
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          )}
        </label>

        <label className="taskinfo__field">
          <span>Avanzamento</span>
          <span className="taskinfo__inline">
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(event) => setProgress(event.target.value)}
            />
            <span className="resources__unit">%</span>
          </span>
        </label>

        <div className="taskinfo__field taskinfo__field--wide">
          <span>Colore</span>
          {task.ownsColor ? (
            <div className="taskinfo__colors">
              <input
                type="color"
                className="taskinfo__picker"
                value={color}
                aria-label="Colore della barra"
                onChange={(event) => setColor(event.target.value)}
              />
              {colors.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`taskinfo__swatch${
                    option.key.toLowerCase() === color.toLowerCase()
                      ? ' taskinfo__swatch--on'
                      : ''
                  }`}
                  style={{ background: option.key }}
                  title={option.label}
                  onClick={() => setColor(option.key)}
                />
              ))}
              {/* The bar is the only place the colour is ever seen, so the
                  preview is shaped like one. */}
              <span className="taskinfo__preview" style={{ background: color }} />
            </div>
          ) : (
            <span className="taskinfo__derived">ereditato dall&apos;attività principale</span>
          )}
        </div>
      </div>

      <h3 className="taskinfo__subhead">Calcolato</h3>
      <dl className="taskinfo__readonly">
        <div>
          <dt>Fine</dt>
          <dd>{dayFormat.format(task.end)}</dd>
        </div>
        <div>
          <dt>Durata</dt>
          <dd className={task.shared ? 'gantt-stretched' : undefined}>
            {formatDays(task.elapsedDays)} g
          </dd>
        </div>
        <div>
          <dt>Effort totale</dt>
          <dd>{formatDays(task.effortDays)} g</dd>
        </div>
        <div>
          {/* The figure, whatever else is true of the task: criticality is a
              different fact and it is stated below, in words. */}
          <dt>Margine</dt>
          <dd className={slack?.isCritical ? 'taskinfo__critical' : undefined}>
            {slack === null ? (
              <span className="taskinfo__derived">&mdash;</span>
            ) : (
              `${formatDays(slack.floatDays)} g`
            )}
          </dd>
        </div>
      </dl>
      {/* Contention is said once. Where the criticality note below already names
          the person it is contended with, this would be the second sentence
          about the same fact. */}
      {task.contended
        ? !namesContention && (
            <p className="taskinfo__note">
              La risorsa è divisa con altre attività in corso, quindi la durata supera
              l&apos;effort.
            </p>
          )
        : task.shared && (
            <p className="taskinfo__note">
              La risorsa non lavora a tempo pieno in questo periodo, quindi la durata supera
              l&apos;effort.
            </p>
          )}
      {slack === null ? (
        <p className="taskinfo__note">
          Oltre {CRITICAL_CHAIN_LIMIT} attività il margine non viene misurato: costa un ricalcolo
          del piano per ogni giorno provato. La catena critica si chiede dalla barra di stato.
        </p>
      ) : slack.isCritical ? (
        <p className="taskinfo__note">
          <strong>Critica{namesContention ? ` — contesa su ${contendedWith}` : ''}.</strong>{' '}
          {namesContention
            ? `La sua quota è divisa con altre attività in corso: ${whatCostsWhat}.`
            : `${whatCostsWhat[0].toUpperCase()}${whatCostsWhat.slice(1)}.`}
        </p>
      ) : (
        <p className="taskinfo__note">
          Può slittare fino a {formatDays(slack.floatDays)} g senza spostare la fine del progetto.
        </p>
      )}

      {error && (
        <p className="resources__error" role="alert">
          {error}
        </p>
      )}

      <div className="resources__actions">
        <button type="button" className="taskinfo__delete" onClick={onDelete}>
          Elimina
        </button>
        <span className="resources__spacer" />
        <button type="button" onClick={onCancel}>
          Annulla
        </button>
        <button type="button" className="resources__primary" onClick={save}>
          Salva
        </button>
      </div>
    </dialog>
  );
}
