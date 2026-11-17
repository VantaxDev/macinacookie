# Priorità di sviluppo

## In revisione — popup e aggiornamenti concorrenti

Il popup ignora anche errori e completamenti di richieste GET_STATUS obsolete,
non soltanto le risposte riuscite. Un cambio di consenso può avviare una nuova
lettura mentre la precedente è ancora pendente: solo l'ultima lettura deve
aggiornare errore, pulsante Riprova e stato aria-busy.

Regressione sintetica: `node --test tests/popup-status.test.js` (5 casi).
Nessuna modifica a consenso, cancellazione, storage, permessi o CSP.

## Prossime priorità

1. Verificare questa race nel popup reale di Chrome, con profilo temporaneo;
   la regressione Node controlla il DOM simulato, non il rendering o lo screen reader.
2. Valutare per una PR separata la copertura locale dei confini temporali,
   ledger corrotti e isolamento CHIPS: il checkpoint fe8e161 del 16 novembre
   ha runtime identico a main, quindi non è un fix runtime da reintegrare.
3. Verificare sospensione prolungata reale e piattaforme non Linux. I salti di
   clock sintetici non sostituiscono queste prove.

I vecchi candidati storage, ID, impronte, versioni package e tracking sono già
contenuti nel runtime consolidato. Non ripristinare i loro interi alberi: alcuni
precedono le protezioni del worker e le dichiarazioni GPL correnti.
