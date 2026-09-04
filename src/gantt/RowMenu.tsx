import { useEffect, useRef } from 'react';

/** What a creation from the menu means, resolved against the row it opened on. */
export type RowMenuAction = 'sibling' | 'child' | 'milestone' | 'toggle-disabled';

export interface RowMenuTarget {
  taskId: string;
  /** Named on the menu, so the anchor is stated rather than only pointed at. */
  name: string;
  /** Viewport coordinates of the pointer that opened it. */
  x: number;
  y: number;
  /** A summary already has children; "inside" reads differently on a leaf. */
  isSummary: boolean;
  /**
   * The day the pointer was over, when the menu was opened on the timeline.
   *
   * Absent from the grid, which has no date axis to point at — there the row
   * the menu is about lends its own start instead.
   */
  start?: Date;
  /** The task's own flag, not the effective (inherited) state — decides the label. */
  disabled: boolean;
}

const ITEMS: { action: RowMenuAction; label: string }[] = [
  { action: 'sibling', label: 'Nuova attività sotto' },
  { action: 'child', label: 'Nuova sottoattività' },
  { action: 'milestone', label: 'Nuovo traguardo sotto' },
  { action: 'toggle-disabled', label: 'Disattiva' },
];

/**
 * The one gesture the grid had left.
 *
 * Adding a row could only append — to the top level from the toolbar, or to a
 * branch from the row's `+` — so putting one *where you are looking* meant
 * creating it elsewhere and dragging it back. Right-click is the only pointer
 * gesture the grid had not already spent: a single click opens the inline
 * editor and selects, a double click the same, a drag reorders.
 *
 * A `<dialog>` rather than a plain popup, and deliberately **not** modal: it
 * must not dim the plan behind it or take the top layer, but `keystrokeIsCaptured`
 * already treats an open dialog as "the keys are not aimed at the plan", which
 * is exactly right while a menu is up — Del would otherwise delete the selected
 * row from under it.
 */
export function RowMenu({
  target,
  onPick,
  onDismiss,
}: {
  target: RowMenuTarget;
  onPick(action: RowMenuAction): void;
  onDismiss(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // Measured after it is laid out, not guessed from an item count: the menu
    // opens at the pointer and would otherwise hang off the bottom of a window
    // whenever the pointer is near it.
    const { width, height } = node.getBoundingClientRect();
    const left = Math.min(target.x, window.innerWidth - width - 8);
    const top =
      target.y + height > window.innerHeight ? Math.max(8, target.y - height) : target.y;
    node.style.left = `${Math.max(8, left)}px`;
    node.style.top = `${top}px`;
    node.querySelector('button')?.focus();
  }, [target]);

  // Escape reaches a modal dialog on its own; a non-modal one hears nothing, so
  // the key is claimed here — on the document, since the pointer may already
  // have carried focus out of the menu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };
    // Dismissing is the whole of that gesture: a click outside is aimed at
    // closing the menu and at nothing else, so it must not also open an inline
    // editor on the cell it landed on — dhtmlx needs no more than a click.
    //
    // Both jobs on the *same* event, in capture on the document, which is above
    // the grid dhtmlx delegates from. Closing on `pointerdown` and eating the
    // `click` after it does not work: the two are separate events, React
    // unmounts the menu in between, and the cleanup disarms the listener that
    // was waiting for the second one.
    const onClickOutside = (event: MouseEvent) => {
      if (dialog.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClickOutside, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClickOutside, true);
    };
  }, [onDismiss]);

  const step = (from: HTMLElement, delta: number) => {
    const buttons = [...(dialog.current?.querySelectorAll('button') ?? [])];
    const next = buttons[(buttons.indexOf(from as HTMLButtonElement) + delta + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <dialog ref={dialog} open className="rowmenu" aria-label={`Azioni per ${target.name}`}>
      <p className="rowmenu__anchor">{target.name}</p>
      <ul className="rowmenu__items">
        {ITEMS.map(({ action, label }) => (
          <li key={action}>
            <button
              type="button"
              onClick={() => onPick(action)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  step(event.currentTarget, 1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  step(event.currentTarget, -1);
                }
              }}
            >
              {action === 'toggle-disabled'
                ? target.disabled
                  ? 'Riattiva'
                  : 'Disattiva'
                : action === 'child' && target.isSummary
                  ? 'Nuova attività dentro'
                  : label}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
