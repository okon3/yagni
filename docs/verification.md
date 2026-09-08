# Verifying UI from an agent (embedded browser)

The app is developed and verified inside an embedded browser driven by an agent.
Some APIs behave differently there; some verifications can't be trusted or made
at all.

## The origin is fixed

Always `http://localhost:5173`: `strictPort` makes the dev server refuse to
start rather than slide to 5174, so a server that won't come up means an old
one is still holding the port — never that the app moved. `npm run dev:fresh`
kills that listener and starts a cold one. A measurement taken on a second
port was taken on a second app.

## Two agents, one origin

`localStorage` is per origin, not per agent: a second session on the same dev
server overwrote a measurement's fixtures halfway through, silently and with
no error, so the numbers described a project that was no longer the one under
test. Each agent that can reach the origin takes its own named browser
session — measured on `http://localhost:5173`, a key written under
`--session a` is absent from `--session b` and survives `b` writing over it,
so storage is isolated, not just cookies. The default unnamed session is the
shared one; never verify in it.

## Dialogs

- **`window.confirm` returns `false` instantly and shows nothing** — every
  guarded action becomes a silent no-op. Use `ConfirmDialog` (App owns it, hands
  it out as a promise; nested `<dialog>`s stack correctly).
- **`window.print()` is the exception: it blocks.** Real modal dialog, invisible
  while the pane is hidden; every script hangs until dismissed, which an agent
  can't do (close and reopen the tab). Verify the print path by dispatching
  `beforeprint` on `window` (what `printPlan` listens to); the paper needs a
  person.
- **Reloading with fixtures on screen raises the browser's own "Reload site?"**
  — `App.tsx` arms a `beforeunload` guard while the project is dirty, and
  building fixtures with `window.yagni` makes it dirty, so every reload asks.
  It is a native dialog, not ours: nothing in the page can dismiss it. Under
  chrome-devtools MCP call `handle_dialog`; otherwise build the fixtures once
  and drive the page in place instead of reloading. A reload left unanswered
  blocks every later command on that page; once answered, the reload itself can
  cost two `os error 10060` timeouts before the page is back. Those are the
  wait, not a dead session: retry before concluding the app broke.
- **A dialog the tool cannot see is still on screen** — with the autosaved
  draft's question up, `dialog status` reported no dialog open and
  `find text "Resume" click` reported success while leaving it open. Only
  `snapshot -i`, then `click @eN` on the ref it printed, got out. A text match
  that reports success is not evidence the element was hit; the accessibility
  snapshot is.
- **A `<dialog>`'s `close` event never fires here** — probed on a fresh
  `<dialog>`: `showModal()`, `close('bye')` → `returnValue` set, `open` false,
  but neither `onclose` nor `addEventListener('close')` ran. The tool's
  synthetic Escape likewise produces no native `cancel`. So the `close` half of
  a dialog's wiring (`Dialog`'s `onCancel`/`onClose` → `onDismiss`) can't be
  exercised by driving the UI — dispatch a real `Event('close')` (or `'cancel'`)
  on the dialog node instead.

## Popups closing on outside click

Close-on-`pointerdown` + one-shot `click` eater does **not** work: React
unmounts the popup between the two events and the cleanup disarms the eater, so
the click opens an inline editor. `preventDefault` on pointerdown suppresses
compatibility mouse events for touch/pen only, not mouse. Correct shape: **one
`click` listener in the capture phase**, above dhtmlx's delegation root, that
closes and stops the event in the same breath. `RowMenu` is the case in hand —
and it is a non-modal `<dialog>` on purpose: `keystrokeIsCaptured` reads any
open dialog as "keys not aimed at the plan", which keeps Del off the row the
menu is about.

## Driving React inputs

A React-controlled field can't be filled from the browser tool's own context:
plain assignment is ignored by the value tracker, and the native
`HTMLInputElement.prototype` setter throws *Illegal invocation* from there.
Inject a `<script>` element with the same code — it runs in the page context,
the setter works, the `input` event reaches React. (How the details dialog's
date field is driven in verifications.)

## Synthetic keyboard events

Keys pressed by the browser tool carry **no `keyCode`/`which`/`code`** (all
`0`/empty); `event.key` is right and the event is trusted. Our handlers (reading
`key`) see the keystroke; dhtmlx's (reading `keyCode`) do not — Escape closing
an inline editor works under a real keyboard only and took a person to settle.
Tool key naming ≠ DOM naming: `Return` arrives with an **empty** `key` (does
nothing); `Enter` arrives as `Enter`. A dead key is two questions, not one.

## Emulated colour scheme

Switching the pane's scheme flips `matchMedia('(prefers-color-scheme: dark)')
.matches` and repaints every `@media` rule, but **fires no `change` event** — a
listener on that query is never called (measured: `matches` went true→false with
a probe listener armed, count stayed 0). So the JS half of the dark mode
(`theme.ts` setting `data-gantt-theme`) can only be verified **on load**, with
the scheme already set; a switch on a live page proves nothing about it. Which is
why the chart's dhtmlx variables are keyed on the media query as well as on the
attribute — see [dhtmlx.md](dhtmlx.md).

Setting `data-gantt-theme` by hand instead is not a shortcut to the same state:
dhtmlx polls the theme every 100ms and writes the attribute back, so forcing it
latches `gantt.skin` and removing it later yields `terrace` on a light page —
a value the app never sets. Load with the scheme already set, or measure only
what the attribute selects for. Mechanism in [dhtmlx.md](dhtmlx.md).

## Driving the CLI

Measured over 1179 real `agent-browser` invocations in this project's
transcripts. The failure rate is ~17%, not the 7.7% the tool-result error flag
reports — the gap is the first rule.

- **Never `;` between two `agent-browser` calls — `&&`, or one call per
  command.** With `;` a mid-chain failure still lets the last segment run, and
  a successful last segment marks the whole command a success: ~108 failures
  hid that way, visible only to whoever read the full output. `&&` doesn't
  prevent the failure, it stops it from being silent.
- **`Failed to read: … (os error 10060)` and `Invalid response: EOF … (daemon
  may be busy)` are worth exactly one immediate retry.** The largest failure
  bucket (35 calls, 8 sessions of 11) and mostly not the reload-after-dialog
  pattern above — only 4 of the 35 involve a reload. The daemon recovers on
  its own within seconds more often than not; the session is not dead.
- **`click` always takes an explicit selector.** `agent-browser click` alone is
  the single most repeated error signature in the corpus (`Missing arguments
  for: click`, six sessions, identical) — a reflex from CLIs where `click`
  follows the last match. Use `find … click`, or `snapshot` then `click @refN`.

What no rule fixes: JS errors in a hand-written `eval` (36 calls — a bug in the
script, not the tool), a selector covered by the sticky header, and `open` /
`wait --load networkidle` timing out on a cold server. The last is why the cold
restart happens *before* the measurement, not during it.

## Rules of thumb

- **Verify visuals with `getComputedStyle`** — not the attribute, not the data
  field. More than one bug was invisible from the code.
- **Smart rendering**: off-screen bars have no DOM node. Read the task data, or
  `showTask(id)` first.
- A synthetic `wheel` doesn't reproduce the scroll/zoom capture-phase interplay
  (see [dhtmlx.md](dhtmlx.md)), and a node cached before a zoom is detached by
  the redraw — events dispatched to it reach nothing.
- **Hover tests need two hovers a pixel apart**; hovering the pixel already
  under the pointer fires no event.
- `ResizeObserver` never fires here — code resizing the chart's container must
  call `gantt.setSizes()` itself.
