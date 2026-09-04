import type { Figure } from './planFigure';

/**
 * Puts the printable figure in the document while the browser is printing, and
 * takes it out afterwards.
 *
 * On `beforeprint` rather than behind a button of its own, so that Ctrl+P — the
 * way a person actually prints — goes through exactly the same path as the
 * toolbar's `Print`, which does nothing but call `window.print()`. Building the
 * pages ahead of time instead would mean redrawing them on every edit for a
 * figure nobody may ever ask to see.
 *
 * The container is built by hand rather than rendered: `beforeprint` fires
 * immediately before the browser lays the pages out, and React's own state is
 * under no obligation to have reached the DOM by then.
 *
 * The stylesheet hides the application only when this container is there
 * (`body:has(.plan-print)`), so a browser that never fires the event prints the
 * page as it always did rather than printing nothing at all.
 */
export const PRINT_CONTAINER_CLASS = 'plan-print';

export function installPrintFigure(pagesOf: () => Figure[]): () => void {
  const remove = () => {
    document.querySelectorAll(`.${PRINT_CONTAINER_CLASS}`).forEach((node) => node.remove());
  };

  const build = () => {
    remove();
    const container = document.createElement('div');
    container.className = PRINT_CONTAINER_CLASS;
    for (const page of pagesOf()) {
      const sheet = document.createElement('div');
      sheet.className = `${PRINT_CONTAINER_CLASS}__page`;
      sheet.innerHTML = page.svg;
      container.append(sheet);
    }
    document.body.append(container);
  };

  window.addEventListener('beforeprint', build);
  window.addEventListener('afterprint', remove);
  return () => {
    window.removeEventListener('beforeprint', build);
    window.removeEventListener('afterprint', remove);
    remove();
  };
}
