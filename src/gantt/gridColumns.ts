import { gantt } from 'dhtmlx-gantt';
import type { GridColumn } from 'dhtmlx-gantt';
import { Info, Ban } from 'lucide-static';
import { formatDays } from './format';
import { escapeHtml } from './html';
import { isShared, renderSegments } from './segmentBar';
import { DEFAULT_BAR_COLOR, avatarColorOf, initialsOf, shade } from './colors';
import { peopleUnder, type Project, type SolvedProject } from './project';
import { MILESTONE_TYPE } from './ganttRows';
import { matchesSearch } from './search';
import type { Resource } from '../scheduler';

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});
const shortDate = (value: Date) => (value ? dayMonth.format(new Date(value)) : '');

/** Columns whose value a summary derives from its children. */
export const DERIVED_ON_SUMMARY = new Set(['nominal_days', 'resource_id', 'start_date']);

/**
 * Faces a summary's resource cell fits, the "+n" counted as one of them.
 *
 * The cell is 64px inside its padding and a face is 22px overlapping by 8, so
 * four is what the column holds — chosen against the width rather than picked,
 * since a fifth is clipped in silence.
 */
const AVATAR_STACK_LIMIT = 4;

/** A person as an avatar names them: part-time is why a row is as long as it is. */
function personLabel(resource: Resource): string {
  const availability = resource.availability ?? 1;
  return availability < 1 ? `${resource.name} - ${Math.round(availability * 100)}%` : resource.name;
}

/**
 * `lucide-static` ships each icon at a fixed 24×24 with no `aria-hidden` —
 * HTML keeps the *first* of a duplicate attribute, so appending a smaller
 * width/height would lose to the original. Rewriting the attributes in place
 * is the documented way around a string, short of pulling in React's
 * server renderer for two icons.
 */
function sizedIcon(svg: string, size: number): string {
  return svg
    .replace(/\swidth="\d+"/, ` width="${size}"`)
    .replace(/\sheight="\d+"/, ` height="${size}"`)
    .replace('<svg', '<svg aria-hidden="true"');
}

const INFO_ICON = sizedIcon(Info, 15);
const BAN_ICON = sizedIcon(Ban, 15);

/**
 * Options for the resource cell.
 *
 * The leading blank lets a task go back to having nobody assigned; without it an
 * assignment could never be undone.
 */
function resourceSelectOptions(resources: Resource[]) {
  return [
    { key: '', label: '—' },
    ...resources.map((resource) => ({ key: resource.id, label: resource.name })),
  ];
}

/**
 * Re-arms the resource cell's editor with the people the project now has.
 *
 * The select captured its options when the columns were configured, so anyone
 * who arrives later — through the dialog, a script, or an undo that brings them
 * back — is missing from the grid's dropdown until this runs.
 */
export function refreshResourceOptions(resources: Resource[]): void {
  const column = gantt.config.columns?.find((entry) => entry.name === 'resource_id');
  if (column?.editor) column.editor.options = resourceSelectOptions(resources);
}

/**
 * The state a cell or row template reads at the moment dhtmlx redraws it.
 *
 * Getters, not values: a template outlives the render that built it, so the
 * read has to happen when the redraw does.
 */
export interface RowContext {
  project(): Project;
  solved(): SolvedProject;
  searchKey(): string;
}

export function buildColumns(ctx: RowContext): GridColumn[] {
  const resourceOptions = () => resourceSelectOptions(ctx.project().resources);
  // An avatar rather than a name: the column shrinks to a third of its width
  // and the full name moves into the tooltip. Partial staffing keeps its
  // number on the face of the grid, because it changes every duration there.
  const resourceAvatar = (id: string | undefined) => {
    const resource = ctx.project().resources.find((entry) => entry.id === id);
    if (!resource) {
      return '<span class="gantt-avatar gantt-avatar--empty" title="No resource">&ndash;</span>';
    }
    const availability = resource.availability ?? 1;
    const percentage = Math.round(availability * 100);
    const title = personLabel(resource);
    return (
      `<span class="gantt-avatar" style="background:${avatarColorOf(resource.name)}"` +
      // Whoever the pointer is on drives the highlight, and App reads it off
      // this attribute — the same one the toolbar's avatars carry.
      ` data-resource-id="${escapeHtml(resource.id)}"` +
      ` title="${escapeHtml(title)}">${escapeHtml(initialsOf(resource.name))}</span>` +
      (availability < 1 ? `<span class="gantt-avatar__pct">${percentage}%</span>` : '')
    );
  };

  /**
   * Everyone working under a summary, as overlapping faces.
   *
   * The row used to say "—", which is true of the summary's own field and
   * useless about the branch: who a group of work belongs to is most of what
   * a collapsed tree is read for.
   *
   * None of these carries `data-resource-id`, so none of them highlights.
   * That is the price of the overlap: a face covered down to a sliver is not
   * something a pointer can claim to have chosen, and the people past the
   * limit have no face at all. A branch staffed by one person still renders
   * as the ordinary avatar and still highlights — there the pointer is
   * unambiguous.
   *
   * Who they all are is a native `title`, as it is on every other avatar in
   * the grid: the app's own tooltip is deliberately detached from the rows and
   * left on the bars, and bringing it back here for one cell would be a second
   * tooltip in the same column as the leaves' titles. It carries the whole
   * list, the people the "+n" stands for included.
   */
  const resourceStack = (taskId: string) => {
    const people = peopleUnder(ctx.solved(), ctx.project().resources, taskId);
    if (people.length === 0) return '<span class="gantt-derived">—</span>';
    if (people.length === 1) return resourceAvatar(people[0].id);
    const title = people.map(personLabel).join('\n');
    // A face and the "+n" that replaces the rest cost the same width, so the
    // stack is n faces or n-1 faces and a count — never both a count and a
    // gap where one more face would have fitted.
    const shown =
      people.length > AVATAR_STACK_LIMIT ? people.slice(0, AVATAR_STACK_LIMIT - 1) : people;
    const hidden = people.length - shown.length;
    const faces = shown.map(
      (person) =>
        `<span class="gantt-avatar" style="background:${avatarColorOf(person.name)}">` +
        `${escapeHtml(initialsOf(person.name))}</span>`,
    );
    if (hidden > 0) {
      faces.push(`<span class="gantt-avatar gantt-avatar--more">+${hidden}</span>`);
    }
    return (
      `<span class="gantt-avatar-stack" title="${escapeHtml(title)}">${faces.join('')}</span>`
    );
  };
  return [
    {
      name: 'text',
      label: 'Task',
      tree: true,
      width: 230,
      resize: true,
      // The colour no longer has a column of its own: it rides along with the
      // name, and the details dialog is where it is picked.
      // The dot turns into a diamond on a milestone, the shape the chart draws
      // it as: the grid says nothing else about effort 0 that a "0g" in the
      // next column does not already say.
      template: (task) =>
        `<span class="gantt-dot${task.type === MILESTONE_TYPE ? ' gantt-dot--milestone' : ''}"` +
        ` style="background:${String(task.bar_color || DEFAULT_BAR_COLOR)}"></span>` +
        `<span class="${task.is_summary ? 'gantt-name gantt-name--summary' : 'gantt-name'}">${escapeHtml(String(task.text ?? ''))}</span>`,
      editor: { type: 'text', map_to: 'text' },
    },
    {
      name: 'resource_id',
      label: 'Resource',
      width: 76,
      align: 'center',
      resize: true,
      // A summary has no resource of its own, so it shows the branch's.
      template: (task) =>
        task.is_summary
          ? resourceStack(String(task.id))
          : resourceAvatar(task.resource_id as string | undefined),
      editor: { type: 'select', map_to: 'resource_id', options: resourceOptions() },
    },
    {
      name: 'nominal_days',
      label: 'Effort',
      width: 62,
      align: 'center',
      resize: true,
      // One format for both branches, or a summary's 9g reads as a different
      // kind of figure from the 5g of the leaf under it.
      template: (task) =>
        task.is_summary
          ? `<span class="gantt-derived">${formatDays(Number(task.rolled_effort_days))}d</span>`
          : `${formatDays(Number(task.nominal_days))}d`,
      editor: { type: 'number', map_to: 'nominal_days', min: 0, max: 999 },
    },
    {
      name: 'start_date',
      label: 'Start',
      width: 84,
      align: 'center',
      resize: true,
      template: (task) =>
        task.is_summary
          ? `<span class="gantt-derived">${shortDate(task.start_date as Date)}</span>`
          : shortDate(task.start_date as Date),
      editor: { type: 'date', map_to: 'start_date' },
    },
    // The two derived columns. Every cell wears the register a summary's
    // rolled-up figures already wear, and neither column carries an editor —
    // a cell without one has nothing for a click to open. The end date is
    // never an input.
    {
      name: 'end_shown',
      label: 'End',
      width: 84,
      align: 'center',
      resize: true,
      template: (task) =>
        `<span class="gantt-derived">${shortDate(task.end_shown as Date)}</span>`,
    },
    {
      name: 'elapsed_days',
      label: 'Duration',
      width: 62,
      align: 'center',
      resize: true,
      template: (task) =>
        `<span class="gantt-derived">${formatDays(Number(task.elapsed_days ?? 0))}d</span>`,
    },
    {
      name: 'info',
      label: '',
      width: 34,
      align: 'center',
      // Progress, colour and the float figure live behind this button: the
      // first two are rarely changed, and the float costs a search per row.
      // The button has no content, so its title is its accessible name — and
      // one shared by every row leaves anyone moving between buttons unable
      // to tell whose detail is about to open. Carried by the template, which
      // dhtmlx re-runs on each render, rather than written onto the node: a
      // class or an attribute set by hand does not survive a redraw.
      template: (task) =>
        `<button type="button" class="gantt-rowinfo" data-task-info="1"` +
        ` title="Details for “${escapeHtml(String(task.text ?? ''))}”">${INFO_ICON}</button>`,
    },
    {
      name: 'toggle',
      label: '',
      width: 34,
      align: 'center',
      // The effective (inherited) flag is what `task.disabled` carries here —
      // wrong for a child of a disabled summary, which must still read as
      // enabled on its own row. The row's own flag lives on the model, not
      // on the dhtmlx task.
      template: (task) => {
        const own =
          ctx.project().tasks.find((candidate) => candidate.id === String(task.id))
            ?.disabled === true;
        const name = escapeHtml(String(task.text ?? ''));
        return (
          `<button type="button" class="gantt-rowtoggle${own ? ' gantt-rowtoggle--off' : ''}"` +
          ` data-task-toggle="1" title="${own ? 'Enable' : 'Disable'} “${name}”">${BAN_ICON}</button>`
        );
      },
    },
    { name: 'add', width: 40 },
  ];
}

// The grid holds `grid_width` and squeezes its resizable columns down to
// `min_column_width` to fit, so two more columns came out of the task name —
// 230px to 152px, and a truncated name is the one cell whose content cannot
// be guessed from what is left of it. The grid is sized to hold the columns
// it declares instead, and the width comes off the timeline, which scrolls
// and re-scales while a name does neither.
export function columnsWidth(columns: GridColumn[]): number {
  return columns.reduce(
    (total, column) => total + (Number(column.width) || 0),
    0,
  );
}

export function installRowTemplates(ctx: RowContext): void {
  /**
   * Whether the row is one the search is pointing at, or holds one below it.
   * A summary carries the fainter mark whether its branch is open or closed —
   * closed is where it earns its keep, since the matching rows are not on
   * screen at all, but tying it to `$open` would make the highlight flicker
   * with the arrow. Same argument as `resource_classes`: the branch says what
   * it contains, always.
   */
  const found = (task: { id?: unknown; text?: unknown }) => {
    const key = ctx.searchKey();
    if (key === '') return '';
    if (matchesSearch(String(task.text ?? ''), key)) return 'gantt-found';
    let below = false;
    gantt.eachTask((child) => {
      below ||= matchesSearch(String(child.text ?? ''), key);
    }, task.id as string);
    return below ? 'gantt-found-below' : '';
  };

  // Every row, bar and link says whose work it is, so that highlighting a
  // person is a stylesheet rule and not a redraw.
  gantt.templates.grid_row_class = (_start, _end, task) =>
    [
      String(task.resource_classes ?? ''),
      found(task),
      task.disabled ? 'gantt-row--disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');
  // A band across the chart rather than a mark on the bar: the outline is the
  // critical chain's and the fill is the user's colour, so a match has to
  // read on the row it is on without touching either.
  gantt.templates.task_row_class = (_start, _end, task) => found(task);
  gantt.templates.task_class = (_start, _end, task) => {
    const classes = [String(task.resource_classes ?? '')];
    if (task.is_summary) classes.push('gantt-bar--summary');
    else if (task.shared) classes.push('gantt-bar--shared');
    // Positioned but weightless — the engine guarantees a disabled task is
    // never also critical or shared, so this never has to compose with them.
    if (task.disabled) classes.push('gantt-bar--disabled');
    // An outline, so it composes with whatever colour the bar carries: the
    // colour belongs to the user, and dhtmlx sets it inline anyway.
    if (task.critical) {
      classes.push('gantt-bar--critical');
      // Dashed where the answer predates the last edit. An outline that looks
      // measured while it is not is worse than none at all.
      if (task.critical_stale) classes.push('gantt-bar--critical-old');
    }
    return classes.filter(Boolean).join(' ');
  };
  // A link keeps both ends' people: what gates someone's work, and what their
  // work gates, is part of reading their plan.
  gantt.templates.link_class = (link) =>
    [
      ...new Set(
        [link.source, link.target]
          .filter((id) => gantt.isTaskExists(id))
          .flatMap((id) => String(gantt.getTask(id).resource_classes ?? '').split(' '))
          .filter(Boolean),
      ),
    ].join(' ');
  // The bar holds the allocation profile and nothing else: the name lives
  // beside it, where a one-day bar can still show it in full.
  gantt.templates.task_text = (_start, _end, task) => {
    const scheduled = ctx.solved().schedule.tasks.get(String(task.id));
    if (!scheduled || !isShared(scheduled)) return '';
    // Which percentage labels fit depends on the zoom level, so ask dhtmlx for
    // the bar's actual pixel width rather than guessing from a percentage.
    const width = Number(gantt.getTaskPosition(task).width) || 0;
    const color = String(task.bar_color || DEFAULT_BAR_COLOR);
    return renderSegments(scheduled, width, color, shade(color));
  };
  gantt.templates.rightside_text = (_start, _end, task) => escapeHtml(String(task.text ?? ''));
}
