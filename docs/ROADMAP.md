# Priorità di sviluppo

## In revisione — scelta dei contesti CHIPS (21 novembre)

Cookie con stesso sito di partizione, nome e percorso ma diverso contesto degli
antenati apparivano indistinguibili nella tabella e nei nomi accessibili delle
checkbox. L'anteprima ora espone il discriminante già letto da Chrome; la UI
mostra «con/senza antenato cross-site», oppure «contesto antenati non disponibile»
quando Chrome non lo fornisce. Anche il nome accessibile include il sito e il
contesto. Nessuna deduzione di false da un campo assente.

Regressione: `node --test tests/chips-context.test.js`, due casi FAIL→PASS su
createApp e dashboard reali con API/DOM sintetici; stessi casi sullo ZIP estratto.
Identità, selettori e cancellazione invariati; nessun valore cookie aggiunto alla
UI. I test cron del 20/21 restano copertura locale storica (62/62), non rieseguita.

Prossimo: verifica reale della comprensibilità e degli annunci assistivi dei
contesti, solo in ambiente temporaneo autorizzato; sospensione reale ancora aperta.

## In revisione — lettura non disponibile nel popup (19 novembre, slice 3)

Un fallimento corrente di GET_STATUS ora elimina conteggi precedenti, classe
visiva dell'automatico attivo e vecchio avviso: sono dati non più verificabili,
non una revoca di consenso. Restano errore di lettura e Riprova. Il successivo
successo ripristina conteggi/stato; un errore obsoleto non cancella la nuova vista.
Il messaggio indipendente di apertura dashboard rimane intatto.

`node --test tests/popup-unavailable.test.js`: reject e ok:false falliscono sulla
base; con il fix 3/3 passano, anche sullo ZIP estratto. Nessun replay delle suite
precedenti. Sono fixture DOM/API, non prove di rendering o screen reader.

## In revisione — recupero apertura dashboard (19 novembre, slice 2)

Se sia openOptionsPage sia il fallback tabs.create falliscono, il messaggio di
apertura ora resta distinto dall'errore di lettura cookie. Un aggiornamento del
consenso non lo cancella; un nuovo tentativo di apertura pulisce solo il proprio
messaggio. Fallback e protezione dai clic duplicati erano già presenti e invariati.

`node --test tests/popup-navigation.test.js`: 4 casi mirati; un fallimento reale
sulla base, 4/4 dopo fix e sullo ZIP estratto. Nessun replay delle suite precedenti.
Delta impilato sulla PR della revoca esterna. DOM/API sintetici: nessuna prova di
rendering, focus o annuncio effettivo da screen reader.

## In revisione — revoca esterna nel popup (19 novembre)

La revoca/rimozione del consenso da un'altra pagina ora pulisce subito conteggi,
indicazione dell'automatico e vecchi avvisi nel popup, anche se il worker non
risponde. Prove di consenso invalide seguono lo stesso comportamento inattivo.
Una risposta aggiornata continua a essere richiesta: nessuna modifica a gate,
storage o cancellazione. I cambiamenti validi non cancellano preventivamente la
vista e gli eventi storage.session sono ignorati.

Regressione sintetica: `node --test tests/popup-status.test.js`, 12 casi totali
(inclusi i 5 della precedente correzione). Sei nuovi casi falliscono sulla base
precedente, tutti passano con il fix. Test anche sullo ZIP estratto.
Questo delta è sopra la precedente PR popup, senza integrare main.

## In revisione — popup e aggiornamenti concorrenti

Il popup ignora anche errori e completamenti di richieste GET_STATUS obsolete,
non soltanto le risposte riuscite. Un cambio di consenso può avviare una nuova
lettura mentre la precedente è ancora pendente: solo l'ultima lettura deve
aggiornare errore, pulsante Riprova e stato aria-busy.

Regressione sintetica: `node --test tests/popup-status.test.js` (5 casi).
Nessuna modifica a consenso, cancellazione, storage, permessi o CSP.

## Prossime priorità

1. Verificare race e revoca esterna nel popup reale di Chrome, con profilo temporaneo;
   la regressione Node controlla il DOM simulato, non il rendering o lo screen reader.
2. Valutare per una PR separata la copertura locale dei confini temporali,
   ledger corrotti e isolamento CHIPS: il checkpoint fe8e161 del 16 novembre
   ha runtime identico a main, quindi non è un fix runtime da reintegrare.
3. Verificare sospensione prolungata reale e piattaforme non Linux. I salti di
   clock sintetici non sostituiscono queste prove.

I vecchi candidati storage, ID, impronte, versioni package e tracking sono già
contenuti nel runtime consolidato. Non ripristinare i loro interi alberi: alcuni
precedono le protezioni del worker e le dichiarazioni GPL correnti.
