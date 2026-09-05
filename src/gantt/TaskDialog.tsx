import { useState } from 'react';
import type { Resource } from '../scheduler';
import { setAutofocus } from './autofocus';
import { Dialog } from './Dialog';
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
  /** The task's own flag — not the effective (inherited) state a group shows. */
  disabled: boolean;
}

export interface TaskPatch {
  name: string;
  nominalDays: number;
  start: Date;
  resourceId: string | undefined;
  color: string | undefined;
  progress: number;
  /**
   * Optional: absent means the caller left it alone. `false` deletes the
   * stored flag rather than writing it — see `GanttChart.updateTask`.
   */
  disabled?: boolean;
}

const dayFormat = new Intl.DateTimeFormat('en-GB', {
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
  const [name, setName] = useState(task.name);
  // Kept as text so a half-typed number survives a re-render.
  const [effort, setEffort] = useState(String(task.nominalDays));
  const [start, setStart] = useState(toDayInput(task.start));
  const [resourceId, setResourceId] = useState(task.resourceId);
  const [color, setColor] = useState(task.color);
  const [progress, setProgress] = useState(String(Math.round(task.progress * 100)));
  const [disabled, setDisabled] = useState(task.disabled);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    const days = Number(effort);
    if (!Number.isFinite(days) || days < 0) {
      setError('Effort must be a non-negative number of days');
      return;
    }
    const percentage = Number(progress);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      setError('Progress must be between 0 and 100');
      return;
    }
    const [year, month, day] = start.split('-').map(Number);
    if (!year || !month || !day) {
      setError('Invalid start date');
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
      disabled,
    });
  };

  // Read off the field being edited rather than off the task, so the dialog
  // changes register while the zero is typed: that is the whole of what makes
  // "effort 0" and "milestone" one concept rather than two. An empty field is not
  // a zero — `Number('')` is — and would otherwise announce a milestone the user
  // is in the middle of not typing.
  const isMilestone = !task.isSummary && effort.trim() !== '' && Number(effort) === 0;

  const fromChildren = <span className="taskinfo__derived">from subtasks</span>;
  const contendedWith = resources.find(
    (resource) => resource.id === slack?.contendedResourceId,
  )?.name;
  /** Contention explains the criticality, so it is that note's to say. */
  const namesContention = Boolean(slack?.isCritical && contendedWith);
  /** Reads on from either opening, so it starts lower case. */
  const whatCostsWhat = slack?.floatDays
    ? `can start up to ${formatDays(slack.floatDays)} d later, but one more day of work moves the project end`
    : 'any delay here moves the project end';

  return (
    <Dialog
      title={task.isSummary ? 'Summary task' : isMilestone ? 'Milestone' : 'Task detail'}
      width={560}
      className="taskinfo"
      onDismiss={onCancel}
      error={error}
      footer={
        <>
          <button type="button" className="dialog__btn dialog__btn--danger" onClick={onDelete}>
            Delete
          </button>
          <span className="dialog__spacer" />
          <button type="button" className="dialog__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dialog__btn dialog__btn--primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="dialog__hint">
        {isMilestone ? (
          <>
            Effort <strong>0</strong>: a milestone, that is a date the plan reaches rather than
            work it consumes. It occupies nobody and is a diamond on the chart. Setting an effort
            above zero turns it back into a task.
          </>
        ) : (
          <>
            The <strong>end</strong> and the <strong>duration</strong> are not set directly: the
            engine computes them from effort, start, calendar and the share of the resource the
            task receives.
          </>
        )}
      </p>

      <div className="taskinfo__grid">
        <label className="taskinfo__field taskinfo__field--wide">
          <span>Name</span>
          <input
            className="dialog__control"
            value={name}
            onChange={(event) => setName(event.target.value)}
            ref={setAutofocus}
          />
        </label>

        <label className="taskinfo__field">
          <span>Resource</span>
          {task.isSummary ? (
            fromChildren
          ) : (
            <select
              className="dialog__control"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
            >
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
                  className="dialog__control taskinfo__amount"
                  type="number"
                  min={0}
                  max={999}
                  step={0.25}
                  value={effort}
                  onChange={(event) => setEffort(event.target.value)}
                />
                <span className="dialog__unit">days</span>
              </span>
              {/* The only way to make a milestone, so the field has to say so:
                  there is no second control, because there is no second concept. */}
              {!isMilestone && <span className="taskinfo__hint">0 = milestone</span>}
            </>
          )}
        </label>

        <label className="taskinfo__field">
          <span>Start</span>
          {task.isSummary ? (
            fromChildren
          ) : (
            <input
              className="dialog__control"
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          )}
        </label>

        <label className="taskinfo__field">
          <span>Progress</span>
          <span className="taskinfo__inline">
            <input
              className="dialog__control taskinfo__amount"
              type="number"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(event) => setProgress(event.target.value)}
            />
            <span className="dialog__unit">%</span>
          </span>
        </label>

        <div className="taskinfo__field taskinfo__field--wide">
          <span>Colour</span>
          {task.ownsColor ? (
            <div className="taskinfo__colors">
              <input
                type="color"
                className="taskinfo__picker"
                value={color}
                aria-label="Bar colour"
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
            <span className="taskinfo__derived">inherited from the parent task</span>
          )}
        </div>

        <label className="taskinfo__field taskinfo__field--wide">
          <span>Status</span>
          <span className="taskinfo__checkbox">
            <input
              type="checkbox"
              checked={disabled}
              onChange={(event) => setDisabled(event.target.checked)}
            />
            Disabled
          </span>
          <span className="taskinfo__hint">
            Stays on the plan but does not weigh: no capacity, out of roll-up and critical chain.
          </span>
        </label>
      </div>

      <h3 className="taskinfo__subhead">Computed</h3>
      <dl className="taskinfo__readonly">
        <div>
          <dt>End</dt>
          <dd>{dayFormat.format(task.end)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className={task.shared ? 'gantt-stretched' : undefined}>
            {formatDays(task.elapsedDays)} d
          </dd>
        </div>
        <div>
          <dt>Total effort</dt>
          <dd>{formatDays(task.effortDays)} d</dd>
        </div>
        <div>
          {/* The figure, whatever else is true of the task: criticality is a
              different fact and it is stated below, in words. */}
          <dt>Float</dt>
          <dd className={slack?.isCritical ? 'taskinfo__critical' : undefined}>
            {slack === null ? (
              <span className="taskinfo__derived">&mdash;</span>
            ) : (
              `${formatDays(slack.floatDays)} d`
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
              The resource is split with other tasks in progress, so the duration exceeds the
              effort.
            </p>
          )
        : task.shared && (
            <p className="taskinfo__note">
              The resource does not work full time in this period, so the duration exceeds the
              effort.
            </p>
          )}
      {slack === null ? (
        <p className="taskinfo__note">
          Past {CRITICAL_CHAIN_LIMIT} tasks the float is not measured: it costs a re-solve of the
          plan for every day probed. Ask for the critical chain from the status bar.
        </p>
      ) : slack.isCritical ? (
        <p className="taskinfo__note">
          <strong>Critical{namesContention ? ` — contended on ${contendedWith}` : ''}.</strong>{' '}
          {namesContention
            ? `Its share is split with other tasks in progress: ${whatCostsWhat}.`
            : `${whatCostsWhat[0].toUpperCase()}${whatCostsWhat.slice(1)}.`}
        </p>
      ) : (
        <p className="taskinfo__note">
          Can slip up to {formatDays(slack.floatDays)} d without moving the project end.
        </p>
      )}
    </Dialog>
  );
}
