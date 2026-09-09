# Plan

## Goal da aprire — dal report di T26                        [in attesa utente]

La guardia di T26 e' scattata: il report e' consegnato
(`.claude/specs/T26-report.md`), quindi **un goal e' dovuto** e il suo
enunciato si scrive da quel report, non prima. Posta all'utente al checkpoint
del 2026-09-09; l'enunciato dipende dalla risposta, percio' l'intestazione del
goal non e' ancora scritta.

Sul tavolo, dal report: **O1+O2** (una riga CSS piu' un rifiuto dei tipi
non-FS nel handler esistente) chiudono il difetto riportato *e* la corruzione
del dato che ne discende, e sono la raccomandazione. **O4** (editor delle
dipendenze) e' l'unica risposta all'accumulo di link sugli stessi pixel, ed e'
la scelta che decide se il goal e' stretto o ampio. Adottate come stanno, con
la raccomandazione dell'analisi e riapribili: O2b (nascondere l'handle
sinistro) no, O3b (`ConfirmDialog` al posto del modale vendor) no, O5
(annullare l'alzata di 10 px della label) no.

**Se invece si scegliesse T16**, la guardia di T32 va scritta anche su Goal C
prima di partire: T16 e' il suo unico task e consegna un report, quindi alla
sua chiusura la goal review scatta su un diff che non esiste — il buco in cui
e' caduta la review di B. T32 resta la raccomandazione di fondo (la tassa di
contesto su GanttChart.tsx che ogni goal futuro paga).

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

- [x] T40 [self] — L'ultimo descendant override di una primitiva di dialog — `1d2cb2e`
- [x] T36 [self] — Tracciare il piano e il binding in git — `35483e0`

- [x] T31 [impl] — Il pixel di scroll: premessa falsa, nota nei docs corretta — `d9d2356`

- [x] T26 [architect] — UX dei link: analisi consegnata, tre premesse del
      piano cadute — `.claude/specs/T26-report.md`, trappole nei docs `HEAD`
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
- `.claude/specs/T26-report.md` — UX dei link, tutto misurato nell'app. Regge
  il bar dei task implementativi che ne discendono: **non cancellarlo** finche'
  quei task non sono chiusi (lo sweep degli orfani lo prenderebbe, T26 e'
  `[x]`). Dentro, oltre a O1-O5: la §9 elenca cio' che non e' stato misurato
  (schema chiaro, altri zoom, summary e milestone, undo della *creazione* di un
  link), e va letta prima di dare per coperto un caso.

## Log
- Cap: 40 righe, una-due per voce, nessun elenco di task chiusi (il commit e'
  il record). Vedi `.claude/orchestrate.md`. La disciplina sulle premesse
  false e sul "quanto basta" e' graduata in CLAUDE.md (*What a verification
  may claim*, *How good is good enough*) e non vive piu' qui.
- Un task il cui accept e' una campagna di misura va scopato come task di sola
  misura: T31 chiedeva misura + modifica e ha saturato tre contesti (impl 186k,
  critic 180k e 218k alla ripresa) per un diff di 21 righe.
- Ricognizione `Explore` a monte del brief: paga. Su T26 due agenti sonnet
  (51k l'uno, morti col loro contesto) hanno ucciso tre premesse del piano
  prima di spendere un token di Fable — due righe stantie e l'assunzione su
  `window.confirm`. I fatti trovati vanno nel brief come *Fatti accertati*,
  cosi' la corsia costosa non li ri-paga.
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
- T26: architect (fable-5-1 confermato in header) 191k / 77 tool use, piu' 2×
  Explore da 51k. Al limite dei ~200k anche essendo di sola misura: cinque
  misure nel browser piu' le varianti sono il massimo che sta in un contesto.
  Critic saltato — nessun diff da recensire; i check girati dall'hub, verdi.
