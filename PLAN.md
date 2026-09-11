# Plan

## Cosa resta sul tavolo

**Goal E e' chiuso e potato** (review fix-first, unica azione scaricata da
T51): chart 2228 → 1205. Nessuna release — refactoring, e il changelog non
prende plumbing.

Aperti: **T16**, unico task di Goal C, che lo porterebbe alla sua review;
**T49** (un Tab salta una cella) e **T50** (cosa puo' provare una battuta di
tasti da agente), usciti dalla checklist di T48; **O4** in giacenza.

**Una decisione aperta, dell'utente**: il piano si contraddice su
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

## Goal E — la vista si legge senza leggerla tutta                   [chiuso]
`GanttChart.tsx` sotto le 1300 righe in cinque commit di puro spostamento, per
togliere il costo di contesto: ogni task di Goal D aveva speso 100-350k token a
ricostruire il contesto di un file da 2228 righe. Consegnato: **2228 → 1205**,
sei moduli piatti in `src/gantt/`. Goal review dell'11-09: **fix-first**
(fable-5-1 in header), MISSING e SMUGGLED vuoti, unica COHERENCE chiusa da T51.
Misurato dalla review sul diff accumulato: le sole righe `+` nel chart sono
import, il letterale `RowContext` e 12 call site; nessuna logica nuova oltre le
firme; la sequenza di init e' ancora **una lista lineare in un posto solo**, coi
tre vincoli d'ordine annotati accanto alle chiamate; e la cucitura che T33 §5b
chiedeva e' esposta come export normali (`widestLabelWidth`, `appliedScrollX`,
`nonWorkingSpans`). Il blocco di import del chart e' ora l'indice del modulo.

- [x] T44 [impl] — S1: `ganttHandle.ts` — `90855c0`
- [x] T45 [impl] — S2: `zoomLevels.ts` + `timelineGeometry.ts` — `25f6a54`
- [x] T46 [impl] — S3: `timelineOverlays.ts` — `ed64f5c`
- [x] T47 [impl] — S5a: `ganttRows.ts` — `e740d94`
- [x] T48 [deep] — S4: `gridColumns.ts` — `bd020a1`, docs `170f706`
- [x] T51 [self] — La convenzione dei nomi che la review ha smentito — `bd092bf`

Cio' che il goal ha deciso e che non va riproposto: **S5b, S6 e S7 restano
fuori** (S5b unifica la mappa riga — l'unica fetta che cambia forma, in
giacenza finche' un goal non aggiunge campi di riga; S6/S7 su `App.tsx` e i
gesti, raccomandati contro dalla spec). Il corpo del handle (268 righe) e gli
handler del modello restano nel chart per scelta: sono le operazioni e il
codice che muta il modello, e il file di destinazione sarebbe grande quanto
quello che lascia. Nessuna release: cinque fette di refactoring, e il
changelog non prende plumbing.
Due trappole graduate nei docs invece di restare qui: lo slot di config che non
deve un detach, e la lettura di `gantt.config.*` a livello di modulo che
precede il corpo del componente (`docs/dhtmlx.md`).

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
- Dimensionamento misurato: impl oltre ~200k = task da splittare (T35 215k, T18
  182k+250k); critic 100-160k a passata; una correzione via SendMessage costa
  meno di un fresh spawn (~40k di solo ingresso).
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
- Il critic trova cio' che l'accept non chiedeva (T41, T42, T45). Su uno
  spostamento **l'hash, non la lettura** — e il diff complementare di cio' che
  resta (T47, T48: e' l'unica prova contro un ripristino sporco). E sempre **la
  domanda che fa paura**: misurata, e' cio' che rende il pass non una speranza.
- **Cio' che una corsia dichiara impossibile o preesistente va confrontato con
  l'evidenza.** T43 dava il drag reale per non guidabile, T41 l'aveva fatto;
  T46 dava per difetto dello scheduler la propria `setCalendar`. Fatto bene su
  T48: il Tab misurato su HEAD **e** sul tree, prima di dirlo preesistente.
- **Un accept deve essere osservabile, indipendente dalla scala, e provare cio'
  che dice di provare.** T45 chiedeva ctrl+wheel (non misurabile in sintetico),
  T46 «le bande spariscono a Months» (vero su un piano corto, falso su uno
  lungo), T48 «Tab muove fra le celle» (ne muove due). Cinque fette su cinque.
- **I documenti vanno confrontati fra loro e col codice**: la §3 di T45
  illustrava una firma che la §4 vietava; la §5 della spec di Goal E propone un
  detach che la §6 contraddice; e una regola che ho scritto su `install*` era
  falsa sull'altra `install*` del repo. Mie tutte e tre. Una regola derivata da
  un modulo si verifica su **tutti** i suoi casi prima di entrare nei docs.
- **La porta va verificata, non dedotta da una notifica.** Ho scritto a una
  corsia «nessun'altra e' viva, la porta e' tua» sulla fede del completamento
  del critic, che stava ancora lavorando: il suo listener e' stato sfrattato.
  La regola esiste in CLAUDE.md e non e' bastata — serve il controllo sul PID.
