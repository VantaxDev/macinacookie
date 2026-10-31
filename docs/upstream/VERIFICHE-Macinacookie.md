# Macinacookie 1.1.0 — verifiche

Collaudo completato il 21 ottobre 2026 su Windows, con Firefox 158.0.1 in profili separati. Nessun cookie del profilo personale è stato usato.

**Esito: 55 test della logica, 20 verifiche di integrazione su Firefox desktop e 12 verifiche del percorso Android simulato superati.**

Il controllo ufficiale Mozilla con `web-ext` 10.8.0 riporta **0 errori, 0 avvisi e 0 segnalazioni**. Non equivale a una firma o all'approvazione per il catalogo.

## Verifiche in Firefox

- Installazione temporanea del componente, caricamento del pannello e del popup.
- Impostazioni iniziali: 30 giorni, automatismo disattivato.
- Rifiuto della soglia di 121 giorni; salvataggio della frequenza di 6 ore e di un sito escluso tramite il pannello.
- Lettura di sette cookie sintetici, inclusi un cookie partizionato e un cookie in un contenitore senza schede aperte.
- Cookie appena osservati esclusi dalla pulizia; date simulate per verificare quelli più vecchi senza attendere settimane.
- Conservazione della scadenza programmata dopo il riavvio dell'estensione.
- Anteprima, ricerca, selezione, conferma e annullamento nella schermata reale.
- Cancellazione del solo cookie selezionato; conservazione degli altri, dei recenti e dei protetti.
- Cancellazione mirata nei contenitori e nelle partizioni.
- Cookie modificato dopo l'anteprima saltato correttamente.
- Esecuzione della pulizia automatica dopo un riavvio con scadenza simulata già trascorsa.
- Nessun valore originale dei cookie nei dati persistenti o nella schermata.
- Controllo visivo del pannello a larghezza normale e ridotta.

## Test della logica

Coprono limiti e soglie, aggiornamento e ricreazione dei cookie, esclusioni, identità e partizioni, permessi mancanti, anteprime scadute, errori di lettura e salvataggio, risultati di cancellazione parziali, eventi concorrenti e ripristino della programmazione.

Gli 11 nuovi casi verificano anche Android senza accesso alle API dei contenitori, scansioni incomplete, recupero delle scadenze dopo una sospensione, esecuzioni simultanee, mancato riconoscimento della piattaforma e conservazione dei dati durante l'aggiornamento dalla versione precedente. L'assenza dell'API dei contenitori su computer continua a bloccare la pulizia: non viene scambiata per un dispositivo Android.

Il collaudo reale ha portato a correggere tre differenze rispetto alle ipotesi iniziali: individuazione dei contenitori senza schede aperte, formato della risposta di cancellazione e attributo `hasCrossSiteAncestor` delle partizioni. La suite include ora regressioni dedicate.

## Percorso Android e schermo piccolo

Queste verifiche usano Firefox desktop con una copia di prova dell'estensione che restituisce Android come piattaforma e genera un errore se viene richiesto l'accesso ai contenitori. La copia di prova non è inclusa nel pacchetto distribuito. Le operazioni sui cookie e l'interfaccia sono eseguite dal browser reale, ma **non si tratta di un dispositivo o emulatore Android**.

- Lettura e cancellazione senza chiamare l'API dei contenitori.
- Cookie partizionati riconosciuti e dominio escluso conservato.
- Avviso sulla sospensione del browser presente nel pannello e nel popup.
- Anteprima con i due cookie ammissibili su tre cookie sintetici.
- Larghezza misurata di 360 pixel CSS, senza scorrimento orizzontale dell'intera pagina; tabella scorrevole separatamente.
- Aree di tocco di almeno 44 pixel per selezione e cancellazione.
- Finestra di conferma contenuta nello schermo; annullamento senza cancellazioni.
- Eliminazione dei due cookie selezionati, incluso quello partizionato, conservando il cookie del sito escluso.
- Popup entro la larghezza dello schermo e apertura del pannello completo dal suo pulsante.

## Limiti della verifica

Il pacchetto non è firmato né pubblicato su Mozilla Add-ons. Non è stato eseguito un test di durata di 120 giorni: sono state simulate le date nei soli profili di prova. Il recupero di una scadenza è stato verificato riavviando l'estensione; l'avvio del browser e la ripresa dopo sospensione sono coperti anche dai test simulati.

Non è stato eseguito un collaudo su macOS, Linux o un telefono Android reale. Restano da verificare sul dispositivo l'installazione del pacchetto firmato, i permessi, l'apertura dal menu delle estensioni e il comportamento dopo sospensione o chiusura di Firefox. La simulazione non riproduce la gestione dei processi e il risparmio energetico di Android; non garantisce quindi l'esecuzione delle pulizie all'ora esatta.

Le immagini `Macinacookie-anteprima.png` e `Macinacookie-mobile.png` mostrano cookie e date **di prova**. La seconda è una schermata stretta di Firefox desktop con il percorso Android simulato.
