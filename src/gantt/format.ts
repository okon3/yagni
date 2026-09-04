/**
 * How the view shows the figures the engine computed.
 *
 * Everything here is display only: nothing it returns goes back into the model,
 * and none of it is a second opinion about the schedule.
 */

import type { ScheduledTask } from '../scheduler';

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

/**
 * The end to show for a task, which on a task of no length is not the end the
 * engine reports.
 *
 * A working-minute value landing on a day boundary denotes two wall-clock
 * instants, and an end deliberately takes the earlier one — 17:00 of the day the
 * work finished rather than 08:00 of the next — or every whole-day task would
 * look a day too long. A task that consumes no time at all starts and ends on
 * that same boundary, so the convention hands its end back as the *previous*
 * working day and a milestone reads "Inizio 28/09, Fine 25/09": one instant
 * printed as two dates that look the wrong way round.
 */
export function endToShow(scheduled: ScheduledTask): Date {
  return scheduled.endWorkingMinutes === scheduled.startWorkingMinutes
    ? scheduled.start
    : scheduled.end;
}
