# Macinacookie 1.1

Estensione in italiano per Firefox 142 o successivo, su computer e Android. Scegli quanto a lungo conservare i cookie osservati, controlla l'anteprima e attiva la pulizia periodica quando vuoi.

La versione 1.1 aggiunge il percorso compatibile con Android, i comandi adatti al tocco e il recupero delle pulizie scadute quando Firefox riprende l'attività. Il pacchetto è unico per entrambe le piattaforme. Il supporto Android è stato verificato con test simulati e un'interfaccia larga 360 pixel su Firefox desktop; manca ancora il collaudo su un dispositivo Android reale.

## Provala subito su computer

1. In Firefox apri `about:debugging#/runtime/this-firefox`.
2. Premi **Carica componente aggiuntivo temporaneo…**.
3. Seleziona **macinacookie-1.1.0.zip**, oppure il file `manifest.json` nella cartella `macinacookie`.
4. Apri Macinacookie dal menu delle estensioni nella barra di Firefox e premi il pulsante per aprire il pannello. Se richiesto, consenti l'accesso ai siti per gestire i cookie.

L'installazione temporanea termina al riavvio di Firefox: serve per provare l'estensione. Per una vera pulizia automatica nel tempo usa una copia firmata da Mozilla.

## Installazione permanente

Il pacchetto consegnato **non è firmato**. Firefox standard richiede la firma Mozilla per l'installazione permanente. Per distribuirlo anche agli utenti Android, pubblicalo nel catalogo Mozilla Add-ons:

1. Accedi al [Developer Hub di Mozilla](https://addons.mozilla.org/developers/).
2. Se hai già inviato Macinacookie, aggiungi una **nuova versione alla stessa estensione**. In caso contrario, avvia una nuova pubblicazione nel catalogo pubblico.
3. Carica `macinacookie-1.1.0.zip`. Il pacchetto contiene direttamente i sorgenti leggibili; non serve una compilazione. Dichiara la compatibilità con Firefox desktop e Firefox per Android a partire dalla versione 142.
4. Completa le informazioni richieste da Mozilla e attendi l'approvazione e la disponibilità della versione nel catalogo.
5. Su Android apri la scheda di Macinacookie su Mozilla Add-ons con Firefox e installala. Poi aprila dal menu delle estensioni di Firefox e premi **Apri Macinacookie** per accedere al pannello completo.

L'identificativo dell'estensione è rimasto lo stesso della versione 1.0.0: un normale aggiornamento conserva impostazioni e date già osservate. Non disinstallarla prima di aggiornarla.

Per la distribuzione privata è disponibile anche la firma **per conto proprio / On your own**. Su computer, il file `.xpi` firmato si installa da `about:addons`, menu a ingranaggio → **Installa componente aggiuntivo da file…**. Lo ZIP consegnato non si installa direttamente nella versione standard di Firefox per Android.

Nessun account Mozilla è stato usato e nessuna estensione è stata pubblicata durante la preparazione di questi file.

## Come si usa

- **Età:** da 1 a 120 giorni. La soglia predefinita è 30 giorni.
- **Anteprima manuale:** mostra i cookie candidati con dominio, nome, percorso, età osservata e contesto. Cerca un sito e seleziona i cookie da eliminare. La conferma finale indica quanti ne hai selezionati. I valori dei cookie non vengono mostrati.
- **Pulizia automatica:** inizialmente disattivata. Puoi programmare l'intervallo da 1 ora a 120 giorni. Età dei cookie e frequenza di pulizia sono due impostazioni indipendenti.
- **Siti esclusi:** inserisci i domini da conservare, uno per riga, per esempio `example.com`. L'esclusione comprende anche i sottodomini e vale sia per la pulizia manuale sia per quella automatica.
- **Riepilogo:** indica i cookie osservati, quelli candidati, le esclusioni e l'esito dell'ultima pulizia.

Eliminare cookie può disconnetterti dai siti e azzerarne le preferenze. Per conservare un accesso, aggiungi prima il dominio alle esclusioni. La cancellazione non può essere annullata; non viene creata una copia dei valori dei cookie.

## Cosa significa «vecchio»

Firefox non espone la data di creazione dei cookie alle estensioni. Macinacookie registra quindi la **prima osservazione** di ciascun cookie. Quelli già presenti al primo avvio partono da zero giorni: non vengono trattati come vecchi senza una data attendibile. La scadenza di un cookie è una cosa diversa e non viene usata per stimarne l'età.

Gli aggiornamenti dello stesso cookie non azzerano l'età osservata. Una rimozione rilevata seguita da una nuova creazione ricomincia da zero. Se l'estensione è disattivata, non può ricostruire cambiamenti avvenuti in sua assenza. Disinstallare l'estensione o cancellarne i dati fa perdere lo storico delle osservazioni.

All'inizio è quindi normale non trovare cookie da eliminare. Con soglia di 1 giorno, occorre attendere almeno un giorno di osservazione.

## Programmazione e controlli

La pulizia funziona quando Firefox consente all'estensione di essere eseguita. Se Firefox è chiuso o il dispositivo sospeso, una scadenza trascorsa viene recuperata alla successiva esecuzione utile. Il programma conserva l'orario previsto e ripristina la pianificazione all'avvio; i timer del browser possono subire ritardi.

**Su Android il sistema può sospendere Firefox in background.** Non è garantita una pulizia all'ora esatta con il telefono inattivo o il browser chiuso. Le scadenze vengono ricontrollate anche quando apri Macinacookie o arriva un evento relativo ai cookie: la pulizia automatica scaduta riparte quando l'estensione può lavorare di nuovo.

L'anteprima manuale scade dopo 10 minuti. Prima di eliminare un cookie il programma ricontrolla che sia ancora ammissibile e invariato rispetto all'anteprima. I cookie nuovi, modificati o esclusi nel frattempo vengono saltati. La modifica delle impostazioni richiede una nuova anteprima.

Su computer sono gestiti i contenitori accessibili; su Android la scansione non dipende dalle API dei contenitori, che non sono disponibili. Su entrambe le piattaforme vengono gestiti i cookie partizionati, senza mescolare i diversi contesti. La navigazione privata è esclusa. La copertura dipende dai permessi concessi e dai limiti di Firefox. In caso di scansione incompleta o di identità non univoca, la cancellazione si ferma o salta il cookie. Le API di Firefox non consentono una cancellazione atomica rispetto a una scrittura del sito nello stesso istante: il ricontrollo riduce questa finestra, senza poterla eliminare.

## Dati e permessi

L'estensione funziona in locale, senza server, telemetria, servizi esterni o codice scaricato dalla rete. Non legge la cronologia e non esegue script nelle pagine web.

L'accesso ai siti HTTP/HTTPS permette di leggere e rimuovere i rispettivi cookie. Il permesso `cookies` serve alla gestione dei cookie, `storage` conserva impostazioni e date, `alarms` programma i controlli e `contextualIdentities` permette di includere i contenitori anche quando non hanno schede aperte.

Su computer Firefox abilita la funzione Contenitori quando un'estensione richiede questo permesso. Macinacookie ne legge l'elenco, senza creare o modificare contenitori. Se disabiliti manualmente questa funzione nelle impostazioni avanzate di Firefox desktop, la scansione si interrompe per evitare una pulizia incompleta. Su Android il permesso `contextualIdentities` è ignorato da Firefox e Macinacookie non accede alla relativa API.

Il registro locale conserva gli identificatori dei cookie, le date e impronte SHA-256 utili a riconoscere i cambiamenti. **Non conserva i valori originali dei cookie.** Domini e nomi restano informazioni di navigazione: non vengono trasmessi. Le anteprime sono temporanee e il riepilogo dell'ultima pulizia contiene solo conteggi.

## File inclusi

- `macinacookie-1.1.0.zip`: pacchetto unico desktop/Android da inviare a Mozilla per la firma e la pubblicazione, o da provare temporaneamente su computer.
- `macinacookie/`: sorgenti completi dell'estensione, utilizzabili senza compilazione.
- `LEGGIMI-Macinacookie.md`: questa guida.
- `Macinacookie-anteprima.png`: schermata del pannello con dati di prova.
- `Macinacookie-mobile.png`: schermata a 360 pixel con dati di prova, ottenuta su Firefox desktop simulando il percorso Android.
- `VERIFICHE-Macinacookie.md`: esiti e limiti del collaudo (55 test della logica, 20 verifiche desktop e 12 verifiche del percorso Android simulato).

## Riferimenti ufficiali

- [Dati dei cookie disponibili alle estensioni](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/Cookie)
- [Installazione temporanea](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
- [Firma e distribuzione](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Timer delle estensioni](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms)
- [Sviluppo per Firefox Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)
- [Compatibilità e dichiarazione Android](https://extensionworkshop.com/documentation/publish/version-compatibility/)
- [Firefox 138: indisponibilità delle API dei contenitori su Android](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/138)
