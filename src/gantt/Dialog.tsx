import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * The `<dialog>` chrome shared by every modal in the app: `showModal`, the
 * focus/scroll fallback, and the header/body/footer skeleton. Content and
 * buttons stay per-dialog — fields, tables, hints and their handlers are the
 * caller's, this component never sees them.
 *
 * Mounted only while open, like every dialog here: a per-dialog draft is
 * initialised from props on mount, so this never takes (or needs) an `open`
 * prop of its own — an always-mounted `Dialog` that only toggled `open` would
 * break that.
 */
export function Dialog({
  title,
  width,
  className,
  bodyClassName,
  onDismiss,
  error,
  footer,
  children,
}: {
  /** Omitted for a title-less dialog (e.g. `ConfirmDialog`) — no header renders. */
  title?: string;
  /** Sets `--dialog-width`; the dialog never grows past it. */
  width: number;
  /** Appended to the base `dialog` class for the per-dialog content block. */
  className?: string;
  /** Appended to `.dialog__body`. The sanctioned per-dialog body override: an
   *  explicit class ties specificity at (0,1,0) with the primitive and wins by
   *  App.css source order, where a descendant selector would outrank it and
   *  start the specificity war `docs/view.md` § Dialogs documents. */
  bodyClassName?: string;
  /** Wired to both the native `cancel` and `close` events — Esc and any
   *  programmatic `.close()` funnel through the same path as a footer button. */
  onDismiss(): void;
  error?: string | null;
  /** The buttons; rendered inside `.dialog__footer`. */
  footer: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // A real Escape fires `cancel`, then the browser's default `close` right
  // after — both wired to `onDismiss` so a footer button and Esc share one
  // path. Harmless for a callback like ConfirmDialog's `answer` (idempotent),
  // but not for one that writes on close (T12.2's changelog `seenVersion`).
  const dismissed = useRef(false);
  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    onDismiss();
  };

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    // showModal() hands focus to a descendant carrying a literal `autofocus`
    // attribute, or else the first focusable child — here the footer button —
    // scrolling the body straight past everything above it. React's `autoFocus`
    // prop cannot be what supplies that attribute: it only calls `.focus()` at
    // mount time, while the dialog is still closed (`showModal` runs later,
    // here), which is a no-op. A dialog that wants its own focus target sets a
    // literal `autofocus` attribute (see ConfirmDialog's Cancel button).
    if (node && !node.querySelector('[autofocus]')) {
      node.focus();
      if (body.current) body.current.scrollTop = 0;
    }
  }, []);

  return (
    <dialog
      ref={dialog}
      className={className ? `dialog ${className}` : 'dialog'}
      style={{ '--dialog-width': `${width}px` } as CSSProperties}
      tabIndex={-1}
      aria-labelledby={title ? titleId : undefined}
      onCancel={dismiss}
      onClose={dismiss}
    >
      {title && (
        <div className="dialog__header">
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
        </div>
      )}
      <div className={bodyClassName ? `dialog__body ${bodyClassName}` : 'dialog__body'} ref={body}>
        {children}
      </div>
      {error && (
        <p className="dialog__error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog__footer">{footer}</div>
    </dialog>
  );
}
