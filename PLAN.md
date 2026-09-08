# Plan

## Goal C — valutazione mobile-friendly                              [aperto]
Agevolare la visualizzazione da smartphone/tablet nascondendo le azioni
superflue; non tutto deve funzionare da mobile.

- [ ] T16 [opus] — Valutazione mobile: audit + proposta
      Scope: audit dell'app a viewport smartphone (375px) e tablet (768px),
      touch emulato; censimento azioni/controlli e proposta di cosa nascondere
      o adattare per una modalità di visualizzazione mobile (non editing
      completo). Output: report con opzioni e raccomandazione — NESSUNA
      implementazione; i task implementativi si scopano dopo, col confronto
      utente.
      Depends: soddisfatta (T13-T15 e T18 chiusi: l'audit gira
      sull'UI finale, collapse della griglia incluso).




## Maintenance — no goal
Task che non servono una milestone: difetti puntuali e salute del codice,
arrivati come richieste singole. **Non ricevono la goal review**, ed e' il
prezzo di stare qui — dichiarato adesso, non scoperto alla fine. Se uno dei
tre cresce fino a meritarne una, si apre un goal e lo si sposta.

- [ ] T40 [self] — L'ultimo descendant override di una primitiva di dialog
      Scope: `src/App.css:455` — `.help .dialog__hint { max-width: none }` a
      (0,2,0) e' la stessa trappola che T39 ha rimosso per i subhead: un futuro
      `.dialog__hint--*` sarebbe inerte dentro `.help`. Preesistente, non
      introdotto da Goal B, e non coperto da nessuna regola dichiarata — la
      frase "mai un descendant selector" in dialog.css e' scoped a
      `.dialog__control`/`.dialog__btn`, quindi `.dialog__hint` non ricadeva
      sotto nessun divieto. Trovato dal critic di T39, fuori dal suo bar.
      Fix atteso, per simmetria con T39: un modificatore al call site invece
      del descendant rule, e la frase in dialog.css estesa a ogni primitiva
      invece che a due.
      Accept: nessun descendant selector il cui soggetto sia una primitiva
      `.dialog__*` sopravvive (il critic di T39 ha enumerato i 955 selettori
      caricati dal CSSOM e ne restano due con un combinatore: questo e
      `.dialog__header + .dialog__body`, che vive dentro dialog.css ed e'
      legittimo); il body di Help non cambia larghezza, misurato.
      Depends: nessuna.

- [x] T36 [self] — Tracciare il piano e il binding in git — `35483e0`

- [ ] T31 [sonnet] — L'ultimo pixel di scroll orizzontale disallinea la corsia
      Scope: al massimo dello scrollbar orizzontale `getScrollState().x`
      sovra-riporta di 1px la traslazione che dhtmlx ha applicato davvero a
      `$task_data` (2245 contro 2244), quindi le bande della corsia cadono 1px
      a sinistra di quelle del chart — in quello stato solo, e in nessun altro
      (misurato dal critic di T30 due volte, a due posizioni del divisore).
      Preesistente: vive nel campo `scrollX` che il brief di T30 aveva
      congelato, e T30 ha ridotto lo scostamento in quello stato da 3px a 1px.
      La trappola è già annotata in docs/dhtmlx.md.
      Accept: bande allineate a differenza 0 anche al massimo scroll, in
      entrambe le direzioni del drag; nessun ritorno del disallineamento
      costante che T30 ha chiuso (misurare anche a scroll 0 e intermedi).
      Depends: soddisfatta (T30 chiuso).

- [ ] T26 [opus] — Valutazione: UX di creazione e cancellazione dei link
      Scope: quando un task ha già una dipendenza, il pallino per crearne una
      nuova e la linea esistente si contendono il puntatore, e diventa
      difficile prendere l'uno o l'altra (secondo screenshot dell'utente). Non
      è un fix a una riga: va capito come si creano, si cancellano e si
      accumulano più dipendenze su uno stesso task senza contesa di hit area.
      Punti di partenza da accertare, non da assumere: `drag_links` è attivo
      (GanttChart.tsx:1072); i link passano da `onBeforeLinkAdd` (1874, dove
      vengono rifiutati) e `onAfterLinkDelete` (1891); `.gantt_line_wrapper` e
      `.gantt_link_arrow` hanno `cursor: pointer` e una hit area di libreria
      che nessuna nostra regola tocca (dimensioni da misurare); l'agent API ha
      già un unlink (930-938). **Come si cancella un link oggi dall'UI va
      accertato per prima cosa**: dhtmlx di default chiede conferma, e in
      questo browser `window.confirm` ritorna `false` subito (CLAUDE.md), il
      che potrebbe rendere la cancellazione impossibile a mano — se è così, è
      un difetto a sé e va riportato subito, prima del resto dell'analisi.
      Accertare anche che cosa sposta la label in alto quando esiste un link:
      nessuna nostra regola CSS lo fa, quindi o è comportamento di libreria o
      è un effetto ottico, e il resto dell'analisi non deve poggiare su
      un'assunzione (lezione T21).
      Output: report con opzioni e raccomandazione — NESSUNA implementazione;
      i task implementativi si scopano dopo, col confronto utente.
      Depends: soddisfatta (T25 ha chiuso la geometria attorno al pallino).
- [ ] T32 [architect] — Riorganizzazione del codice della vista: analisi e piano
      Scope: GanttChart.tsx è a 2115 righe e App.tsx a 933, i due file di
      produzione più grossi del repo. Ogni task di questo goal è passato di lì,
      e il costo si legge nei Log: worker a 200-350k token per diff da poche
      decine di righe, quasi tutto speso a ricostruire il contesto del file.
      Serve un'analisi vera prima di spostare una riga: censire che cosa vive
      dentro il componente oggi (wiring dhtmlx, template, geometria, corsia di
      carico, tooltip, zoom, undo, agent API, drag e scroll), stabilire quali
      pezzi sono estraibili e quali no, e con quale ordine.
      Vincoli da rispettare nell'analisi, non da riscoprire: il confine
      engine/vista non è in discussione; nulla da cui dipende gantt.init() può
      cambiare identità fra un render e l'altro (le callback del parent vanno
      nei ref); una regola non deve mai esistere in due posti (l'agent API è un
      adattatore, non una feature); l'undo passa da un imbuto solo
      (applySolution) e dirty è derivato.
      Output: report con la proposta di taglio in moduli, l'ordine di
      esecuzione e il rischio di ciascun passo — NESSUNA implementazione. I
      task implementativi si scopano dopo, col confronto utente.
      Da portare nel report, non da nascondere: la vista non ha copertura di
      test sul DOM, quindi ogni estrazione si verifica a mano nel browser. Un
      refactor grosso in un colpo solo è il modo peggiore di spenderlo, e il
      report deve dire quanto vale ogni fetta separatamente.
      Il costo di verificare è di T33, non di questo task: qui si ragiona sul
      costo di leggere e di ricostruire il contesto. L'analisi parte da quello
      che T33 avrà deciso e non lo riapre.
      **Un goal e' dovuto qui, e questa riga e' la sua guardia.** Decisione
      utente (2026-09-08): T32 resta manutenzione *come analisi* — un report
      non ha diff, quindi non c'e' nulla che un goal-reviewer possa leggere —
      ma i task implementativi che ne discendono NON nascono in manutenzione.
      Alla consegna del report si apre un goal e il suo enunciato si scrive
      dal report (moduli, ordine, rischio), non prima: un enunciato generico
      non fa da bar. La finestra fra il report e l'apertura del goal e' il
      buco in cui e' caduta la review di B — non lasciarla aperta.
      Depends: sciolta. T18, T20 e T22 sono chiusi; nessun task aperto
      tocca ancora GanttChart.tsx, quindi l'analisi non parte piu' su un
      file che sta per cambiare.

## Analisi in giacenza — non e' un task, e' materiale per decidere

- `.claude/specs/T33-report.md` — costo della verifica nel browser. La leva 3
  e' fatta (T34: porta fissa, `dev:fresh`). Restano le leve 2b (primitive
  dev-only), 2a e 1 (test in browser mode), in quest'ordine: 2b e' il
  *prerequisito* di 1, non un'alternativa. L'utente ha fermato
  l'investimento dopo la leva 3 — tooling per abbassare il costo dei task
  rimasti si ripaga sul goal dopo, non su questo. Da riproporre solo con un
  goal nuovo. **Prima di scopare la leva 1**: provare che la browser mode di
  vitest parta su questa macchina Windows, mai fatto.

## Log
- Cap: 40 righe, una-due per voce, nessun elenco di task chiusi (il commit e'
  il record). Vedi `.claude/orchestrate.md`. La disciplina sulle premesse
  false e sul "quanto basta" e' graduata in CLAUDE.md (*What a verification
  may claim*, *How good is good enough*) e non vive piu' qui.
- Per T31: nella corsia, `$task` e' invariante allo scroll, `$task_data`
  slitta (707->207 dopo 500px) — usarlo raddoppierebbe lo scroll che `scrollX`
  gia' porta. I 2px all'origine sono due bordi (border-left del layout root +
  `gantt_layout_cell_border_right` della cella griglia), non il resizer
  handle, che occupa zero; `config.grid_width` conta il secondo, `$grid.
  offsetWidth` no.
- Per T31: il velo del weekend sulla corsia e' `--band-nonworking-over`, un
  secondo velo con un mestiere diverso (dipinge sopra il contenuto, non
  sotto). In dark coincide con `--band-nonworking` per caso, non per vincolo.
- Per T32: nessun brief di T12-T31 esiste piu' (`.gitignore:27-28` ignora
  `.claude` e `PLAN.md`, nessun commit li ha mai toccati). Il conteggio degli
  accept sui task chiusi e' una stima, non un dato.
- Per T32: la domanda "modularizzare o testare?" appartiene a T33 e non va
  riaperta qui — due analisi che si contendono la stessa domanda si
  contraddicono.
- Dimensionamento, dai costi misurati: impl oltre ~200k = task sovradimensionato
  da splittare (T35 a 215k, T18 a 182k+250k); il critic costa 100-160k a
  passata; un giro di correzione sullo stesso agente via SendMessage costa meno
  di un fresh spawn (che ripaga ~40k di ingresso).
- T37+T38 (batchati, un brief): impl 92k / 75 tool use, critic 102k / 49, zero
  giri di correzione. Batchare due micro-task ha pagato: un solo ingresso da
  ~40k e una sola passata di critic.
- Il critic ha invalidato un criterio di accept scritto dall'hub
  (`scrollWidth <= clientWidth` non vede un placeholder: sarebbe passato sul
  codice rotto). Graduato in docs/verification.md § Rules of thumb.
- 2026-09-08 Goal B chiuso, potato e rilasciato come v1.2 (`48322e8`). Dopo
  T36 il piano e' tracciato: le sue modifiche vanno in commit propri, e una
  potatura e' recuperabile con `git show`.
