/**
 * How the view shows the figures the engine computed.
 *
 * Everything here is display only: nothing it returns goes back into the model,
 * and none of it is a second opinion about the schedule.
 */

/**
 * A figure of days as the UI prints it, wherever it prints one.
 *
 * Effort is entered in quarters of a day, so a fraction carries information and
 * must survive — while a trailing zero does not: a summary rolled up to `9.00g`
 * beside a leaf's `5g` reads as two different kinds of number rather than as the
 * same one. Two decimals is the resolution of the input, and rounding there is
 * also what hides the noise a rollup picks up from floating point when it adds a
 * quarter of a day to a half.
 *
 * Unitless on purpose: the grid writes `5g` where a dialog writes `5 g`, and the
 * suffix is the caller's business.
 */
export function formatDays(days: number): string {
  return String(Number(days.toFixed(2)));
}
