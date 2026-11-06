# Macinacookie

Estensione in italiano per tenere sotto controllo l'età osservata dei cookie,
con anteprima, siti protetti e pulizia automatica opzionale.

## Sorgenti Firefox 1.1.0

- `upstream/firefox/`: sorgenti originali conservati senza modifiche.
- [Guida Firefox](docs/upstream/LEGGIMI-Macinacookie.md).
- [Verifiche dichiarate nel pacchetto originale](docs/upstream/VERIFICHE-Macinacookie.md).

L'età parte dalla prima osservazione, non dall'ultima visita. La rimozione dei
cookie può disconnetterti dai siti; controlla sempre l'anteprima e le esclusioni.

## Versione Chrome

Il porting Chrome MV3 è nel branch [`feat/chrome-mv3`](https://github.com/VantaxDev/macinacookie/tree/feat/chrome-mv3),
in revisione separata da questi sorgenti Firefox. Quel branch contiene istruzioni
di installazione locale, test, audit e script di creazione del pacchetto.
Non è una pubblicazione su Chrome Web Store.

## Sostieni il progetto

Macinacookie ti è utile? Le [donazioni](https://paypal.me/vantax) sono benvenute
e aiutano a sostenere lo sviluppo del progetto.

## Licenza e crediti

Copyright **Daniele Vantaggiato**.

SPDX-License-Identifier: **GPL-3.0-only**. Questa revisione del repository è
distribuita sotto GNU General Public License, versione 3 soltanto. Il testo
integrale è in [LICENSE](LICENSE); i sorgenti Firefox includono il testo e la
[dichiarazione di licenza](upstream/firefox/LICENSING.md). Il programma è fornito
senza garanzia, secondo la licenza.

Gli avvisi applicabili di copyright, attribuzione e licenza vanno conservati
secondo GPLv3. Non viene aggiunto un obbligo personalizzato di branding permanente
nell'interfaccia. Questa dichiarazione non revoca eventuali concessioni precedenti
é sostituisce licenze o diritti di terzi. I file originali Firefox restano
conservati senza modifiche; il credito e i documenti di licenza sono aggiunti
accanto ad essi, senza attribuire retroattivamente una licenza al vecchio archivio.

Il porting Chrome e il suo pacchetto sono gestiti nel ramo separato indicato
sopra; questo aggiornamento non ne pubblica modifiche runtime.
