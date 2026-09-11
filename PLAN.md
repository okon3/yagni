# Plan

## Cosa resta sul tavolo

**Goal E: cinque fette su cinque committate, il goal e' in attesa della sua
goal review** — obbligatoria, e da eseguire prima di qualunque potatura,
perche' gli Accept di T44-T48 sono metà del suo bar. Restano fuori
**S5b** (unifica la mappa riga: l'unica fetta che cambia forma, in giacenza
finche' un goal non aggiunge campi di riga) e **S6/S7** (`App.tsx` e i gesti:
raccomandati contro). Aperti oltre a Goal E: **T16** che porterebbe Goal C alla
sua review, **T49** e **T50** (usciti da T48, manutenzione), **O4** in giacenza.

**Da decidere alla chiusura di Goal E**: il piano si contraddice su
`.claude/specs/T32-report.md` — lo dà per morto col commit di T48 e insieme
per unico materiale di S5b. Non cancellato: `.claude` non è tracciato, quindi
la cancellazione è definitiva (i brief di T12-T31 sono andati così). Decide
l'utente.

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

## Goal E — la vista si legge senza leggerla tutta               [in review]
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

Due trappole per i brief di T47 e T48, pagate su T44-T46: le righe `:NNNN` che
la spec cita sono **stale** (scritta su un chart di 350 righe piu' lungo, e
ogni fetta lo accorcia ancora) — rilocalizzarle sul file prima di scrivere il
brief, non copiarle; e la §5 della spec propone ancora un `unmountOverlays(o)`
che la §6 contraddice (ogni `mount*` restituisce il proprio detach). T46 ha
risolto per la §6: le altre due fette escono dalle stesse righe della §5.

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

- [x] T45 [impl] — S2: `zoomLevels.ts` + `timelineGeometry.ts` — `25f6a54`
      Accept tenuti, sei prove nel browser (zoom coi bottoni, Fit su piano
      lungo, task fuori range, ratchet del ripin con le date registrate, label
      lunga non tagliata). Chart 2132 → **1877**. Verbatim provato per hash: le
      sole differenze sono otto `export` e un dedent; init byte-identica a HEAD
      meno 244 righe. `widestLabelWidth` e `appliedScrollX` esportati — la
      cucitura di T33 §5b e' consegnata, la probe non e' stata scritta.
      **La prova ctrl+wheel era invalida come dichiarata** (un `wheel`
      sintetico non misura quel percorso, `docs/dhtmlx.md:240`) ma non
      portante: il listener non si e' mosso, della catena wheel e' migrata solo
      la costante.
- [x] T46 [impl] — S3: `timelineOverlays.ts` — `ed64f5c`
      Accept tenuti, checklist piena misurata due volte (corsia e critic, su
      fixture diverse). Chart 1877 → **1656**; il critic ha provato il verbatim
      per diff normalizzato: blocchi 1 e 2 identici byte a byte, e ogni riga
      residua cade nelle quattro deroghe del brief. Diff del chart: 12 righe
      aggiunte, tutte import o call site. Shutdown su tutte le righe
      (`height` = `$task_bg.offsetHeight`, 180px su 5 righe, 108 su 3); assenza
      solo sulla riga della persona, niente a `T0` ne' su ramo chiuso; z-order
      osservato con un MutationObserver (`today` inserito per primo, bande non
      raggruppate davanti), hatch sopra le barre; **0.000 px su 4/4 coppie
      chart ↔ corsia a scroll 0, intermedio e max**; detach provato sulle
      rimozioni registrate (non sul conteggio finale) — un `.gantt-today` e due
      `.gantt-bands` vivi dopo il doppio mount.
      **Un accept era formulato male, non il codice**: «a Months spariscono»
      e' scale-dependent — dhtmlx adatta la larghezza delle colonne al range,
      quindi le bande weekend muoiono a Quarter su un piano di 16 mesi
      (2.300 px/giorno) e all'ultimo livello su uno di 3 settimane
      (2.658 px/giorno). La soglia e' sui giorni resi (`10 / px-per-giorno`) e
      scatta dove deve: misurata a 9.999 px/giorno le bande sopravvivono, a
      2.3 no. Il time-off non ha soglia, per progetto.

- [x] T47 [impl] — S5a: `ganttRows.ts`, spostamento puro — `e740d94`
      Accept tenuti, smoke misurato due volte (corsia e critic, fixture
      diverse): summary scuro `shade(colore, 0.55)` misurato col computed
      style, condivise senza colore inline (`barBackground` → `''`), colore
      ereditato dal padre, milestone a rombo 17×17, Duration/End popolate; un
      edit rotola il summary e spinge la milestone linkata. Chart 1656 →
      **1527**, modulo 150 righe. Verbatim provato: i nove blocchi sono
      identici byte a byte a meno di dieci `export`, e il critic ha provato
      **anche cio' che resta** (1475 righe, diff vuoto) — quindi nessun call
      site passa argomenti diversi. Nessun ciclo: `ganttRows` e' importato da
      un solo file e nessun modulo di `src/gantt/` importa dal componente.
      `docs/view.md` §Grid aggiornato nello stesso commit (dei cinque punti
      dello schema riga, uno ora vive altrove).
      **La trappola era l'ordine di valutazione**, non le firme:
      `MILESTONE_TYPE`/`BAR_TYPE` leggono `gantt.config.types` a livello di
      modulo e ora quel modulo si valuta *prima* del corpo del chart. Provato
      innocuo su quattro livelli (dhtmlx non scrive mai `.types` — zero
      occorrenze nel bundle; i quattro moduli scavalcati non raggiungono
      dhtmlx; valore identico misurato nell'app). E `toGanttData` costruisce
      il formatter dentro la chiamata: hoistarlo avrebbe preso il
      `date_format` di default invece del nostro.

- [x] T48 [deep] — S4: `gridColumns.ts` — `bd020a1`, docs `170f706`
      Accept tenuti, checklist piena eseguita **in due metà disgiunte per
      contratto** (corsia: colonne/editor/dropdown/`grid_width`; critic:
      i sei template, su fixture propria) — la fetta piu' grande stava sopra
      il contesto di una sola corsia e la partizione l'ha tenuta a 171k+171k
      invece di sforare. Chart 1527 → **1205**: il goal chiudeva a 1300.
      Le due prove meccaniche, entrambe del critic: verbatim A/B/D **zero
      diff** su 66/65/73 righe, di C solo le righe di cornice (`return [` e la
      firma di `columnsWidth`); e il diff complementare — il chart **fuori** dai
      quattro range contro HEAD lascia solo le 8 cancellazioni di import
      dichiarate e una riga vuota di giuntura. Sostituzioni 4/2/1 esatte,
      zero `.current`/`useRef`/`react` nel modulo.
      Misurato nel browser: `gantt-found-below` su ramo **chiuso** (le righe
      che matchano assenti dal DOM) su entrambe le classi riga; link a tre
      persone che portano le classi di **entrambi** i capi (opacity 1 vs 0.24
      col computed style); `critical-old` tratteggiato oltre il limite delle
      40 foglie; figlio di summary disabilitato che resta abilitato sul
      **proprio** toggle; segmenti su 3 task contesi e `""` sui 7 non
      condivisi; `grid_width` 706 = somma dichiarata, nome a 230px.
      **La domanda sul remount ha risposta misurata, non dedotta**: i sei
      template sono gli stessi oggetti funzione prima e dopo un edit (6/6),
      un redraw li chiama una volta per riga visibile (11/11/11 su 11 righe),
      e i tre getter risolvono sulle celle vive dopo il doppio mount di
      StrictMode. Nessun lettore stale: `install*` riempie slot di config,
      non registra — la regola del detach ora lo dice (`docs/dhtmlx.md`).
      Due difetti della spec chiusi nel brief invece che riscoperti: le righe
      `:NNNN` stale (rilocalizzate sul file: A `54-119`, B `648-712`,
      C `740-866`, D `868-940`) e il tipo `GanttConfig['columns']`, che **non
      esiste** — è `GridColumn`, esportato da dhtmlx.
      Accept chiesti, checklist piena: le 8 colonne (nome con pallino/rombo, avatar,
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
prezzo di stare qui — dichiarato adesso, non scoperto alla fine. Se uno di
questi cresce fino a meritarne una, si apre un goal e lo si sposta.

- [ ] T49 [impl] — Un Tab salta una cella nell'editor della griglia
      Un Tab avanza **due** celle editabili (`text` → `nominal_days`, salta
      `resource_id`). Due handler keydown vivi chiamano entrambi
      `editNextCell(true)`: `editorKeys` del chart e quello dell'extension
      inline-editors. Il commento accanto a `editorKeys` assume che solo il
      primo scatti — vero col vecchio harness sintetico, falso con tasti a
      livello CDP, che portano un `keyCode` reale.
      **Preesistente, non introdotto da T48**: misurato instrumentando
      `startEdit` e contando le chiamate per keydown su HEAD e sul tree di
      T48 — identico, chiamata per chiamata, su due run.
      Accept: un Tab = una cella, Shift+Tab simmetrico, e la misura per
      conteggio di `startEdit` (non a occhio) prima e dopo il fix.

- [ ] T50 [impl] — Cosa può provare davvero una battuta di tasti da agente
      `docs/verification.md` §«Synthetic keyboard events» dichiara che gli
      handler dhtmlx che leggono `keyCode` non vedono mai un tasto premuto da
      un tool. Con CDP (`Input.dispatchKeyEvent`) lo vedono: Escape, che quel
      paragrafo dà per solo-tastiera-reale, ha chiuso l'editor in T48. La
      riga non è falsa, è **specifica dell'harness** — e finché resta come
      scritta ogni task futuro rinuncia a misure che può fare.
      Task di **sola misura** (regola del Log): censire quali tasti arrivano
      a quali handler con lo strumento in uso, poi riscrivere il paragrafo
      distinguendo harness da harness. Nessun cambio di codice applicativo.
      Accept: la tabella misurata, e il paragrafo che non sovra-dichiara in
      nessuna delle due direzioni.

- [x] T40 [self] — L'ultimo descendant override di una primitiva di dialog — `1d2cb2e`
- [x] T36 [self] — Tracciare il piano e il binding in git — `35483e0`

- [x] T31 [impl] — Il pixel di scroll: premessa falsa, nota nei docs corretta — `d9d2356`

**Due proposte emerse da Goal E, offerte all'utente e non comprate** (non sono
task: nessuno le ha scopate, e vanno riproposte solo se qualcuno le vuole):
- `yagni.setCalendar` accetta un `CalendarSpec` malformato e lo memorizza
  verbatim — finestre passate come `'08:00'` dove il campo vuole minuti da
  mezzanotte. L'esito e' «Scheduler stalled: pending tasks are unreachable»,
  e in un ordinamento la tab si e' piantata. Il formato file rifiuta invece di
  riparare (gate stretto); l'agent API no. Scoperto da una corsia su T46, che
  l'aveva preso per un difetto dello scheduler.
- La soglia dei 10px delle bande e la regola «nessuna banda su un summary o su
  un ramo chiuso» vivono ora in `timelineOverlays.ts`, importabile, ma sono
  appuntate solo dalla misura nel browser. Un test le fisserebbe, al prezzo di
  un mock di `gantt`.

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
  righe di diff; T42, scopato come misura, 99k/135k e zero correzioni.
- **Spezzare la checklist in due metà disgiunte tiene dentro il contesto un
  task fuori misura**: T48 (331 righe, la checklist piu' lunga del goal) —
  corsia e critic su liste e fixture diverse, 172k e 171k, zero giri, dove
  T46 da solo aveva fatto 205k. La partizione va scritta nel brief: dire
  «questa metà non e' tua» evita che la corsia la paghi comunque.
- Ricognizione a monte del brief: paga, **ma una citazione copiata non e'
  verificata** — ne' un `file:line` (T43: si contraddiceva, il difetto e'
  arrivato al critic) ne' un nome di tipo (T48: la spec citava
  `GanttConfig['columns']`, che non esiste). Mitigazione che ha pagato quattro
  volte (T44, T46, T48): i fatti che il brief non ha letto, **ordinare alla
  corsia di verificarli**; quelli che ha letto, risolverli nel brief.
- Un brief che fissa una stringa si assume la responsabilita' di quel testo e
  deve enumerare i casi che incontra: il messaggio di T41 copriva un gesto
  rifiutato su tre.
- Il critic trova cio' che l'accept non chiedeva (T41, T42, T45). Su uno
  spostamento **chiedergli l'hash e non la lettura** (T44, T46: provato in un
  colpo, dove `tsc` e' cieco), e sempre **la domanda che fa paura** — su T46 se
  chart e corsia possano leggere calendari diversi: la risposta misurata e' cio'
  che rende il pass un pass e non una speranza.
- **Cio' che una corsia dichiara impossibile o preesistente va confrontato con
  l'evidenza che c'e' gia'.** T43 dava il drag reale per non guidabile, T41
  l'aveva fatto con un altro strumento. T46 dava per difetto dello scheduler
  uno stallo che due file di test smentivano: era la sua `setCalendar` con le
  finestre passate in stringhe dove il campo vuole minuti. Una grep e' bastata.
- **Un accept deve essere osservabile, indipendente dalla scala, e provare cio'
  che dice di provare.** T45 chiedeva ctrl+wheel (non misurabile in sintetico),
  T46 «le bande spariscono a Months» (vero su un piano corto, falso su uno
  lungo), T48 «Tab muove fra le celle» (ne muove due). Cinque fette su cinque.
- **I documenti vanno confrontati fra loro, non solo col codice**: la §3 di T45
  illustrava una firma che la §4 vietava di cambiare; la §5 della spec di Goal E
  propone un detach che la sua §6 contraddice. Mie entrambe.
