# Catalogo commerciale delle farine

`lievia_farine_verificate.json` contiene attributi tecnici ricavati dalle pagine pubbliche dei produttori. I `null` indicano dati non dichiarati o non verificati; non convertirli in zero o in valori stimati. Gli intervalli originali vanno mantenuti per la visualizzazione.

L'adapter dell'app conserva l'intero record del produttore. Gli eventuali midpoint nei campi numerici legacy sono soltanto valori di compatibilità preliminare: non sostituiscono gli intervalli originali e non sono misure di laboratorio.

Il batch `lievia_farine_aggiuntive_2026-10-10.json` usa uno schema distinto con intervalli annidati, data `accessed`, campi verificati e assorbimento farinografico. Questo dato rimane separato dall'idratazione percentuale della ricetta. I prodotti dichiarati come miscele commerciali sono distinti dalle farine; i preparati con ingredienti aggiunti non partecipano al calcolo delle percentuali di farina quando la composizione interna non è disponibile.

Le specifiche marcate come storiche sono conservate nella sezione archivio e non vengono conteggiate o mostrate come prodotti correnti.

Il campo opzionale `imageUrl` è predisposto per un futuro URL immagine. Aggiungerlo solo dopo aver verificato e documentato i diritti di visualizzazione e redistribuzione dell'immagine; il catalogo attuale non include né scarica immagini di prodotto.