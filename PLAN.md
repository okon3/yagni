# Plan

## Cosa resta sul tavolo

Goal D e' chiuso. Restano tre cose, in nessun ordine obbligato: **T32** e' la
raccomandazione di fondo (la tassa di contesto su `GanttChart.tsx` che ogni
goal futuro paga), **O4** e' in giacenza e si riproporra' con la correzione di
Goal D in mano, **T16** porterebbe Goal C alla sua review.

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
- Ricognizione `Explore` a monte del brief: paga — su T42 una passata sonnet ha
  dato tutti i `file:line` e la corsia non ha ri-esplorato nulla — **ma un
  `file:line` copiato da una ricognizione non e' verificato**. Quella di T43 si
  contraddiceva (`.app__expansion` a 20 in tabella, 30 in prosa), il brief ha
  copiato la tabella, e il difetto e' arrivato fino al critic. Quando due parti
  di un report non concordano, verificare costa una riga di grep.
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
- Per T32: nessun brief di T12-T31 esiste piu', il conteggio degli accept sui
  task chiusi e' una stima. E la domanda "modularizzare o testare?" appartiene
  a T33 e non va riaperta li'.
- **Una corsia che dichiara un'impossibilita' va confrontata con cio' che le
  corsie precedenti hanno gia' fatto.** Quella di T43 ha dichiarato non
  guidabile il drag reale del mouse; T41 e il critic di T42 lo avevano fatto,
  con un altro strumento. Il brief del giro di correzione ha nominato lo
  strumento e il drag e' riuscito al primo colpo.
- T41: impl 117k / 103 tool use, critic 117k / 69, zero giri. T42: impl 99k /
  74, critic 135k / 78, zero giri. T43: impl 128k + 170k (un giro), critic
  155k / 104 — il piu' caro del goal, e il giro l'ha pagato un errore del
  brief, non la corsia.
