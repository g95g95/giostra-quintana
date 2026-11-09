# Giostra della Quintana di Ascoli Piceno — videogioco frontend

Gioco 3D puro frontend (Three.js r149 locale, nessun build, nessun server).
Il giocatore è il cavaliere di un sestiere e corre le tre tornate al Campo dei Giochi "Squarcia".

## Fatti dalla ricerca (fonte: it.wikipedia "Quintana di Ascoli Piceno", foto Wikimedia Commons in `reference/`)

- Sei sestieri, un cavaliere ciascuno. Tre tornate a testa, tre assalti al Moro per tornata.
- Percorso a otto di 720 m: due diagonali del campo raccordate da due curve. Fondo in sabbia, cordoli ai bordi, quattro "gocce" d'erba.
- Bersaglio sullo scudo del Moro: 100 / 80 / 60 / 40 / 20 punti dal centro verso l'esterno.
- Tempo base 60,0 s = 200 punti; ogni decimo in meno o in più vale +2 o -2 punti. Record 48,6 s.
- Penalità: cordolo spostato o 2 zoccoli fuori = -30 punti; 4 zoccoli fuori o lancia persa = tornata nulla.
- Corteo: Magnifico Messere, anziani, Capitano del Popolo, Mossiere, dame, paggi, armigeri, tamburini, chiarine, sbandieratori, consoli. Costumi del XV secolo.
- Inferenza (non confermata da fonte): i tre assalti avvengono sempre sulla stessa diagonale, con un otto completo tra un assalto e l'altro. Con questa ipotesi il percorso misura 5 diagonali + 4 curve = 720 m.

## Contratto comune (vale per ogni task)

- Script classici, niente `import`, niente rete: il gioco parte con doppio clic su `index.html` (file://).
- Namespace globale `window.Q`. `THREE` globale è la r149 (`vendor/three.min.js`): niente `BufferGeometryUtils`, niente `colorSpace` (si usa `outputEncoding`).
- Assi: +X est, +Z sud, Y alto. Unità: metri. `yaw` = `rotation.y` di un oggetto il cui "avanti" locale è +Z.
- File già pronti e in sola lettura: `js/data.js` (`Q.SESTIERI`, `Q.COMUNE`, `Q.sestiere(id)`), `js/rules.js` (`Q.RULES`), `js/track.js` (`Q.track`), `js/layout.js` (`Q.LAYOUT`), `dev/preview.html`, `tools/shot.sh`. Leggili prima di scrivere. Se serve una modifica, riportala: non modificarli.
- Stile visivo: low-poly stilizzato, colori pieni, `MeshLambertMaterial`, nessun asset esterno (ammesse `CanvasTexture` procedurali).
- Prestazioni: il gioco completo deve restare sotto 400 draw call. Usa `InstancedMesh` per gli oggetti ripetuti.
- Commenti solo dove il codice è complesso. Ogni task tocca solo i propri file.
- Verifica visiva obbligatoria: `bash tools/shot.sh "dev/preview.html?mods=...&cam=x,y,z&look=x,y,z&t=2" shots/nome.png`, poi apri il PNG con Read. Testo rosso in alto a sinistra = errore JS. Lo screenshot ha bordi neri a destra e in basso: è normale. Itera finché l'immagine è convincente da più angoli.
- Foto di riferimento: `reference/ref_01.jpg` (campo, propilei, tribune, Moro), `ref_02.jpg` (pista a otto e cordoli), `ref_03.jpg` e `ref_04.jpg` (cavaliere, lancia, pubblico, staccionata), `ref_06.jpg`, `ref_08.jpg`, `ref_13.jpg`, `ref_05.jpg` (figuranti).

## Task

### T1 — `js/world.js` (difficoltà 6)

`Q.World.build(scene, renderer)` → `{ update(dt, t), sun }`.

- Cielo estivo di tardo pomeriggio (cupola a gradiente), nebbia leggera, `HemisphereLight` + sole `DirectionalLight` con ombre (mappa 2048, frustum ±25 m; il gioco sposta `sun.target` e `sun.position` per seguire il cavallo: esponi `sun` e l'offset `sun.userData.offset`).
- Suolo: erba in tutta l'arena (`Q.LAYOUT.arena`, forma a stadio); pista di sabbia a nastro lungo `Q.track.posAt(s)` per un giro (`Q.track.lap`), larga `2 * halfWidth`; anello di sabbia largo 5 m lungo il bordo dell'arena. Il terreno riceve ombre.
- Cordoli: blocchi a cuneo ogni 2 m sui due bordi (lunghi 1,2 m, alti 0,25 m), verdi (ref_02, ref_03), bianchi e rossi alternati entro 30 m dall'incrocio `Q.track.P` (ref_01). Un `InstancedMesh`. Metti il blocco solo se `Q.track.hasCordolo(s, side)` è vero.
- Linea bianca di partenza a `s = 0` e di arrivo a `s = Q.track.T`.
- Staccionata di legno a croce (ref_03) lungo il perimetro dell'arena.
- Tribune da `Q.LAYOUT.stands`: gradoni la cui faccia superiore della fila `row` è a `y = baseY + row * rowHeight`, distanza dal campo `x0 + row * rowDepth` (o `r0 + ...` per le curve), coerenti con `Q.LAYOUT.seats`. Tribuna ovest con tettoia a sbalzo in cemento. Ringhiere davanti.
- Propilei a `Q.LAYOUT.propilei`: due piloni bianchi alti circa 9 m, ciascuno con nicchia ad arco riempita metà gialla e metà rossa (ref_01), architrave basso tra i due, stendardi.
- Struttura del palco a `Q.LAYOUT.palco`: pedana di legno alta `h`, drappi rossi e gialli, baldacchino su 4 pali, scaletta. Il piano di calpestio deve essere libero (ci salgono i figuranti).
- Pennoni con stendardi verticali animati nei colori dei sestieri e del Comune dietro le tribune (12-18).
- 4 torri faro.
- Fuori dall'arena: Forte Malatesta (massiccia fortezza poligonale in pietra, ref_02 a sinistra) a `Q.LAYOUT.forteMalatesta`; chiesa romanica di San Vittore a `Q.LAYOUT.sanVittore`; circa 60 case con tetti in coppi e intonaci pastello (instanced); cipressi e alberi tondi (instanced); colline verdi tutto intorno, più alte a nord e a est (ref_01, ref_02).
- `update`: anima stendardi.
- Verifica con `mods=world` da almeno 4 punti di vista (alto, da sud a livello tribuna, a livello cavallo sulla diagonale A verso il Moro, dai propilei).

### T2 — `js/figuranti.js` (difficoltà 7)

`Q.Figuranti.build(scene, { playerSestiereId })` → `{ update(dt, t), react(kind) }`.

Personaggi low-poly da primitive, costumi del Quattrocento (vedi foto). Budget: massimo 150 draw call, `update` sotto 1,5 ms. Usa `InstancedMesh` per parti comuni (con `instanceColor`) e mesh singole solo per ciò che si anima (bandiere, bacchette).

1. Sei blocchi dei sestieri in `Q.LAYOUT.blocchi` (28-36 figure per blocco, in ranghi, rivolte a `yaw`): gonfaloniere con stendardo bipartito `c1`/`c2`, console con mantello, 2 dame (abito lungo, copricapo con velo), paggi, 6 tamburini (bacchette animate), 4 chiarine (tromba lunga con drappella), 6-8 armigeri (armatura scura, alabarda), 4 sbandieratori con bandiera animata.
2. Gruppo comunale: sul palco (`Q.LAYOUT.palco`, piano a `y = h`) Magnifico Messere (veste rossa, collo d'ermellino), 4 anziani, 2 dame, 2 valletti con il Palio (drappo dipinto su asta); a terra ai lati 6 armigeri in rosso e giallo; in `Q.LAYOUT.musici` 6 tamburini e 4 chiarine del Comune (tuniche bipartite rosse e gialle, berretto rosso, ref_08).
3. Esibizione sbandieratori in `Q.LAYOUT.sbandieratori`: 12 in cerchio, 2 per sestiere, bandiere animate con lanci.
4. Mossiere in `Q.LAYOUT.mossiere`, 3 giudici con tavolo in `Q.LAYOUT.giudici`, 2 valletti vicino al Moro (fuori pista: `Q.track.distToTrack(x, z) > 5`).
5. Armigeri di guardia ogni 12 m circa lungo il perimetro interno (`Q.LAYOUT.insideArena(x, z, 3)`), con picca e pennoncello.
6. Pubblico sulle tribune da `Q.LAYOUT.seats(stand, 0.7)`: tribune `chi: 'pubblico'` con pubblico estivo moderno (ref_04), riempimento circa 75%; tribuna `chi: 'figuranti'` (curva sud) con figuranti in sei spicchi nei colori dei sestieri (ref_03). Solo `InstancedMesh`. Per l'esultanza: dividi il pubblico in 4 mesh alternate e falle oscillare in verticale con fasi diverse.

`react(kind)`: `'via'`, `'centro'` (100 punti: grande esultanza), `'colpo'`, `'mancato'`, `'penalita'`, `'arrivo'`. Il blocco del sestiere del giocatore reagisce di più. Nessuna figura a meno di 5 m dall'asse pista.

Verifica con `mods=world,figuranti` (se `js/world.js` non esiste ancora la preview usa un prato di ripiego) da almeno 5 punti di vista, compresi primi piani a 6-8 m da un blocco e dal palco.

### T3 — `js/horse.js` e `js/moro.js` (difficoltà 6)

`Q.Horse.create({ c1, c2 })` → `{ group, update(dt, state), stride }`.

- `group`: origine a terra sotto il centro del cavallo, avanti = +Z, destra del cavaliere = -X. Tutte le mesh con `castShadow`.
- Cavallo baio (ref_03, ref_04): altezza al garrese circa 1,65 m, criniera e coda nere, fasce bianche agli stinchi, sottosella nei colori `c1`/`c2`.
- Cavaliere: camicia bianca, gilet nero bordato `c1`/`c2`, casco nero, stivali neri. Lancia lunga 3 m a spirale `c1`/`c2` (ref_04), impugnata con la mano destra vicino a `(-0.35, 1.75, 0.15)`.
- `state = { speed (m/s), steer (-1..1), tip: THREE.Vector3 | null }`. Con `tip` (coordinate locali del group) la punta visibile della lancia deve coincidere esattamente con `tip` e la lancia passa per la mano. Con `tip = null` la lancia è a riposo, portata in alto in diagonale (ref_03). Transizione morbida tra i due stati.
- Animazione: galoppo con 4 zampe a due segmenti, fase += `speed / 3.2` giri al secondo; beccheggio e sobbalzo del corpo, testa, criniera, coda; cavaliere proteso in avanti in velocità; inclinazione in curva da `steer`; fermo con respiro lento sotto 0,3 m/s; ampiezza ridotta a bassa velocità. `stride` = contatore reale delle falcate (per sincronizzare l'audio).

`Q.Moro.create()` → `{ group, update(dt), hit(points) }`.

- Il modulo posiziona `group` in `Q.track.moro` (`x`, `z`, `yaw`). Palo di legno su base pesante; busto di legno scuro con turbante; braccio sinistro teso con scudo tondo; braccio destro con mazzafrusto (catena e palla).
- Il centro dello scudo deve coincidere in coordinate mondo con `Q.track.moro.shield` (`x`, `y`, `z`). La faccia dello scudo è perpendicolare alla diagonale A (`Q.track.uA`) e guarda il cavaliere in arrivo. Bersaglio a 5 anelli concentrici larghi `Q.RULES.RING_STEP`, ben leggibili (`CanvasTexture`).
- `hit(points > 0)`: il busto ruota sul palo (1-2 giri, smorzato, di nuovo in posizione entro 2,5 s). `hit(0)`: nessuna rotazione.

Verifica con `mods=moro,horse` (parametri `hs`, `speed`, `lance=0`, `t`): profilo, tre quarti, vista dal cavaliere verso lo scudo; controlla più fasi del galoppo con `t` diversi.

### T4 — `js/audio.js` (difficoltà 5)

`Q.Audio`, solo WebAudio procedurale, nessun file audio.

- `init()` (idempotente, da chiamare al primo gesto dell'utente), `setMaster(0..1)`, `suspend()`, `resume()`.
- `gallop(speed)`: da chiamare a ogni frame; ritmo a 4 tempi del galoppo, cadenza proporzionale alla velocità (falcata 3,2 m), tonfi su sabbia; `0` = silenzio.
- `crowd(level 0..1)`: brusio continuo; `cheer(intensity 0..1)`: boato che sale e scende; `ooh()`: delusione.
- `hit(points)`: colpo di legno; campanello brillante per 100. `penalty()`: tonfo sordo.
- `tamburi(on)`: cadenza di tamburi medievali in loop; `rullo(durata)`: rullo crescente; `fanfara()`: squillo di chiarine (trombe naturali, arpeggio di triade).
- Tutte le funzioni sono sicure prima di `init()` (non fanno nulla) e senza `AudioContext`.
- Verifica: pagina `dev/audio-test.html` che chiama ogni funzione dopo `init()` e scrive in pagina `OK` o l'errore; eseguila con Edge headless (`--dump-dom`) e controlla l'esito. Aggiungi anche pulsanti per l'ascolto manuale.

### T5 — `index.html`, `css/style.css`, `js/game.js` (difficoltà 7)

Dipende dai contratti di T1-T4 (i moduli sono scritti in parallelo: programma sul contratto; prima di chiudere verifica con i file reali se esistono e riporta quali mancavano).

Ordine script: three, data, rules, track, layout, world, figuranti, horse, moro, audio, game.

Stati:
1. `menu`: titolo "Giostra della Quintana — Ascoli Piceno", camera in orbita lenta sullo stadio, scelta del sestiere (6 carte con i colori), "Come si gioca", pulsante "Scendi in campo".
2. `intro`: volo di camera breve (propilei → figuranti → palco → cavaliere), fanfara e tamburi, saltabile.
3. `pronto`: cavallo fermo a `Q.track.startS`. Il cronometro parte quando il cavallo passa `s = 0`.
4. `corsa`.
5. `fineTornata`: riepilogo (3 colpi, tempo, punti tempo, penalità, totale), poi risultati simulati degli altri 5 cavalieri e classifica.
6. `finale`: classifica dopo 3 tornate, consegna del Palio se il giocatore vince, "Gioca ancora". Miglior punteggio in `localStorage` (con try/catch).

Fisica del cavallo (stato `x, z, heading, v`):
- W / ↑ accelera (4 m/s²) fino a 17,5 m/s; S / ↓ frena (7 m/s²); senza tasti rallenta piano. A / D o ← / → sterzano.
- Velocità di rotazione limitata da accelerazione laterale massima 9 m/s²: `omega_max = min(1.6, 9 / v)`. Così le curve (raggi 18 m e 24 m) chiedono di frenare.
- A ogni frame `Q.track.project(x, z, sPrev)` dà `s` e `lat`.
- Cordolo: se `|lat| > halfWidth - 0.35` e `Q.track.hasCordolo(s, segno)` → penalità (una per episodio: riarmo quando `|lat| < halfWidth - 0.9`). Se `|lat| > halfWidth + 1.6` con cordolo → tornata nulla, corsa interrotta.
- Fine corsa a `s >= Q.track.L`: cronometro fermo, il cavallo rallenta da solo.

Lancia e colpo:
- Mira con il mouse: posizione normalizzata rispetto al centro → `aimX`, `aimY` in ±0,45 m. In alternativa tasti I / K / J / L.
- Punta in coordinate locali del cavallo: `(-(1.05 + aimX + swayX), 2.05 + aimY + swayY, 2.6)`. `sway` = sobbalzo della falcata più rumore lento, ampiezza crescente con la velocità (circa 0,05 m a 10 m/s, 0,12 m a 17 m/s).
- La lancia si abbassa (`tip` non nullo) da 45 m prima di ogni `Q.track.assaults[i]` e si rialza 6 m dopo.
- Il colpo si valuta quando la punta supera il piano dello scudo (proiezione della punta sulla diagonale A ≥ `Q.track.moro.s`): `dist` = distanza nel piano perpendicolare alla diagonale tra punta e `Q.track.moro.shield`; punti = `Q.RULES.ringScore(dist)`. Poi `moro.hit(punti)`, audio, `figuranti.react`.
- Punteggio tornata: `Q.RULES.tornataScore`.

Camera e resa:
- Inseguimento in terza persona (circa 6,5 m dietro, 3,2 m sopra, sguardo 8 m avanti), morbida. Negli ultimi 30 m prima dell'assalto scende sopra la spalla destra, così punta e scudo sono visibili. Rallentatore 0,5× da 14 m prima a 2 m dopo l'assalto (il cronometro usa il tempo simulato).
- Mirino HUD = proiezione a schermo della punta della lancia. Punti del colpo in sovrimpressione vicino al Moro.
- HUD: tempo al decimo, km/h, tornata n/3, 3 segnalini assalto con i punti, penalità, minimappa 2D dell'otto con il cavallo, avviso "frena" quando `v² / raggio` della curva in arrivo supera il limite. Testi in italiano.
- Avversari simulati: tempo ~ N(52,5; 1,0) s, colpi 100 (45%), 80 (35%), 60 (15%), 40 (5%), una penalità cordolo con probabilità 12%. Abilità leggermente diversa per sestiere.
- Renderer: antialias, `pixelRatio` ≤ 2, ombre, resize, pausa con Esc o P.
- Parametri di debug: `?auto=1&sestiere=romana&ff=20` salta il menu, attiva un pilota automatico (segue l'asse, `lat` bersaglio 1,3 verso gli assalti, velocità limitata dalle curve, mira al centro) e simula 20 s prima del primo frame. Serve per gli screenshot headless e come dimostrazione. `document.title` deve contenere stato, `s`, tempo e punti (`--dump-dom` li legge).
- Verifica: screenshot del menu, della corsa a vari `ff` (rettilineo, curva, avvicinamento al Moro) e del riepilogo; una tornata completa del pilota automatico deve finire senza tornata nulla.

### T6 — integrazione e verifica finale (sessione principale)

- Screenshot dell'intero flusso con i moduli reali, correzioni, test `node --test` su `rules.js` e `track.js` (massimo 3 test), `CLAUDE.md` del progetto.

## Stato (2026-11-09)

- T1-T6 completati.
- Verifica finale: 3 test su 3 passati; pilota automatico 50,3 s, colpi 100/100/80, 674 punti, nessuna penalità; tre tornate fino al finale con 1982 punti.
- Prestazioni misurate su Radeon 660M a 1920×1080: mediana 9,9 ms per frame, 70 draw call, 1,35 milioni di triangoli.
- Non verificato: audio all'ascolto (solo misure di picco e RMS), gioco con mani umane su tastiera e mouse (solo bot con eventi simulati).
