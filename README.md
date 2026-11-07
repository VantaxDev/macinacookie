# Macinacookie — Chrome desktop

Estensione in italiano per osservare l'età dei cookie e cancellare quelli vecchi,
con anteprima, selezione, conferma, domini protetti e pulizia automatica opzionale.
Versione Chrome **1.2.0**, Manifest V3, Chrome desktop **130+** dichiarato.
Collaudata su **Chromium 156 / Linux**; Chrome Google, Windows e macOS non ancora collaudati.
Nessuna pubblicazione su Chrome Web Store è stata eseguita.

## Installazione locale

1. Scarica il pacchetto Chrome e scompattalo in una cartella stabile, oppure usa `extension/`.
2. Apri `chrome://extensions`, attiva **Modalità sviluppatore** e premi **Carica estensione non pacchettizzata**.
3. Scegli la cartella contenente `manifest.json`.
4. Apri il popup e premi **Apri Macinacookie**. La pulizia automatica è inizialmente **disattivata**.

Non caricare la cartella radice del repository. Il file ZIP non è un programma di installazione
né un pacchetto firmato: va prima estratto. Non disinstallare l'estensione per aggiornarla,
altrimenti si perde lo storico. La versione Chrome ha un archivio separato da Firefox:
non importa i cookie, le impostazioni o le età dal profilo Firefox.

## Uso e limiti

- Età osservata da **1 a 120 giorni**, predefinita 30; non è la data di creazione o l'ultima visita.
- I cookie presenti alla prima osservazione partono da zero giorni.
- Frequenza automatica da **1 a 2880 ore**, indipendente dall'età scelta.
- I domini esclusi proteggono anche i sottodomini.
- L'anteprima scade dopo 10 minuti e viene consumata una sola volta; modifiche alle regole la invalidano.
- La rimozione ricontrolla identità, valore tramite impronta, età, permessi e partizione.
- Cancellare cookie può disconnetterti dai siti. Non esiste annullamento o copia dei valori.
- Chrome deve poter eseguire l'estensione: chiusura, sospensione, timer e limiti del browser
  possono ritardare i controlli; una scadenza trascorsa viene recuperata alla ripresa.
- Supporto ai cookie partizionati CHIPS, inclusa la distinzione `hasCrossSiteAncestor`.
- Solo archivio ordinario Chrome (`0`); archivi privati/sconosciuti esclusi. Nessun supporto
  ai contenitori Firefox nella versione Chrome. Scansioni incomplete bloccano la pulizia.
- Le API non offrono una cancellazione atomica con le scritture dei siti: resta una piccola
  finestra di concorrenza tra l'ultimo controllo e la rimozione.

## Privacy e permessi

Funzionamento locale, senza account, telemetria, server o dipendenze di produzione.
Nessuno script nelle pagine, nessuna cronologia, nessuna richiesta di rete dell'estensione.
La CSP impedisce connessioni in uscita dalle pagine e dal service worker.

| Permesso | Motivazione |
| --- | --- |
| `cookies` | Leggere e rimuovere i cookie |
| `storage` | Impostazioni, date, impronte e anteprime temporanee |
| `alarms` | Pianificare i controlli e recuperarli alla ripresa |
| HTTP/HTTPS su tutti i siti | Gestione globale dei cookie; limitare l'accesso ai siti può sospendere la scansione |

I valori dei cookie vengono letti solo in memoria per generare impronte SHA-256; non sono
mostrati né persistiti. I dati locali contengono domini, nomi, percorsi, contesti, date e impronte:
sono comunque dati di navigazione sensibili. Le anteprime sono in `storage.session`.
Nessun accesso alla navigazione in incognito è consentito dal manifest.

## Sviluppo e verifiche

Nessun `npm install` richiesto. Strumenti: Node.js 18+, Python 3, Chromium e ChromeDriver
compatibili per il collaudo reale. Tutti i profili e cookie di prova sono temporanei.

```sh
node --test tests/logic.test.js
python3 tests/chromium.py
python3 scripts/build.py
```

Lo ZIP riproducibile viene scritto in `dist/` (escluso dal Git), senza test, documenti,
archivi originali, file locali o sorgenti Firefox. La build usa un elenco esplicito di file.

- `extension/`: versione Chrome con service worker, logica pura, popup e pannello.
- `upstream/firefox/`: sorgenti Firefox 1.1.0 conservati senza modifiche.
- `docs/upstream/`: documentazione originaria; i risultati riportati sono dichiarazioni
  del pacchetto ricevuto, non collaudi ripetuti durante questo porting.
- `docs/AUDIT.md`: provenienza, revisione e risultati attuali.
- `docs/HANDOFF.md`: decisioni e passaggi di distribuzione ancora aperti.

## Sostieni il progetto

Macinacookie ti è utile? Le [donazioni](https://paypal.me/vantax) sono benvenute
e aiutano a sostenere lo sviluppo del progetto.

## Licenza

Il pacchetto ricevuto non contiene una licenza esplicita. Non è stata scelta o attribuita
una licenza al posto del titolare. Prima di dichiarare il progetto open source, il titolare
può scegliere una licenza; in sua assenza non viene concessa una licenza di riutilizzo.
