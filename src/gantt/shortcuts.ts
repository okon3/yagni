/**
 * Whether a keystroke belongs to what the user is typing in rather than to the
 * app.
 *
 * Two cases, and they are the same two for every shortcut the app claims:
 * a field being edited — where Del deletes a character and Ctrl+Z takes back a
 * word — and a modal holding the focus, where the plan behind it is not what
 * the keys are aimed at.
 *
 * Read off the document rather than the event's target: with dhtmlx's keyboard
 * navigation the focus moves between its own cells, and a shortcut that only
 * works when focus happens to sit in the right place reads as broken.
 */
export function keystrokeIsCaptured(): boolean {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    active?.getAttribute('contenteditable') === 'true'
  ) {
    return true;
  }
  return document.querySelector('dialog[open]') !== null;
}
