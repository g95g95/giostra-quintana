# Giostra della Quintana — videogioco

Gioco 3D puro frontend sulla Quintana di Ascoli Piceno. Il giocatore è il cavaliere di un sestiere al Campo dei Giochi "Squarcia".

## Avvio

- Doppio clic su `index.html`. Nessun server, nessun build, nessuna rete.
- Online: https://g95g95.github.io/giostra-quintana/ (GitHub Pages, branch `main`, cartella radice; ogni push su `main` ripubblica).
- Test: `node --test tests/regole.test.js`.
- Screenshot headless: `bash tools/shot.sh "index.html?auto=1&ff=20" shots/x.png` (Edge headless con SwiftShader).
- Parametri di debug di `index.html`: `auto=1` pilota automatico per una tornata; `auto=3` tre tornate fino al finale; `ff=N` simula N secondi prima del primo frame; `live=1` continua dopo `ff`; `sestiere=id` salta il menu. Con `auto` o `ff` il `document.title` riporta stato, `s`, tempo e punti.
- Edge headless esegue `requestAnimationFrame` solo 1-2 volte: per avanzare serve `ff`.
- `touch=1` forza i comandi da telefono su desktop.
- Prova da telefono emulato (tocchi e sensore via CDP, Edge headless con GPU): `node tools/mobile_e2e.mjs "file:///<percorso>/index.html" <cartella screenshot> tilt` e poi `stick`.
- Anteprima dei moduli: `dev/preview.html?mods=world,figuranti,horse,moro&cam=x,y,z&look=x,y,z&t=2`.

## Architettura

Script classici caricati in ordine da `index.html`; namespace globale `Q`; Three.js r149 in `vendor/`.

| File | Contenuto |
|---|---|
| `js/data.js` | Sestieri e colori |
| `js/rules.js` | Punteggi: anelli, tempo, penalità (funzioni pure) |
| `js/track.js` | Geometria dell'otto, proiezione sulla pista, posizione del Moro |
| `js/layout.js` | Arena, tribune e posti, zone dei figuranti, palco, propilei |
| `js/world.js` | Stadio e paesaggio |
| `js/figuranti.js` | Corteo, sestieri, sbandieratori, pubblico |
| `js/horse.js`, `js/moro.js` | Cavallo con cavaliere e lancia; Moro con scudo |
| `js/audio.js` | Audio procedurale WebAudio |
| `js/game.js` | Stati di gioco, fisica, camera, HUD, avversari simulati |

Convenzioni: +X est, +Z sud, Y alto, metri. `yaw` = `rotation.y` con "avanti" locale +Z.

## Comandi

- Tastiera: W/S o ↑/↓ velocità, A/D o ←/→ sterzo, mouse o I/J/K/L mira, Esc/P pausa, M audio.
- Telefono (`TOUCH` in `js/game.js`, da media query `hover: none` e `pointer: coarse`): inclinazione = sterzo (`deviceorientation`, 2° di zona morta, 22° = sterzo pieno), pollice destro premuto = galoppo e trascinato = mira, pollice sinistro = freno.
- Senza sensore, o con "Sterzo: pollice" nel menu di pausa, il pollice sinistro fa da leva: orizzontale sterza, giù frena.
- Il sensore richiede HTTPS o `file://`; su iOS serve il permesso, chiesto al primo clic.
- Su telefono il gioco chiede schermo intero e blocco in orizzontale; in verticale mostra "Ruota il telefono".
- Grafica su telefono: "leggera" di default (`LITE` in `js/game.js`): pixel ratio 1, niente antialias, ombre 1024 solo da cavallo e Moro, pubblico low-poly, meno alberi. "Grafica: alta risoluzione" nel menu di pausa salva la scelta nel record e ricarica la pagina. `touch=1` attiva anche la grafica leggera.
- Qualità adattiva: se più di metà dei frame supera 20 ms scende a pixel ratio 1, poi senza ombre, poi pixel ratio 0,75.

## Regole di gioco (da tenere allineate al codice)

- 3 tornate, 3 assalti per tornata, percorso di 720 m (5 diagonali + 4 curve).
- Bersaglio: 100 / 80 / 60 / 40 / 20 punti, anelli da 6 cm.
- Tempo: 60,0 s = 200 punti, ±2 punti per decimo.
- Cordolo toccato: -30 punti. Uscita completa dalla corsia: tornata nulla.
- I tre assalti sulla stessa diagonale sono un'inferenza dalla lunghezza di 720 m, non un fatto confermato.

## Riferimenti

- `reference/`: foto da Wikimedia Commons (licenze CC BY / CC BY-SA), usate solo come riferimento visivo. Solo in locale: `reference/` e `shots/` sono in `.gitignore`.
- `tasks/todo.md`: piano e contratti dei moduli.
