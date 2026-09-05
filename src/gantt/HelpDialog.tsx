import { useEffect, useRef } from 'react';
import { CRITICAL_CHAIN_LIMIT } from './project';

/**
 * The person both tasks in the diagram are assigned to.
 *
 * Invented, and her avatar is drawn rather than derived: `avatarColorOf` answers
 * for somebody in the project, and nobody in the diagram is.
 */
const PERSON = { initials: 'AL', colour: '#5b6ebd' };

/**
 * The fill of a shared bar, kept in step with gantt.css — same default blue, and
 * it reads on either scheme. The bare track around it does not, so that one is
 * `.help__track` and comes from the same variables the chart draws it with.
 */
const FILL = '#3b74d6';
const FILL_LINE = '#2a539a';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S', 'M'];
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
      aria-label="Two tasks assigned to the same person that overlap: on the days they share, each progresses at 50%."
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
        { y: rowA, name: 'Analysis', effort: '5d' },
        { y: rowB, name: 'Report', effort: '1d' },
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

      {/* Analysis: five days of effort, at full rate until Report joins it. */}
      <rect
        x={dayX(0)}
        y={rowA}
        width={COLUMN * 8}
        height={BAR_HEIGHT}
        rx={BAR_HEIGHT / 2}
        className="help__track"
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
        className="help__track"
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
        5 days of effort, 8 calendar days
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
      <h2>How it works</h2>
      <p className="resources__hint">
        A task declares two things: how much work it costs and from when it may start. Everything
        else — duration, end date, who is holding up whom — is computed by the engine, and cannot be
        typed by hand.
      </p>

      <section className="help__section">
        <h3>Effort and start are inputs, the end is a result</h3>
        <p>
          <strong>Effort</strong> is the work the task costs, in person-days. <strong>Start</strong>{' '}
          is the day before which it cannot begin. <strong>End</strong> does not exist as a stored
          value: it depends on how much capacity the assigned person can actually give it, day by
          day.
        </p>
      </section>

      <section className="help__section">
        <h3>Two tasks at once are each done at half rate</h3>
        <figure className="help__figure">
          <EffortDiagram />
          <figcaption className="help__caption">
            Ada has <strong>Analysis</strong> (5 days of effort, from Monday) and{' '}
            <strong>Report</strong> (1 day, from Wednesday). Both are active on Wednesday and
            Thursday: her day splits in two and each progresses at 50%. Analysis returns to 100% on
            Friday, once it is alone again.
          </figcaption>
        </figure>
        <p>
          That is the up-and-down profile inside the bars: the height of the fill is the share of
          the day that person is giving the task at that moment. The{' '}
          <strong>work never changes</strong> — five days stay five days. What changes is only the
          calendar time it takes to get through them: Analysis takes eight.
        </p>
      </section>

      <section className="help__section">
        <h3>Time nobody works does not count</h3>
        <p>
          Nights, weekends, holidays and company shutdowns are not on the axis: a duration never
          counts them. In the diagram Saturday and Sunday pass without consuming effort, and
          Analysis finishes on Monday. On the chart the <strong>grey bands</strong> are non-working
          days; the <strong>red bands</strong> are one person's absence or a shutdown for everyone.
        </p>
      </section>

      <section className="help__section">
        <h3>Availability replaces, it does not multiply</h3>
        <p>
          A person at 50% gives half a day to the project. An availability period{' '}
          <strong>replaces</strong> the base percentage instead of multiplying it: someone at 50%
          with a period at 25% works at 25%, not at 12.5%. Where two periods overlap, the last one
          declared wins, so a narrow exception carves itself out of a wider one. An availability of
          zero is an absence — no other concept is needed.
        </p>
      </section>

      <section className="help__section">
        <h3>A group is never scheduled</h3>
        <p>
          A task with subtasks consumes no capacity: if it did, it would contend for the same
          person against its own children, halving them. Its effort and dates are summed from its
          children, and the colour chosen at the top level flows down the whole branch. A
          dependency on a group applies to its leaves.
        </p>
      </section>

      <section className="help__section">
        <h3>With no person, there is no contention</h3>
        <p>
          A task with nobody assigned always progresses at 100%: its duration equals its effort,
          and nothing else can slow it down.
        </p>
      </section>

      <section className="help__section">
        <h3>The red outline is the critical chain</h3>
        <p>
          Tasks outlined in <strong>red</strong> are the ones the end date depends on: starting them
          later, or giving them one more day of work, moves it. In the row's detail the{' '}
          <strong>float</strong> says how many days a task can slip before it moves the end.
        </p>
        <p>
          This is not the textbook critical path, which only looks at dependencies. Here a person
          split between two tasks stretches both of them, so a task can be critical without
          depending on anything, purely because it shares a resource with the chain — and the
          detail says which of the two cases it is. A <strong>contention</strong> is resolved by
          moving or reassigning another task of that person's; a sequence criticality is resolved
          by shortening the chain.
        </p>
        <p>
          The two coexist: someone booked from day one leaves float on every single task — moving
          one lets it recover on its own — but one more day of work on any of them moves the end.
        </p>
        <p>
          Measuring it costs a re-solve of the plan per task: up to {CRITICAL_CHAIN_LIMIT} tasks the
          marking redoes itself on every edit, past that it is asked for from the status bar. In
          that case, after an edit, the previous measurement stays on screen —{' '}
          <strong>dashed</strong> to say so, and the same button redoes it.
        </p>
      </section>

      <div className="resources__actions">
        <span className="resources__spacer" />
        <button type="button" className="resources__primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
