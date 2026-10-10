# Lievia 1.0 — The Science of Dough

Lievia è un’applicazione web per calcolare impasti con le percentuali del panificatore, organizzare farine e ricette e pianificare le fasi di fermentazione. Non richiede un account né un servizio remoto.

## Funzioni

- Calcolo delle quantità con bilancio di massa, stili di pizza, formati e miscele di farine.
- Profili dimostrativi e archivio locale delle farine personali.
- Ricette salvate, duplicabili e stampabili, con compatibilità dei dati Phase 1 e Phase 2.
- Piano cronologico modificabile, temperature distinte per ambiente, frigorifero e impasto, strategie ambiente/frigo/combinate.
- Confronto operativo delle strategie, registrazione degli esiti personali e backup JSON validato.
- Dosaggio manuale del lievito; conversioni facoltative solo con rapporti dichiarati dall’utente.

## Avvio e verifiche

Richiede Node.js 20.19+ (oppure 22.12+) e npm.

```bash
npm ci
npm run dev
```

Apri l’indirizzo mostrato da Vite, normalmente `http://localhost:5173/lievia/`.

```bash
npm test
npm run lint
npm run build
npm run preview
```

La build di produzione è generata in `dist/`. Vite usa `/lievia/` per la pubblicazione; il server di sviluppo resta utilizzabile localmente. L’app usa `HashRouter`, così ricaricare una pagina interna su GitHub Pages non richiede una regola di riscrittura.

## Lievitazione e limiti scientifici

Le quantità degli ingredienti e il bilancio dell’impasto sono calcoli aritmetici basati sui dati inseriti. La modalità assistita non fornisce dosaggi numerici: non è disponibile un modello del lievito con coefficienti, fonti e calibrazione tracciabili.

Il profilo termico semplificato è facoltativo. Richiede una costante termica e una temperatura iniziale misurata o esplicitamente ipotizzata; i punti successivi sono stime, mai misure. Se i parametri mancano, Lievia mostra l’incertezza e non disegna una curva. Il modello termico non simula la cinetica biologica. Il freddo rallenta la fermentazione ma non la arresta.

Idratazione, sale, caratteristiche della farina, tipo e vitalità del lievito possono contribuire alla risposta dell’impasto, ma Lievia non ne quantifica l’effetto con un modello validato. W e P/L non bastano da soli a prevedere la lievitazione. Fermentazione e maturazione sono processi correlati ma distinti; una pianificazione temporale non è una misura delle trasformazioni dell’impasto. Le osservazioni registrate non addestrano né aggiornano automaticamente il modello.

## Dati e riservatezza

Ricette, farine personali, impostazioni, esiti e record di calibrazione sono memorizzati nel LocalStorage del browser. I dati appartengono al browser e al dispositivo in uso, non vengono sincronizzati e possono andare persi cancellando i dati del sito. L’app non invia questi contenuti a un server. Esporta periodicamente un backup JSON e conservalo in un luogo scelto da te. L’importazione valida la struttura e aggiunge gli ID nuovi; non sovrascrive ricette o farine personali già presenti.

## Immagini per le schermate

Per documentare una release, acquisisci la schermata principale e il planner a larghezza desktop e mobile. Salva le immagini approvate in `docs/screenshots/` con nomi descrittivi, per esempio `panoramica-desktop.png`, `planner-desktop.png` e `planner-mobile.png`; aggiornare questa sezione con i riferimenti solo dopo aver verificato le immagini e rimosso eventuali dati personali.

## Licenza

Stato della licenza: **non specificata**. Il repository non include una licenza; non è stata selezionata né viene concessa qui un’autorizzazione al riuso. Concordare la licenza prima di pubblicare termini diversi.

## Pubblicazione su GitHub Pages

Il repository atteso si chiama `lievia`; il workflow `.github/workflows/deploy.yml` esegue `npm ci`, test, lint e build, quindi carica `dist` con le azioni ufficiali GitHub Pages. Usa i permessi minimi `contents: read`, `pages: write` e `id-token: write`. L’URL risultante segue la forma `https://USERNAME.github.io/lievia/`. Prima della pubblicazione, crea un repository GitHub vuoto chiamato `lievia`, senza aggiungere README o licenza dal sito, poi sostituisci `USERNAME` nei comandi:

```bash
git init
git branch -M main
git add .
git commit -m "Lievia 1.0"
git remote add origin https://github.com/USERNAME/lievia.git
git push -u origin main
```

In GitHub apri **Settings → Pages** e seleziona **GitHub Actions** come sorgente. Attendi il completamento del workflow prima di considerare il sito pubblicato. Questi passaggi non sono stati eseguiti da Lievia e non pubblicano automaticamente questo workspace.

## Aggiornamenti futuri

Modifica il codice localmente, esegui test, lint e build, quindi crea un commit. Dopo aver collegato il repository remoto e autorizzato la pubblicazione, invia gli aggiornamenti sul branch `main`; GitHub Actions esegue nuovamente i controlli e pubblica la build. Non inserire token, chiavi o file `.env` nel repository.