# Plan

## Cosa resta sul tavolo

**Goal E e' aperto**: le cinque fette del refactor della vista, comprate
dall'utente il 2026-09-10 sul report di T32. Restano fuori **S5b** (unifica la
mappa riga: l'unica fetta che cambia forma, in giacenza finche' un goal non
aggiunge campi di riga) e **S6/S7** (`App.tsx` e i gesti: raccomandati contro).
Aperti oltre a Goal E: **T16** che porterebbe Goal C alla sua review, **O4** in
giacenza.

**Se si scegliesse T16, la guardia di T32 va scritta anche su Goal C prima di
partire**: T16 e' il suo unico task e consegna un report, quindi alla sua
chiusura la goal review scatterebbe su un diff che non esiste — il buco in cui
e' caduta la review di B.

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

## Goal E — la vista si legge senza leggerla tutta                     [aperto]
`GanttChart.tsx` sotto le 1300 righe in cinque commit di **puro spostamento**:
nessun cambio di comportamento misurabile, la cucitura che T33 §5b chiedeva
esposta come export normali. Il difetto che chiude e' il costo di contesto —
ogni task di Goal D ha speso 100-350k token per diff di decine di righe, quasi
tutti a ricostruire il contesto di un file da 2228 righe.

Bar della goal review (oltre agli Accept dei task): il diff e' spostamenti +
import, `git diff --stat` non mostra righe di logica nuova a parte le firme dei
moduli, e le checklist di T46 e T48 risultano eseguite nel browser.

Spec di tutti e cinque: `.claude/specs/T32-report.md` (§4 la tabella delle
fette, §6 le decisioni tecniche vincolanti). Ordine obbligato: T47 precede T48
(`MILESTONE_TYPE`/`BAR_TYPE` servono a entrambi — invertirli crea un import
circolare).

Bar di verifica, deciso dall'utente il 2026-09-10: **smoke** per gli
spostamenti puri (T44 nemmeno quello: `tsc` e' la prova), **checklist piena**
per T46 e T48, dove il rischio e' geometria in pixel e closure→getter su codice
che dhtmlx richiama a ogni redraw. Verifica proporzionata al rischio, non
uniforme.

- [x] T44 [impl] — S1: `ganttHandle.ts`, i tipi del contratto — `90855c0`
      Accept tenuti: build/test/lint verdi, zero righe di runtime nel diff (le
      sole aggiunte in `src/` sono import), chart 2228 → **2132**. Il critic ha
      provato il verbatim per md5, non a lettura: blocchi identici byte a byte.
      Nessun re-export ponte, nessun ciclo, `agentApi` non importa piu' da un
      componente.

- [ ] T45 [impl] — S2: `zoomLevels.ts` + `timelineGeometry.ts`
      Sposta 97 righe (`:118-214`) + 152 (`:415-566`) + 2 (`:1716-1717`). Export
      `widestLabelWidth`, `appliedScrollX` — la cucitura di T33 §5b, senza
      scrivere la probe. `registerQuarterUnit()` deve restare chiamato dove e'
      ora nella sequenza di init (prima di `zoom.init`).
      Accept, smoke: cinque livelli con ctrl+wheel **e** con i bottoni; Fit su
      piano lungo; un task oltre il range non svuota il chart; zoom out→in
      ripinna uguale (ratchet, `docs/view.md`); nome lungo oltre l'ultima barra
      non tagliato. Nessuna fixture in repo: si costruisce via `yagni`.

- [ ] T46 [impl] — S3: `timelineOverlays.ts`
      Sposta 23+157+22+18 righe (`:1517-1697`, `:598-619`, `:51-68`).
      `mountOverlays` **restituisce il proprio detach** e il cleanup lo chiama:
      StrictMode monta due volte. `paintLoad` resta nel chart e importa
      `nonWorkingSpans`.
      Accept, checklist piena: bande weekend a Days/Weeks/Months (a Months
      spariscono, soglia 10px); shutdown su tutte le righe; assenza solo sulla
      riga della persona, non su summary ne' ramo chiuso; hatch sopra la barra;
      **differenza 0 px fra bande chart e corsia a scroll 0, intermedio e max**
      (la misura di T31); linea di oggi a ogni zoom e nascosta fuori range;
      nessun nodo doppio in `$task_data` dopo un remount.

- [ ] T47 [impl] — S5a: `ganttRows.ts`, spostamento puro
      Sposta ~150 righe (`:48-49`, `:311-388`, `:621-659`). Prerequisito di T48.
      Rende lo schema riga leggibile in un file invece che sparso in cinque
      punti su 1700 righe (`docs/view.md` §Grid). **Non** unifica la mappa:
      quella e' S5b, fuori goal.
      Accept, smoke: apri un piano → righe identiche (colori, summary scuro,
      condivise pallide, milestone a rombo, Duration/End); un edit →
      `applySolution` aggiorna.

- [ ] T48 [deep] — S4: `gridColumns.ts`
      Sposta 65+127+73+~45 righe (`:1158-1450`, `:70-116`, `:396-413`).
      `DERIVED_ON_SUMMARY` va nel modulo, accanto agli editor che descrive; il
      guard `onBeforeEditStart` resta nel chart e lo importa. Chi legge stato
      React lo riceve come **getter** (schema `AgentHost`, `agentApi.ts:150`),
      mai come valore. Lane deep e non impl: e' la fetta piu' grande, l'unica
      dove il codice spostato viene richiamato da dhtmlx a ogni redraw, e un
      giro di correzione qui costa piu' della differenza di modello.
      Accept, checklist piena: le 8 colonne (nome con pallino/rombo, avatar,
      stack `+n` con `title`, effort/start in corsivo sul summary, End/Duration
      senza editor, info, toggle, `+`); editor (click apre, Tab/Shift+Tab/
      Enter/Esc, summary rifiuta effort/start/resource); dropdown risorse
      aggiornato dopo una persona aggiunta dal dialog **e** da
      `yagni.addResource` (la colonna si trova per `name === 'resource_id'`);
      marcature ricerca (`gantt-found`, `-below` su ramo chiuso); highlight
      persona su righe/barre/link; anello critico e tratteggio stale; disabled
      attenuato; segmenti della barra condivisa; `grid_width` = somma colonne
      (nome a 230px).

## Goal D — creare una dipendenza senza mirare a 10x10 px            [chiuso]
Rendere afferrabile l'handle del link e togliere l'ambiguita' semantica del
gesto. Goal review del 2026-09-10: **ship** (fable-5-1 confermato in header),
MISSING e SMUGGLED vuoti. Misurato dalla review nell'app: 24/24 px dell'handle
destro appartengono al pallino su ogni foglia, sul summary e sul task gia'
linkato, 17/17 sulla milestone, a Days/Weeks/Months e in entrambi gli schemi —
cioe' tutti i casi che la §9 di T26 non aveva misurato. I gesti SS/FF/SF
rifiutano senza toccare nessuno start; l'undo di un link creato col mouse
funziona. Nessuna release: i tre task sono fix, e il changelog non prende fix.

- [x] T41 [impl] — L'handle del link sotto la label, e il gesto che mente — `d970ca0`
- [x] T42 [impl] — Il banner di rifiuto che non se ne va — `9630ea5`
- [x] T43 [impl] — Il banner che sposta la riga sotto il mouse — `fbd4507`,
      docs `210a1bf`, commento z-index `1bf79cc`

Cio' che il goal ha deciso e che non va riproposto: l'overlay del banner copre
per intero la testata della griglia finche' resta a schermo, ed e' persistente
sul solo errore di apertura file — misurato e **accettato dall'utente** sotto
la regola dell'80%. Restano fuori scope per decisione sua: l'editor delle
dipendenze (O4, in giacenza), l'handle sinistro visibile (O2b), il modale
vendor (O3b), l'alzata della label (O5). Adiacente, sotto il bar, da registrare
solo se un utente lo segnala: un drag che parte dal *testo* della label (3 px
oltre il pallino) muove ancora la barra — default vendor.

## Maintenance — no goal
Task che non servono una milestone: difetti puntuali e salute del codice,
arrivati come richieste singole. **Non ricevono la goal review**, ed e' il
prezzo di stare qui — dichiarato adesso, non scoperto alla fine. Se uno dei
tre cresce fino a meritarne una, si apre un goal e lo si sposta.

- [x] T40 [self] — L'ultimo descendant override di una primitiva di dialog — `1d2cb2e`
- [x] T36 [self] — Tracciare il piano e il binding in git — `35483e0`

- [x] T31 [impl] — Il pixel di scroll: premessa falsa, nota nei docs corretta — `d9d2356`

- [x] T26 [architect] — UX dei link: analisi consegnata, tre premesse del
      piano cadute — `.claude/specs/T26-report.md`, trappole nei docs `a026435`
- [x] T32 [architect] — Riorganizzazione della vista: censimento, tagli, piano
      — `.claude/specs/T32-report.md`, note nei docs `9b735a6`. La guardia ha
      tenuto: l'analisi resta manutenzione, i task implementativi **no**. Il
      goal si apre dall'enunciato proposto in §5 del report, con le fette che
      l'utente compra — non prima.

## Analisi in giacenza — non e' un task, e' materiale per decidere

- `.claude/specs/T33-report.md` — costo della verifica nel browser. La leva 3
  e' fatta (T34: porta fissa, `dev:fresh`). Restano le leve 2b (primitive
  dev-only), 2a e 1 (test in browser mode), in quest'ordine: 2b e' il
  *prerequisito* di 1, non un'alternativa. L'utente ha fermato
  l'investimento dopo la leva 3 — tooling per abbassare il costo dei task
  rimasti si ripaga sul goal dopo, non su questo. Da riproporre solo con un
  goal nuovo. **Prima di scopare la leva 1**: provare che la browser mode di
  vitest parta su questa macchina Windows, mai fatto.
- `.claude/specs/T32-report.md` — **e' la spec di T44-T48**, non un'analisi in
  attesa: sta elencato qui perche' T32 e' `[x]` e lo sweep degli orfani lo
  cancellerebbe. Muore col commit di T48. Contiene anche S5b, S6 e S7, che
  restano fuori goal: se S5b si comprera' un giorno, il materiale e' qui.
- `.claude/specs/T26-report.md` — UX dei link, tutto misurato nell'app. O1, O2
  e il banner sono chiusi con Goal D, ma **non cancellarlo**: e' il materiale
  di O4 (editor delle dipendenze), l'unica delle sue opzioni ancora in
  giacenza, e senza il report O4 si riaprirebbe da zero. Lo sweep degli orfani
  lo prenderebbe, T26 e' `[x]`. La sua §9 non serve piu' come lista di lacune:
  la goal review di Goal D le ha misurate tutte (schema chiaro, altri zoom,
  summary, milestone, undo della creazione) e reggono.

## Log
- Cap: 40 righe, una-due per voce, nessun elenco di task chiusi (il commit e' il
  record; il resto della regola sta in `.claude/orchestrate.md`).
- Dimensionamento, dai costi misurati: impl oltre ~200k = task sovradimensionato
  da splittare (T35 a 215k, T18 a 182k+250k); il critic costa 100-160k a
  passata; un giro di correzione sullo stesso agente via SendMessage costa meno
  di un fresh spawn (che ripaga ~40k di ingresso).
- Un task il cui accept e' una campagna di misura va scopato come task di sola
  misura: T31 chiedeva misura + modifica e ha saturato tre contesti per 21
  righe di diff. T42 e' la conferma per la via opposta — una riga di codice piu'
  sei accept nel browser, scopato come misura, 99k/135k e zero correzioni.
- Ricognizione a monte del brief: paga (T42, zero ri-esplorazioni) **ma un
  `file:line` copiato non e' verificato**: quella di T43 si contraddiceva, il
  brief ha copiato, il difetto e' arrivato al critic. Mitigazione che funziona:
  se il brief elenca fatti che non ha letto, **ordinare alla corsia di
  verificarli invece di fidarsi** — su T44 ha scartato due percorsi di modulo
  sbagliati del brief (`Project` da `../scheduler`, che non lo esporta).
- Un brief che prescrive un testo *verbatim* si assume la responsabilita' di
  quel testo: il messaggio di T41 copriva un gesto rifiutato su tre. Se il
  brief fissa una stringa, deve enumerare i casi che quella stringa incontra.
- Il critic che rimisura al viewport di default annulla le deviazioni
  d'ambiente della corsia e trova cio' che l'accept non chiedeva: quello di T41
  ha coperto due lacune della §9 di T26, quello di T42 ha trovato lo
  spostamento di riga che e' diventato T43. Vale il costo, ogni volta.
- **Chiedere al critic la domanda che fa paura.** Il brief di T42 gli ha
  ordinato di cercare i percorsi in cui l'imbuto scatta *senza* azione utente:
  e' l'unico rischio della decisione, e la risposta misurata (nessuno) e' cio'
  che ha reso il pass un pass e non una speranza.
- **Una corsia che dichiara un'impossibilita' va confrontata con cio' che le
  corsie precedenti hanno gia' fatto.** Quella di T43 ha dichiarato non
  guidabile il drag reale del mouse; T41 e il critic di T42 lo avevano fatto,
  con un altro strumento. Il brief del giro di correzione ha nominato lo
  strumento e il drag e' riuscito al primo colpo.
- T32: architect 235k / 27 tool use, nessun critic (un report non ha diff da
  rivedere; ho spot-checkato io i `file:line` portanti, costo un grep). 235k su
  un task di sola lettura di 3200 righe non e' sovradimensionamento: e' il
  prezzo del censimento, e si paga una volta.
- **Un passo di verifica deve essere osservabile.** La §6 di T32 chiedeva
  `git status` = solo il report: impossibile, `.claude/*` e' ignorato. Se un
  accept nomina git, prima verificare che git veda quel file.
