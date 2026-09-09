# Orchestrate binding — gantt

Project facts for the orchestrate-v2 protocol. The skill defines the process;
this file binds it to this repo.

- **Checks**: `npm test`, `npm run build`, `npm run lint` — the hub runs all
  three after every implementer report.
- **Deep-lane triggers**: any task touching `src/scheduler/` or an invariant
  listed in CLAUDE.md (*Invariants*, *Day-boundary rule*) → `implementer-deep`,
  and the critic stays on its default (opus/xhigh). Everything else: critic
  with `model: "sonnet"`.
- **Verification doctrine**: `docs/verification.md` — user-visible behaviour
  is verified in the running app (embedded browser), never asserted from code.
  Restart the dev server after structural CSS changes or `npm install` before
  trusting any negative verdict (stale HMR, see CLAUDE.md).
- **Serial constraints**: one shared Browser pane — only one worker may drive
  it at a time; tasks stay serial unless truly disjoint AND worktree-isolated.
- **Goal & plan**: `PLAN.md` at the repo root; the goal is its `## Goal`
  section. Goal-review bar = that section plus the Accept lines of the goal's
  tasks.
- **Closure ritual**: on `ship`, propose the release — rename CHANGELOG.md's
  `## Unreleased` heading to `## v<next-minor> — <today>`; the user always
  confirms before the rename.
- **Critic model**: never pass `model` to the critic — the default of its
  definition wins. This overrides the skill's "sonnet for routine tasks"
  table; the cost does not change with the model, and the user asked for the
  deeper one.
- **Plan hygiene, with a number**: at every end-of-task checkpoint **delete
  before adding**. A durable lesson graduates to `CLAUDE.md` or `docs/` first,
  then leaves the plan; a spent one is deleted. Hard caps: `## Log` ≤ 40
  lines, one to two lines per entry, and **no list of finished tasks** — a
  commit sha is the record. A checkpoint that leaves the Log over the cap is
  not finished. "Prune continuously" was ignored for three days; a number is
  the forcing function.
- **Git is the archive for the plan and the binding, and for nothing else
  under `.claude`.** `PLAN.md` and this file are tracked; `.claude/*` is
  ignored by default with a negation for this file, so briefs, specs and the
  `orchestrator.lock` heartbeat stay out of history on purpose (the lock is
  rewritten on every tool call). Pruning the plan is therefore recoverable
  with `git show` — it was not until 2026-09-08, and the Accept lines of
  T12-T15 and T19 were destroyed that way, along with every brief of T12-T31.
  The rule that came out of it stands regardless of recoverability: **never
  prune a done task's Accept lines before that goal's review has run** — they
  are half the goal-review bar. Done tasks collapse to one line *after*
  `ship`, never before.
  Riproposto il 2026-09-09 se tracciare anche `settings.local.json` e
  `.claude/specs/T33-report.md`: risposta **no**, la regola vale come scritta.
  Chiusa, non riproporre. `T33-report.md` resta non tracciato e **non va
  cancellato** dallo sweep degli orfani finche' il piano lo elenca sotto
  *Analisi in giacenza*: e' materiale di decisione, non la spec di un task
  chiuso.
- **"Read-only" restricts Write/Edit, not Bash — and no hook stops a worker
  committing here.** `.claude/hooks/` is empty and `settings.local.json`
  declares no `hooks` key, so `deny-agent-commit` does not fire in this repo.
  On 2026-09-08 the goal-reviewer — briefed "you do not fix, you do not
  commit" — wrote `docs/verification.md` and committed it (`929ebd9`) through
  Bash, and its report said nothing about it. The note was good and was kept;
  the lesson is that agent commits must be *detected*, not assumed impossible.
  **Read `git log` at every checkpoint and compare against the commits you
  made yourself**: a report's CHANGES list is not the diff, and a read-only
  agent is read-only by convention only.
- **The port is the mutex**: `strictPort` on 5173 means two lanes restarting
  the dev server kill each other's listener and each other's fixtures, with
  no error. A completion notification is not proof a lane is done (the same
  agent can notify again) — check before touching the origin or the port.
- **Docs duty**: a commit changing behaviour described in `docs/` updates the
  affected file in the same commit (map in CLAUDE.md); significant features
  add a CHANGELOG bullet under `## Unreleased` in the same commit.
