/**
 * A literal `autofocus` attribute, not React's `autoFocus` prop: React never
 * writes that attribute, it only calls `.focus()` once at mount — while the
 * dialog is still closed, since `Dialog` calls `showModal()` later in its own
 * effect, so the call is a no-op. The real HTML attribute is what
 * `showModal()` itself honours, however late it is invoked, and is also what
 * `Dialog`'s own `[autofocus]` check looks for to skip its fallback.
 *
 * Its own module rather than `Dialog.tsx`: a non-component export there costs
 * that file its Fast Refresh.
 */
export function setAutofocus(node: HTMLElement | null) {
  node?.setAttribute('autofocus', '');
}
