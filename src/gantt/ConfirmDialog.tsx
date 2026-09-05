import { setAutofocus } from './autofocus';
import { Dialog } from './Dialog';

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
  return (
    <Dialog
      width={420}
      className="confirm"
      bodyClassName="confirm__body"
      // Escape closes the dialog, and that is a refusal like any other.
      onDismiss={() => onResolve(false)}
      footer={
        <>
          <span className="dialog__spacer" />
          {/* Focus (not the confirm button) so Enter refuses by default —
              every confirmation guards a destructive or irreversible action. */}
          <button
            type="button"
            className="dialog__btn"
            ref={setAutofocus}
            onClick={() => onResolve(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dialog__btn dialog__btn--primary"
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm__message">{message}</p>
    </Dialog>
  );
}
