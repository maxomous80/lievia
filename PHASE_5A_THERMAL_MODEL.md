# Phase 5A — Modello termico e preparazione dei dati

**Stato:** infrastruttura di misura e stima implementata; nessuna validazione sperimentale del modello è stata eseguita.
**Ambito:** temperatura dell’impasto, integrità dei dati e preparazione di una futura calibrazione. Non stima attività biologica, maturazione, tempi di lievitazione o dosaggi di lievito.

## Modello attuale

Per una fase a temperatura ambientale costante e costante termica fissa, la temperatura stimata è la soluzione analitica esatta dell’equazione del primo ordine:

$$
T(t) = T_{env} + (T_{initial} - T_{env}) e^{-t/\tau}
$$

- `T(t)`: temperatura stimata dell’impasto in °C al tempo trascorso `t`.
- `T_env`: temperatura dell’ambiente associato alla fase, in °C.
- `T_initial`: temperatura misurata o ipotizzata all’inizio della fase, in °C.
- `tau` (`τ`): costante termica positiva espressa in minuti.

Il valore finale calcolato per una fase è trasferito senza salto come condizione iniziale della fase successiva. Cambiando ambiente si applica la stessa soluzione con il nuovo `T_env`; `tau` resta comune finché l’utente non cambia configurazione. Le fasi `environment: 'dough'` non hanno una temperatura esterna definita e interrompono la curva con stato sconosciuto. Le misure esplicitamente inserite all’inizio della sessione o di una fase possono riancorare il tratto successivo; la proprietà `measurementRole: 'assimilated'` le distingue dai punti calcolati. Un punto assimilato non è una previsione indipendente.

## Assunzioni

- Temperatura ambientale costante all’interno di ciascuna fase.
- Un solo modello a primo ordine con capacità di risposta espressa da un `τ` configurabile.
- Continuità della temperatura dell’impasto ai confini di fase, salvo una misura reale usata per riancorare esplicitamente il profilo.
- Nessuna dipendenza dedotta tra `τ` e massa, geometria, recipiente, materiale, flusso d’aria o composizione dell’impasto.
- I valori ambiente/frigorifero provengono dalla configurazione utente. Un profilo stimato non è una misura, una calibrazione né una proprietà universale.

## Schemi dei dati

**Profilo:** `TemperatureProfile` (`src/domain/fermentation/temperatureProfile.ts`) espone `status`, punti temporali ISO, fase/ambiente, temperature circostanti, temperatura impasto nullable, origine (`measured`, `estimated`, `unknown`) e ruolo (`assimilated`, `independent`, `model`).

**Campione manuale:** `TemperatureMeasurementSample` (`src/domain/fermentation/thermalCalibration.ts`) conserva ID, timestamp ISO con fuso, temperatura °C, unità, sorgente, ID sensore opzionale, incertezza opzionale, nota opzionale, fase opzionale e ruolo `calibration` oppure `validation`. Timestamp duplicati, unità incoerenti, sorgente assente, valori non finiti/fuori range e incertezza non valida vengono rifiutati; i campioni fuori ordine sono riordinati con avviso.

**Sessione per fitting:** `ThermalCalibrationRun` contiene inizio, temperatura iniziale, ambiente o valore mancante, provenienza ambientale, campioni e provenienza dichiarata. `ThermalCalibrationDataset` ha schema 1 e provenienza `user-measurements`; il codice non genera dataset di produzione.

**Snapshot esito:** `ExperimentSnapshot` versione 1 salva una copia profonda della configurazione ricetta, masse e percentuali ingredienti, ID/proprietà fonti farine, quantità/tipo lievito e lotto facoltativo, massa impasto, fasi, eventuali operazioni reali, temperature opzionali, campioni collegati, geometria facoltativa, provenienza e unità. Gli outcome precedenti restano validi senza snapshot; l’assenza è distinta da un valore misurato pari a zero.

## Configurazione e fitting

`EstimatorConfiguration.thermalTimeConstantMinutes` è facoltativa e non ha un valore predefinito. `thermalTimeConstantProvenance` distingue un inserimento manuale da un numero stimato sui campioni dichiarati. Non sono presenti valori sperimentali hard-coded.

`fitThermalTimeConstant()` seleziona esclusivamente campioni `calibration`. Per ogni sessione usa una temperatura iniziale dichiarata e temperatura ambientale costante. Cerca il minimo dei residui quadratici in `log(τ)` con ricerca aurea limitata a valori positivi e finiti. Il fitting è rifiutato o segnalato se mancano almeno quattro osservazioni di calibrazione, temperatura ambientale, contrasto iniziale-ambiente o variazione temporale informativa, se i timestamp non sono compatibili, se la misura precede l’inizio o se l’ottimizzazione/residui non sono validi.

MAE e RMSE sono calcolati come:

$$
MAE = \frac{1}{n}\sum_i |T_i^{misurata} - T_i^{stimata}|,
\qquad
RMSE = \sqrt{\frac{1}{n}\sum_i (T_i^{misurata} - T_i^{stimata})^2}
$$

Metriche di calibrazione descrivono l’adattamento ai punti usati per stimare `τ`. La metrica indipendente usa solo i punti marcati `validation`; non confluisce nel fitting. La UI non presenta l’ottimizzatore numerico come prova di affidabilità e richiede la selezione esplicita prima di usare la stima nella configurazione.

## Verifica sintetica automatizzata

I fixture sintetici sono definiti esclusivamente nei test Vitest e sono etichettati nel campo provenance. Nessun campione sintetico è salvato o incluso nei backup dell’applicazione.

- Fixture sintetico `T_initial = 25 °C`, `T_env = 5 °C`, `tau = 120 min`; le osservazioni sintetiche recuperano `tau` entro 0,1 min nel test deterministico.
- Residui sintetici MAE e RMSE inferiori a 0,001 °C sia sul set usato per il fitting sia sul punto sintetico separato di verifica.
- Test analitici verificano soluzione esatta a 60 minuti, continuità tra fasi, raffreddamento, riscaldamento, convergenza a lungo termine e fase a durata zero.
- Test negativi verificano dati insufficienti, osservazioni quasi costanti, ambiente mancante, campioni di sola verifica, timestamp/valori/unità/provenienza invalidi e mancata riutilizzazione dei dati di calibrazione come validazione.

Questi risultati verificano l’implementazione rispetto a dati costruiti dalla stessa equazione; **non** costituiscono un esperimento fisico né una validazione indipendente.

## Requisiti di misura fisica

Per raccogliere dati utili servono sonde identificate e verificate rispetto a un riferimento, accuratezza/incertezza documentata, orologi sincronizzati, timestamp con fuso, campioni dell’impasto a intervalli noti, registrazione della temperatura ambientale durante ogni fase, massa e geometria documentate, recipiente/materiale e condizioni di contorno annotati, ricetta completa e protocollo replicabile. Per la verifica serve un set di campioni/run tenuto fuori dal fitting.

I campi geometrici e ambientali sono registrati come covariate descrittive; il software non li usa per derivare `τ`. Campi assenti restano assenti, non vengono interpolati o sostituiti con misure presunte.

## Limiti e validazione mancante

- Nessuna misura fisica, sessione reale di calibrazione o prova con sensore è stata fornita/eseguita per questa implementazione.
- Nessuna accuratezza sperimentale, intervallo d’incertezza o valore trasferibile di `τ` è noto.
- I cambi di ambiente sono trattati per tratti costanti; non sono modellate variazioni continue dell’aria, lag della sonda, gradienti interni, scambio radiativo, evaporazione, recipiente, impastamento o proprietà dipendenti dalla temperatura.
- Il fitting eseguito su un’unica fase assume ambiente e parametro costanti; dati mescolati fra fasi o condizioni diverse non devono essere trattati come un’unica calibrazione.
- Il modello non descrive lievito, cinetica, pH, volume, prova, sicurezza alimentare o qualità sensoriale.
- `estimateYeast()` ed `estimateFermentationExposure()` restano non disponibili per previsioni quantitative.

## Esperimenti futuri — Phase 5B

Prima di qualsiasi Phase 5B occorre un protocollo approvato e una serie di misure replicate con sonde verificate. Una prima campagna termica dovrebbe variare in modo pianificato massa/forma, recipiente e profilo ambiente-frigorifero, mantenendo separate stima e verifica e documentando incertezza e condizioni. I risultati devono determinare se il modello a un solo `τ` è adeguato o se va abbandonato/esteso; non si deve introdurre una relazione geometrica o un coefficiente Q10 senza dati e revisione.

La successiva ricerca cinetica del lievito richiede outcome oggettivi e riproducibili per uno stato di lievitazione, tipo e lotto/attività lievito, ricetta completa, temperatura dell’impasto nel tempo e holdout indipendente. Dose lievito e stato fermentativo restano fuori ambito finché non esistono dataset, validazione scientifica e criteri d’accettazione espliciti.

## Dati e backup

I campioni manuali sono salvati localmente sotto `lievia.temperature.samples.v1` e inclusi nel backup JSON `lievia-backup` versione 2. Il parser continua ad accettare backup versione 1, che non contengono Lab workspace o campioni termici. L’import convalida tutte le collezioni, unisce per ID preservando i record locali con ID uguale e applica lo stato soltanto dopo una scrittura LocalStorage coordinata; in caso di errore tenta il ripristino delle chiavi precedenti e mostra un messaggio di recupero.