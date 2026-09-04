import { useEffect, useRef } from 'react';

/**
 * Confirmation as part of the app rather than `window.confirm`.
 *
 * Embedded browsers suppress native dialogs: the call returns `false` without
 * showing anything, which silently turns every guarded action into a no-op —
 * a deletion that never happens, a file that never opens.
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  onResolve,
}: {
  message: string;
  confirmLabel: string;
  onResolve(confirmed: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="resources confirm"
      // Escape closes the dialog, and that is a refusal like any other.
      onCancel={() => onResolve(false)}
    >
      <p className="confirm__message">{message}</p>
      <div className="resources__actions">
        <span className="resources__spacer" />
        <button type="button" onClick={() => onResolve(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="resources__primary"
          autoFocus
          onClick={() => onResolve(true)}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
