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

## Attivazione dell'osservazione

L'osservazione è inizialmente **inattiva**, anche per profili esistenti senza
un opt-in corrente valido. Apri il pannello, leggi i dati trattati e scegli
**Attiva osservazione cookie** oppure **Rimani inattivo**. Prima della scelta
si legge solo la chiave minima del gate, non ledger o cookie. Puoi disattivare
l'osservazione dal pannello senza cancellare cookie o storico. Le chiamate già
inviate a Chrome non sono annullabili; i risultati tardivi vengono ignorati.
L'attivazione non autorizza l'automatico, che richiede una scelta separata nelle
regole; nessun consenso reale è stato acquisito durante i test sintetici.

## Uso e limiti

- Età osservata da **1 a 120 giorni**, predefinita 30; non è la data di creazione o l'ultima visita.
- I cookie presenti alla prima osservazione partono da zero giorni.
- Frequenza automatica da **1 a 2880 ore**, indipendente dall'età scelta.
- I domini esclusi proteggono anche i sottodomini.
- L'anteprima scade dopo 10 minuti e viene consumata una sola volta; modifiche alle regole, disattivazione o riavvio del service worker la invalidano.
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
Se lo stato persistito è corrotto, la pulizia viene sospesa senza azzerare
automaticamente impostazioni e storico; solo una chiave assente avvia un nuovo archivio.
Nessun accesso alla navigazione in incognito è consentito dal manifest.

## Sviluppo e verifiche

Le verifiche riproducibili sono descritte in [TESTING.md](docs/TESTING.md).
I risultati dipendono dalla piattaforma e non equivalgono a una certificazione Store.

Nessun `npm install` richiesto. Strumenti: Node.js 18+, Python 3, Chromium e ChromeDriver
compatibili per il collaudo reale. Tutti i profili e cookie di prova sono temporanei.

```sh
node --test tests/logic.test.js tests/consent.test.js
python3 tests/chromium.py
python3 -m unittest discover -s tests -p build_test.py -v
python3 scripts/build.py
```

Lo ZIP riproducibile viene scritto in `dist/` (escluso dal Git), senza test, documenti,
archivi originali, file locali o sorgenti Firefox. La build usa un elenco esplicito di file e rifiuta versioni manifest non valide
prima di scrivere il pacchetto.

- `extension/`: versione Chrome con service worker, logica pura, popup e pannello.
- `upstream/firefox/`: sorgenti Firefox 1.1.0 conservati senza modifiche.
- `docs/upstream/`: documentazione originaria; i risultati riportati sono dichiarazioni
  del pacchetto ricevuto, non collaudi ripetuti durante questo porting.
- `docs/AUDIT.md`: provenienza, revisione e risultati attuali.
- `docs/HANDOFF.md`: decisioni e passaggi di distribuzione ancora aperti.

Gli ID dello storico vengono verificati rispetto alla chiave cookie al caricamento:
uno stato incoerente sospende la pulizia senza riscrivere i dati locali.
Anche le impronte devono essere stringhe SHA-256: gli array non vengono convertiti
implicitamente né usati per riscrivere lo storico.

## Sostieni il progetto

Macinacookie ti è utile? Le [donazioni](https://paypal.me/vantax) sono benvenute
e aiutano a sostenere lo sviluppo del progetto.

## Licenza

SPDX-License-Identifier: **GPL-3.0-only**.

Macinacookie è distribuito sotto **GNU General Public License, versione 3 soltanto**.
Il testo integrale è in [LICENSE](LICENSE); lo ZIP include sia il testo sia la
[dichiarazione di licenza](extension/LICENSING.md). Il programma è fornito senza
garanzia, secondo la licenza.

Mantieni gli avvisi applicabili di copyright, attribuzione e licenza nelle copie
e nei derivati, secondo GPLv3. Questa scelta non aggiunge una clausola di credito
permanente nell'interfaccia, non implica approvazione dei fork da parte degli
autori e non revoca eventuali precedenti concessioni o licenze di terzi.

Repository e manutenzione: [VantaxDev](https://github.com/VantaxDev). I sorgenti
Firefox originali e i loro avvisi sono conservati in `upstream/firefox/`; nessuna
attribuzione originale è stata rimossa o sostituita.
