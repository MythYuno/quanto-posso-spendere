# Quanto posso spendere

Webapp minimale per i risparmi. Fa tre cose:

1. inserisci lo **stipendio** e quando arriva il prossimo,
2. ti dice **quanto puoi spendere oggi** per arrivare in fondo,
3. segni le **spese** che fai.

Niente categorie, niente banca collegata, niente account. Un numero grande e un grafico.

## Come è fatta

Una sola schermata, mai scorrimento verticale di pagina. Le viste sono quattro schede affiancate
che si scorrono in orizzontale (swipe sul telefono, frecce ← → o click sulle linguette altrove):

| Scheda | Cosa c'è |
| --- | --- |
| **Oggi** | il numero del giorno, quello che hai già segnato oggi, e il campo per aggiungere una spesa |
| **Previsione** | il grafico, lo stato rispetto al ritmo, e i numeri del periodo |
| **Spese** | l'elenco di quello che hai segnato, raggruppato per giorno |
| **Risparmi** | quanto hai messo da parte in ogni periodo chiuso |

Per segnare una spesa servono l'importo e che cos'è; il giorno è già impostato su oggi e si cambia
solo se serve. Il tema (auto, chiaro, scuro) si sceglie dalle impostazioni, l'ingranaggio in alto a destra.

## Come calcola il numero

```
budget = stipendio − spese fisse − obiettivo di risparmio
quota di oggi = (budget − spese fino a ieri) ÷ giorni rimasti, oggi incluso
ti restano oggi = quota di oggi − spese di oggi
```

La quota è arrotondata per difetto ai centesimi. Quando la esaurisci, il numero si ferma a zero.
Con 400 € per 10 giorni parti da 40 €. Se oggi spendi 40 €, ti restano 0 € per oggi e 40 € al
giorno da domani. La quota indicata per domani presuppone che oggi tu smetta di spendere.
Puoi registrare spese da inizio periodo fino a oggi. Eventuali spese future dei vecchi backup
entrano nei calcoli alla loro data.

Il "ritmo ideale" è il budget che scende in linea retta fino a zero il giorno dello stipendio.
La pastiglia sotto il numero dice se sei **sotto** o **sopra** quel ritmo, e di quanto.

Il grafico mostra tre cose:

- **andamento reale** — i soldi rimasti giorno per giorno,
- **previsione** — dove finisci se continui con la media di spesa attuale,
- **ritmo ideale** — il riferimento.

Se la previsione tocca lo zero prima dello stipendio, il grafico segna il giorno in cui resti a secco.

## Il risparmio

L’obiettivo di risparmio riduce la quota spendibile. Alla chiusura il saldo effettivo è
**stipendio meno spese fisse meno spese registrate**. Anche un disavanzo compare nello storico
e riduce il totale. La data di chiusura è il primo giorno del nuovo periodo. Tutte le spese di
quel giorno appartengono al nuovo periodo, anche se le hai segnate prima della chiusura.

## Dove stanno i dati

Solo nel browser del dispositivo che usi, in `localStorage`. Non c'è server, non c'è account,
niente esce da lì. Conseguenze da sapere:

- i dati **non si sincronizzano** tra telefono e computer,
- se cancelli i dati del sito, spariscono,
- la navigazione privata non li conserva.

Per spostarli c'è `Impostazioni → Backup`: **Esporta** scarica un file `.json`, **Importa** lo rilegge
su un altro dispositivo. Il file viene verificato prima di chiederti conferma della sostituzione.

## Installarla sul telefono

È una PWA e funziona anche offline.

- **iPhone (Safari)**: Condividi → *Aggiungi a Home*.
- **Android (Chrome)**: menu ⋮ → *Installa app*.

## Sviluppo

Nessuna dipendenza, nessun build step. Sono file statici: apri `index.html` da un server locale.

```bash
python3 -m http.server 8765
```

Poi vai su `http://127.0.0.1:8765/`.

| File | Cosa contiene |
| --- | --- |
| `index.html` | struttura della pagina |
| `styles.css` | design tokens, tema chiaro/scuro, vetro |
| `app.js` | calcolo, grafico SVG, storage |
| `sw.js` | service worker per l'uso offline |
| `manifest.webmanifest` | dati per l'installazione |

Il grafico è SVG scritto a mano: il `viewBox` segue la larghezza reale del contenitore, così le
etichette restano della stessa dimensione sul telefono e sul desktop.

## Test

Per le prove di regressione in Chromium:

```bash
python -m pip install playwright
python -m playwright install chromium
python tests/test_browser.py -v
```

Puoi indicare un Chromium già installato con la variabile `CHROMIUM_PATH`.

## Licenza

MIT — vedi [LICENSE](LICENSE).
