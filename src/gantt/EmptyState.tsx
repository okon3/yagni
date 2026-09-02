export function EmptyState({
  onAddTask,
  onOpen,
  onEditResources,
}: {
  onAddTask(): void;
  onOpen(): void;
  onEditResources(): void;
}) {
  return (
    <div className="empty">
      <div className="empty__card">
        <h2>Nessuna attività</h2>
        <p className="empty__lead">
          Inserisci l&apos;<strong>effort</strong> e la data di <strong>inizio</strong>: la data di
          fine la calcola il motore. Quando più attività della stessa persona si sovrappongono, la
          sua capacità si divide in parti uguali e le attività si allungano di conseguenza.
        </p>

        <ol className="empty__steps">
          <li>
            <button type="button" className="empty__action" onClick={onEditResources}>
              Definisci le persone
            </button>
            <span>
              con la loro disponibilità sul progetto — 50% se qualcuno è staffato a metà tempo.
            </span>
          </li>
          <li>
            <button type="button" className="empty__action" onClick={onAddTask}>
              Aggiungi un&apos;attività
            </button>
            <span>
              poi doppio click su una cella della griglia per modificarne nome, risorsa, effort o
              inizio.
            </span>
          </li>
          <li>
            <span>
              Il <strong>+</strong> a fine riga crea un sottotask. Un&apos;attività con sottotask
              non si compila più a mano: effort e durata si sommano dai figli, e il colore scelto sul
              livello alto scende su tutto il ramo.
            </span>
          </li>
          <li>
            <span>
              Trascina il pallino a destra di una barra su un&apos;altra per creare una{' '}
              <strong>dipendenza</strong>.
            </span>
          </li>
        </ol>

        <div className="empty__open">
          <button type="button" className="empty__primary" onClick={onOpen}>
            Apri un file .gantt
          </button>
          <span>oppure trascinalo qui dal computer</span>
        </div>
      </div>
    </div>
  );
}
