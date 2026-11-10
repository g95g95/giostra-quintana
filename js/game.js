(function () {
  'use strict';
  const tr = Q.track;
  const R = Q.RULES;
  const LY = Q.LAYOUT;

  // ?auto=1 pilota automatico; ?auto=3 anche i pannelli avanzano da soli (tre tornate fino al finale).
  // ?ff=N simula N secondi prima del primo frame e poi ferma la simulazione (screenshot); &live=1 la lascia andare.
  const qs = new URLSearchParams(location.search);
  const AUTO = Number(qs.get('auto') || 0);
  const FF = Number(qs.get('ff') || 0);
  const DEBUG = AUTO > 0 || FF > 0;
  // telefono o tablet: comandi touch e sterzo con l'inclinazione (?touch=1 li forza per le prove)
  const TOUCH = qs.has('touch') || matchMedia('(hover: none) and (pointer: coarse)').matches;

  const STEP = 1 / 60;
  const ACC = 4;
  const BRAKE = 7;
  const DRAG = 0.6;
  const VMAX = 17.5;
  const A_LAT = 9;
  const OMEGA_MAX = 1.6;
  const STEER_RATE = 6;
  const AIM_MAX = 0.45;
  const HW = tr.halfWidth;
  const LANCE_FROM = 45;
  const LANCE_TO = 6;
  const SLOW_FROM = 14;
  const SLOW_TO = 2;
  const SHOULDER_FROM = 30;
  const INTRO_LEN = 11;
  const ARRIVO_LEN = 2.5;

  const START_A = tr.posAt(0);
  const RIGHT_A = { x: -tr.uA.z, z: tr.uA.x };
  const SHIELD = tr.moro.shield;
  const ROMANI = ['I', 'II', 'III'];
  const ORDINALI = ['Primo', 'Secondo', 'Terzo'];
  // abilità degli avversari simulati, -1..1
  const SKILL = { piazzarola: 0.3, maggiore: -0.25, romana: 0.4, solesta: 0.1, tufilla: -0.35, emidio: 0.2 };

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const fmt = (t) => t.toFixed(1).replace('.', ',');
  const mod = (a, n) => ((a % n) + n) % n;

  function sfx(name, arg) {
    const A = Q.Audio;
    if (A && typeof A[name] === 'function') A[name](arg);
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }

  const STORE = 'quintana.record';
  function loadRecord() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }
  function saveRecord(r) {
    try { localStorage.setItem(STORE, JSON.stringify(r)); } catch (e) { /* localStorage non disponibile: il record resta in memoria */ }
  }
  let record = loadRecord();
  // telefono: grafica leggera, salvo scelta "alta" nel menu di pausa
  const LITE = TOUCH && record.grafica !== 'alta';

  // ---------- scena ----------
  const renderer = new THREE.WebGLRenderer({ antialias: !LITE, preserveDrawingBuffer: DEBUG });
  renderer.setPixelRatio(LITE ? 1 : Math.min(window.devicePixelRatio || 1, TOUCH ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  $('view').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
  const world = Q.World.build(scene, renderer, { lite: LITE });
  const sun = world.sun;
  if (!sun.target.parent) scene.add(sun.target);
  const moro = Q.Moro.create();
  scene.add(moro.group);

  // Figuranti e cavallo dipendono dal sestiere scelto: si ricostruiscono quando cambia.
  function disposeObjects(objs) {
    objs.forEach((o) => {
      if (o.parent) o.parent.remove(o);
      o.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
        const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
        ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      });
    });
  }
  let fig = null;
  let figObjs = [];
  let figId = null;
  function buildFiguranti(id) {
    if (figId === id) return;
    disposeObjects(figObjs);
    const before = new Set(scene.children);
    fig = Q.Figuranti.build(scene, { playerSestiereId: id, lite: LITE });
    figObjs = scene.children.filter((o) => !before.has(o));
    figId = id;
  }
  let horse = null;
  let horseId = null;
  function buildHorse(s) {
    if (horseId === s.id) return;
    if (horse) disposeObjects([horse.group]);
    horse = Q.Horse.create({ c1: s.c1, c2: s.c2 });
    scene.add(horse.group);
    horseId = s.id;
  }

  // ---------- stato ----------
  const H = {
    x: 0, z: 0, h: 0, v: 0, s: 0, sPrev: 0, lat: 0, steer: 0,
    px: 0, pz: 0, ph: 0, dist: 0,
    aimX: 0, aimY: 0, aimTX: 0, aimTY: 0, swayX: 0, swayY: 0,
    tipOn: false,
  };
  const G = {
    state: '', phase: '', st: 0, simT: 0, timeScale: 1,
    paused: false, frozen: false,
    sestiere: Q.sestiere(qs.get('sestiere') || record.sestiere || 'romana'),
    tornata: 0, players: [], rand: Math.random,
    win: false, introCurve: null,
  };
  let run = newRun();

  function newRun() {
    return {
      t0: null, time: null, tFine: null, hits: [null, null, null], annunci: [false, false, false],
      cordoli: 0, armed: true, nulla: false, motivo: '', prev: null, punti: 0,
    };
  }

  function placeHorse(x, z, h) {
    Object.assign(H, { x, z, h, px: x, pz: z, ph: h, v: 0, steer: 0 });
  }

  function newGame(sest) {
    G.sestiere = sest;
    record.sestiere = sest.id;
    saveRecord(record);
    buildHorse(sest);
    buildFiguranti(sest.id);
    G.rand = rng(DEBUG ? 20260815 : Date.now() & 0x7fffffff);
    G.players = Q.SESTIERI.map((s) => ({ s, me: s.id === sest.id, skill: SKILL[s.id] || 0, tornate: [] }));
    G.tornata = 0;
    G.win = false;
  }

  function startTornata() {
    G.tornata++;
    const p = tr.posAt(tr.startS);
    placeHorse(p.x, p.z, tr.yawOf(p));
    Object.assign(H, { s: tr.startS, sPrev: tr.startS, lat: 0, dist: 0, aimX: 0, aimY: 0, aimTX: 0, aimTY: 0, tipOn: false });
    run = newRun();
    cam.snap = true;
    setState('pronto');
  }

  // ---------- input ----------
  const keys = {};
  const mouse = { nx: 0, ny: 0, active: false };
  const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (GAME_KEYS.includes(e.code) && G.state !== 'menu') e.preventDefault();
    initAudio();
    onKey(e.code);
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  // solo il mouse: dopo un tocco il browser genera eventi mouse di compatibilità
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse.nx = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
    mouse.ny = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
    mouse.active = true;
  });
  addEventListener('pointerdown', initAudio);
  // un pulsante col fuoco riceverebbe anche Invio e Spazio, già gestiti da onKey
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); askTilt(); });
  $('view').addEventListener('click', () => { if (G.state === 'intro') startTornata(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !DEBUG) setPaused(true); });

  let audioOn = true;
  function initAudio() {
    if (!Q.Audio) return;
    Q.Audio.init();
    Q.Audio.setMaster(audioOn ? 0.8 : 0);
  }

  function onKey(code) {
    if (code === 'KeyM') { audioOn = !audioOn; sfx('setMaster', audioOn ? 0.8 : 0); return; }
    if (code === 'Escape' && !$('aiuto').classList.contains('hidden')) { closeAiuto(); return; }
    if ((code === 'Escape' || code === 'KeyP') && ['intro', 'pronto', 'corsa', 'fineTornata'].includes(G.state)) { setPaused(!G.paused); return; }
    if (G.paused) return;
    if (G.state === 'intro' && (code === 'Space' || code === 'Enter')) { startTornata(); return; }
    if (code === 'Enter' && G.state === 'fineTornata') {
      if (G.phase === 'riepilogo') setPhase('risultati');
      else if (G.phase === 'risultati') nextTornata();
    }
  }

  // ---------- touch e inclinazione ----------
  // Pollice destro: premuto galoppa, trascinato muove la mira. Pollice sinistro: frena.
  // Lo sterzo è l'inclinazione del telefono; senza sensore il pollice sinistro fa da leva
  // (in orizzontale sterza, verso il basso frena).
  const RAD = Math.PI / 180;
  const TILT_DEAD = 2;
  const TILT_FULL = 22;
  const AIM_DRAG = 110;
  const STICK = 55;
  const tilt = { on: record.tilt !== false, ok: false, asked: false, steer: 0 };
  const pad = { sx: null, dx: null };
  const tiltActive = () => tilt.on && tilt.ok;

  function onTilt(e) {
    if (e.beta === null || e.gamma === null) return;
    const b = e.beta * RAD;
    const g = e.gamma * RAD;
    const a = (screen.orientation ? screen.orientation.angle : window.orientation || 0) * RAD;
    // "su" del mondo lungo l'asse orizzontale dello schermo: vale per il telefono verticale o quasi piatto
    const up = Math.cos(a) * -Math.cos(b) * Math.sin(g) - Math.sin(a) * Math.sin(b);
    const deg = Math.asin(clamp(-up, -1, 1)) / RAD;
    tilt.steer = Math.sign(deg) * clamp((Math.abs(deg) - TILT_DEAD) / (TILT_FULL - TILT_DEAD), 0, 1);
    if (!tilt.ok) { tilt.ok = true; refreshTouch(); }
  }

  // iOS concede il sensore solo su richiesta fatta dentro un gesto dell'utente
  function askTilt() {
    if (!TOUCH || !tilt.on || tilt.asked || typeof DeviceOrientationEvent === 'undefined') return;
    tilt.asked = true;
    const listen = () => addEventListener('deviceorientation', onTilt);
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') listen(); else tilt.asked = false; }, () => { tilt.asked = false; });
    } else listen();
  }

  function goLandscape() {
    const el = document.documentElement;
    const lock = () => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); };
    if (document.fullscreenElement || !el.requestFullscreen) lock();
    else el.requestFullscreen({ navigationUI: 'hide' }).then(lock, lock);
  }

  function refreshTouch() {
    $('pomo-sx').innerHTML = tiltActive() ? '<b>Frena</b>' : '<b>◄ ►</b><small>sterza<br>giù: frena</small>';
    $('btn-grafica').textContent = 'Grafica: ' + (LITE ? 'leggera' : 'alta risoluzione');
    $('btn-sterzo').textContent = 'Sterzo: ' + (!tilt.on ? 'pollice' : tilt.ok ? 'inclinazione' : 'inclinazione (sensore non attivo)');
  }

  function bindPad(side, onMove) {
    const el = $('zona-' + side);
    const pomo = $('pomo-' + side);
    const end = (e) => {
      if (!pad[side] || pad[side].id !== e.pointerId) return;
      pad[side] = null;
      pomo.classList.remove('on');
      pomo.style.transform = '';
    };
    el.addEventListener('pointerdown', (e) => {
      if (pad[side]) return;
      el.setPointerCapture(e.pointerId);
      pad[side] = { id: e.pointerId, x: e.clientX, y: e.clientY, ax: H.aimTX, ay: H.aimTY, steer: 0, brake: false };
      pomo.classList.add('on');
      askTilt();
    });
    el.addEventListener('pointermove', (e) => {
      const p = pad[side];
      if (p && p.id === e.pointerId) onMove(p, e.clientX - p.x, e.clientY - p.y, pomo);
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  bindPad('dx', (p, dx, dy) => {
    mouse.active = false;
    H.aimTX = clamp(p.ax + (dx / AIM_DRAG) * AIM_MAX, -AIM_MAX, AIM_MAX);
    H.aimTY = clamp(p.ay - (dy / AIM_DRAG) * AIM_MAX, -AIM_MAX, AIM_MAX);
  });
  bindPad('sx', (p, dx, dy, pomo) => {
    if (tiltActive()) return;
    p.steer = clamp(dx / STICK, -1, 1);
    p.brake = dy > STICK * 0.6;
    pomo.style.transform = 'translate(' + (p.steer * STICK).toFixed(0) + 'px,' + (p.brake ? 18 : 0) + 'px)';
  });
  $('btn-pausa-touch').addEventListener('click', () => setPaused(true));
  $('btn-sterzo').addEventListener('click', () => {
    tilt.on = !tilt.on;
    record.tilt = tilt.on;
    saveRecord(record);
    askTilt();
    refreshTouch();
  });
  $('btn-grafica').addEventListener('click', () => {
    if (!confirm('Il gioco si riavvia e la partita in corso si perde. Continuare?')) return;
    record.grafica = LITE ? 'alta' : 'leggera';
    saveRecord(record);
    location.reload();
  });
  if (TOUCH) {
    document.documentElement.classList.add('touch');
    $('salta').textContent = 'Tocca per saltare';
  }

  function playerControls(dt) {
    const k = keys;
    let throttle = k.KeyW || k.ArrowUp ? 1 : k.KeyS || k.ArrowDown ? -1 : 0;
    let steer = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (pad.sx && (tiltActive() || pad.sx.brake)) throttle = -1;
    else if (pad.dx) throttle = 1;
    steer = clamp(steer + (tiltActive() ? tilt.steer : pad.sx ? pad.sx.steer : 0), -1, 1);
    const ax = (k.KeyL ? 1 : 0) - (k.KeyJ ? 1 : 0);
    const ay = (k.KeyI ? 1 : 0) - (k.KeyK ? 1 : 0);
    if (ax || ay) {
      mouse.active = false;
      H.aimTX = clamp(H.aimTX + ax * 0.9 * dt, -AIM_MAX, AIM_MAX);
      H.aimTY = clamp(H.aimTY + ay * 0.9 * dt, -AIM_MAX, AIM_MAX);
    } else if (mouse.active) {
      H.aimTX = mouse.nx * AIM_MAX;
      H.aimTY = -mouse.ny * AIM_MAX;
    }
    return { throttle, steer };
  }

  // ---------- pista: curve in arrivo ----------
  // Curva corrente (dist = 0) o prossima curva del percorso; null se il percorso finisce prima.
  function curveAhead(s) {
    const m = mod(s, tr.lap);
    const base = s - m;
    let start;
    let r;
    if (m < tr.T) { start = base + tr.T; r = tr.N.r; }
    else if (m < tr.T + tr.arcN) return { dist: 0, r: tr.N.r };
    else if (m < 2 * tr.T + tr.arcN) { start = base + 2 * tr.T + tr.arcN; r = tr.S.r; }
    else return { dist: 0, r: tr.S.r };
    return start < tr.L ? { dist: start - s, r } : null;
  }

  function brakeWarning() {
    if (G.state !== 'corsa') return false;
    const c = curveAhead(H.s);
    if (!c) return false;
    const vLim2 = A_LAT * c.r;
    const v2 = H.v * H.v;
    if (v2 <= vLim2 * 0.98) return false;
    return c.dist === 0 || c.dist < (v2 - vLim2) / (2 * BRAKE) + H.v * 0.9;
  }

  // ---------- pilota automatico ----------
  function latTarget(s) {
    let w = 0;
    for (const a of tr.assaults) w = Math.max(w, smooth(a - 62, a - 48, s) * (1 - smooth(a + 6, a + 16, s)));
    return 1.3 * w;
  }

  // Inseguimento puro: sterzata verso un punto sull'asse (spostato di lat) davanti al cavallo.
  function pursuitSteer(lat) {
    const ld = 3 + H.v * 0.45;
    const p = tr.offsetAt(H.s + ld, lat);
    const dx = p.x - H.x;
    const dz = p.z - H.z;
    const err = wrap(Math.atan2(dx, dz) - H.h);
    const omega = (2 * Math.max(H.v, 1) * Math.sin(err)) / Math.hypot(dx, dz);
    return clamp(-omega / omegaMax(Math.max(H.v, 1)), -1, 1);
  }

  function autopilot() {
    if (G.state === 'pronto') return { throttle: G.st > 0.8 ? 1 : 0, steer: 0 };
    const steer = pursuitSteer(latTarget(H.s));
    let target = VMAX;
    const c = curveAhead(H.s);
    if (c) {
      const vc2 = 0.84 * A_LAT * c.r;
      target = Math.min(VMAX, Math.sqrt(vc2 + 2 * 5.5 * c.dist));
    }
    const throttle = H.v < target - 0.15 ? 1 : H.v > target + 0.4 ? -1 : 0;
    // mira: porta la punta (senza oscillazione) sul centro dello scudo
    const i = lanceWindow(H.s);
    if (i >= 0) {
      const t = toWorld(tipTmp.set(-1.05, 2.05, 2.6), H.x, H.z, H.h);
      const off = (SHIELD.x - t.x) * RIGHT_A.x + (SHIELD.z - t.z) * RIGHT_A.z;
      H.aimTX = clamp(off, -AIM_MAX, AIM_MAX);
      H.aimTY = clamp(SHIELD.y - 2.05, -AIM_MAX, AIM_MAX);
    }
    return { throttle, steer };
  }

  // ---------- fisica ----------
  function omegaMax(v) {
    return Math.min(OMEGA_MAX, A_LAT / Math.max(v, 0.01));
  }

  function physics(dt, c) {
    H.px = H.x; H.pz = H.z; H.ph = H.h;
    if (c.decel) H.v = Math.max(0, H.v - c.decel * dt);
    else if (c.throttle > 0) H.v = Math.min(VMAX, H.v + ACC * dt);
    else if (c.throttle < 0) H.v = Math.max(0, H.v - BRAKE * dt);
    else H.v = Math.max(0, H.v - DRAG * dt);
    H.steer += clamp(c.steer - H.steer, -STEER_RATE * dt, STEER_RATE * dt);
    // destra del cavaliere = yaw decrescente; da fermo il cavallo non gira su sé stesso
    H.h = wrap(H.h - H.steer * omegaMax(H.v) * Math.min(1, H.v / 1.5) * dt);
    H.x += Math.sin(H.h) * H.v * dt;
    H.z += Math.cos(H.h) * H.v * dt;
    H.dist += H.v * dt;
    const p = tr.project(H.x, H.z, H.s);
    H.sPrev = H.s;
    H.s = p.s;
    H.lat = p.lat;

    H.aimX += (H.aimTX - H.aimX) * (1 - Math.exp(-dt * 10));
    H.aimY += (H.aimTY - H.aimY) * (1 - Math.exp(-dt * 10));
    // oscillazione della punta: sobbalzo della falcata (3,2 m) più rumore lento
    const amp = Math.max(0.01, 0.05 + 0.01 * (H.v - 10));
    const ph = (H.dist / 3.2) * Math.PI * 2;
    const t = G.simT;
    H.swayX = amp * (0.45 * Math.sin(ph + 0.7) + 0.55 * noise(t, 0));
    H.swayY = amp * (0.65 * Math.sin(ph) + 0.35 * noise(t, 2.3));
  }

  function noise(t, k) {
    return (Math.sin(t * 1.7 + k) + 0.6 * Math.sin(t * 2.9 + 2 * k + 1.3) + 0.8 * Math.sin(t * 0.83 + 3 * k)) / 2.4;
  }

  // Punta della lancia in coordinate locali del cavallo.
  function tipLocal(out) {
    return out.set(-(1.05 + H.aimX + H.swayX), 2.05 + H.aimY + H.swayY, 2.6);
  }
  function toWorld(l, x, z, h) {
    const c = Math.cos(h);
    const s = Math.sin(h);
    return { x: x + l.x * c + l.z * s, y: l.y, z: z - l.x * s + l.z * c };
  }

  function lanceWindow(s) {
    for (let i = 0; i < tr.assaults.length; i++) {
      const a = tr.assaults[i];
      if (s >= a - LANCE_FROM && s <= a + LANCE_TO) return i;
    }
    return -1;
  }

  // ---------- regole ----------
  const tipTmp = new THREE.Vector3();
  function rules(dt) {
    if (run.t0 === null && H.s >= 0) {
      const f = (0 - H.sPrev) / (H.s - H.sPrev);
      run.t0 = G.simT - dt * (1 - f);
      fig.react('via');
      sfx('tamburi', false);
      sfx('cheer', 0.5);
      msg('Via!', 1.2);
    }

    // cordoli e tornata nulla contano dalla linea di partenza: prima c'è solo la rincorsa
    const a = run.t0 === null ? 0 : Math.abs(H.lat);
    const side = H.lat >= 0 ? 1 : -1;
    if (a > HW + 1.6 && tr.hasCordolo(H.s, side)) { endTornata(true, 'Quattro zoccoli fuori dalla pista'); return; }
    if (run.armed && a > HW - 0.35 && tr.hasCordolo(H.s, side)) {
      run.armed = false;
      run.cordoli++;
      sfx('penalty');
      sfx('ooh');
      fig.react('penalita');
      msg('Cordolo! −' + R.PEN_CORDOLO, 1.6, 'male');
    } else if (!run.armed && a < HW - 0.9) run.armed = true;

    const i = lanceWindow(H.s);
    H.tipOn = i >= 0;
    if (i >= 0 && !run.annunci[i] && H.s >= tr.assaults[i] - SHOULDER_FROM) {
      run.annunci[i] = true;
      msg(ORDINALI[i] + ' assalto al Moro', 1.4);
    }
    if (i >= 0 && run.hits[i] === null) {
      const tw = toWorld(tipLocal(tipTmp), H.x, H.z, H.h);
      tw.along = (tw.x - START_A.x) * tr.uA.x + (tw.z - START_A.z) * tr.uA.z;
      tw.i = i;
      const pv = run.prev;
      if (pv && pv.i === i && pv.along < tr.moro.s && tw.along >= tr.moro.s) strike(i, pv, tw);
      run.prev = tw;
    }
    for (let k = 0; k < 3; k++) if (run.hits[k] === null && H.s > tr.assaults[k] + LANCE_TO) strike(k, null, null);

    if (H.s >= tr.L) {
      const f = (tr.L - H.sPrev) / (H.s - H.sPrev);
      run.time = Math.round((G.simT - dt * (1 - f) - run.t0) * 10) / 10;
      endTornata(false, '');
    }
  }

  // a, b: punta prima e dopo il piano dello scudo (null = assalto saltato)
  function strike(i, a, b) {
    let pts = 0;
    if (a) {
      const f = (tr.moro.s - a.along) / (b.along - a.along);
      const x = lerp(a.x, b.x, f);
      const y = lerp(a.y, b.y, f);
      const z = lerp(a.z, b.z, f);
      const dl = (x - SHIELD.x) * RIGHT_A.x + (z - SHIELD.z) * RIGHT_A.z;
      pts = R.ringScore(Math.hypot(dl, y - SHIELD.y));
    }
    run.hits[i] = pts;
    moro.hit(pts);
    if (pts > 0) { sfx('hit', pts); sfx('cheer', pts / 100); } else sfx('ooh');
    fig.react(pts === 100 ? 'centro' : pts > 0 ? 'colpo' : 'mancato');
    popup.text = pts > 0 ? String(pts) : 'Mancato';
    popup.zero = pts === 0;
    popup.t = G.simT;
  }

  // ---------- fine tornata, avversari, classifica ----------
  function simulaAvversario(p) {
    const r = G.rand;
    const k = p.skill;
    const time = Math.round((52.5 - 0.5 * k + gauss(r)) * 10) / 10;
    const p100 = 0.45 + 0.08 * k;
    const p60 = 0.15 - 0.04 * k;
    const p40 = 0.05 - 0.02 * k;
    const p80 = 1 - p100 - p60 - p40;
    const hits = [0, 1, 2].map(() => {
      const u = r();
      return u < p100 ? 100 : u < p100 + p80 ? 80 : u < p100 + p80 + p60 ? 60 : 40;
    });
    const cordoli = r() < 0.12 - 0.03 * k ? 1 : 0;
    const t = { hits, time, cordoli, nulla: false, motivo: '' };
    t.punti = R.tornataScore(t);
    return t;
  }

  function endTornata(nulla, motivo) {
    run.tFine = elapsed();
    run.nulla = nulla;
    run.motivo = motivo;
    const mine = {
      hits: run.hits.map((h) => h || 0), time: run.time, cordoli: run.cordoli, nulla, motivo,
    };
    mine.punti = R.tornataScore(mine);
    run.punti = mine.punti;
    G.players.forEach((p) => p.tornate.push(p.me ? mine : simulaAvversario(p)));
    if (!nulla) {
      if (!(record.tornata >= mine.punti)) record.tornata = mine.punti;
      if (!(record.tempo <= mine.time)) record.tempo = mine.time;
      saveRecord(record);
    }
    H.tipOn = false;
    fig.react('arrivo');
    if (nulla) { sfx('penalty'); sfx('ooh'); msg('Tornata nulla', 2.5, 'male', motivo); }
    else { sfx('fanfara'); sfx('cheer', 0.8); msg('Arrivo! ' + fmt(run.time) + ' s', 2.5, '', mine.punti + ' punti'); }
    setState('fineTornata', 'arrivo');
  }

  function totale(p) {
    return p.tornate.reduce((a, t) => a + t.punti, 0);
  }
  function classifica() {
    return G.players.slice().sort((a, b) => totale(b) - totale(a) || (a.me ? -1 : b.me ? 1 : 0));
  }

  function nextTornata() {
    if (G.tornata < R.TORNATE) startTornata();
    else finale();
  }

  function finale() {
    const cl = classifica();
    G.win = cl[0].me;
    const me = G.players.find((p) => p.me);
    const tot = totale(me);
    const nuovo = !(record.totale >= tot);
    if (nuovo) { record.totale = tot; saveRecord(record); }
    if (G.win) {
      // il cavaliere vincitore si presenta sotto il palco del Magnifico Messere
      const pal = LY.palco;
      placeHorse(pal.cx + pal.w / 2 + 2.2, pal.cz, -Math.PI / 2);
      sfx('fanfara');
      sfx('cheer', 1);
      sfx('tamburi', true);
      fig.react('centro');
    } else sfx('crowd', 0.3);
    fillFinale(cl, nuovo);
    setState('finale');
  }

  // ---------- stati e pannelli ----------
  function setState(s, phase) {
    G.state = s;
    G.phase = phase || '';
    G.st = 0;
    document.body.className = s;
    if (s === 'intro') {
      sfx('fanfara');
      sfx('tamburi', true);
      sfx('crowd', 0.6);
    } else if (s === 'pronto') {
      sfx('tamburi', true);
      sfx('rullo', 2.5);
      sfx('crowd', 0.45);
      msg('Tornata ' + G.tornata + ' di ' + R.TORNATE, 30, '', AUTO ? 'Pilota automatico' : !TOUCH ? 'Tieni premuto W o ↑ per partire, sterza con A e D'
        : 'Tieni premuto a destra per partire. ' + (tiltActive() ? 'Inclina il telefono per sterzare' : 'Sterza con il pollice sinistro'));
    } else if (s === 'menu') {
      sfx('tamburi', false);
      sfx('crowd', 0.3);
    }
    refreshPanels();
  }

  function setPhase(phase) {
    G.phase = phase;
    G.st = 0;
    if (phase === 'riepilogo') fillRiepilogo();
    if (phase === 'risultati') fillRisultati();
    refreshPanels();
  }

  function refreshPanels() {
    const s = G.state;
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    show('menu', s === 'menu');
    show('intro', s === 'intro' && !G.paused);
    show('hud', s === 'pronto' || s === 'corsa' || (s === 'fineTornata' && G.phase === 'arrivo'));
    show('riepilogo', s === 'fineTornata' && G.phase === 'riepilogo' && !G.paused);
    show('risultati', s === 'fineTornata' && G.phase === 'risultati' && !G.paused);
    show('finale', s === 'finale');
    show('pausa', G.paused);
    const pads = TOUCH && !AUTO && (s === 'pronto' || s === 'corsa') && !G.paused;
    show('touch', pads);
    if (!pads) {
      pad.sx = pad.dx = null;
      $('pomo-sx').classList.remove('on');
      $('pomo-dx').classList.remove('on');
    }
    refreshTouch();
    $('hint').classList.toggle('on', s === 'pronto' && !AUTO);
  }

  function setPaused(on) {
    if (!['intro', 'pronto', 'corsa', 'fineTornata'].includes(G.state)) on = false;
    if (G.paused === on) return;
    G.paused = on;
    if (on) sfx('suspend'); else sfx('resume');
    refreshPanels();
  }

  function scudo(s) {
    return '<span class="scudo" style="--c1:' + s.c1 + ';--c2:' + s.c2 + '"></span>';
  }
  function colpiTxt(t) {
    return t.nulla ? '—' : t.hits.join(' · ');
  }

  function fillRiepilogo() {
    const me = G.players.find((p) => p.me);
    const t = me.tornate[G.tornata - 1];
    $('rie-titolo').textContent = 'Tornata ' + G.tornata + ' di ' + R.TORNATE;
    let h = '';
    if (t.nulla) {
      h += '<tr><td colspan="2" class="nulla">Tornata nulla: ' + t.motivo.toLowerCase() + '.</td></tr>';
      h += '<tr class="totale"><td>Totale</td><td class="n">0</td></tr>';
    } else {
      t.hits.forEach((p, i) => { h += '<tr><td>' + ORDINALI[i] + ' assalto</td><td class="n">' + (p > 0 ? p : 'mancato') + '</td></tr>'; });
      h += '<tr><td>Tempo</td><td class="n">' + fmt(t.time) + ' s</td></tr>';
      h += '<tr><td>Punti tempo</td><td class="n">' + R.timePoints(t.time) + '</td></tr>';
      h += '<tr class="' + (t.cordoli ? 'meno' : '') + '"><td>Penalità' + (t.cordoli ? ' (' + t.cordoli + ' cordol' + (t.cordoli > 1 ? 'i' : 'o') + ')' : '') + '</td><td class="n">' +
        (t.cordoli ? '−' + t.cordoli * R.PEN_CORDOLO : 'nessuna') + '</td></tr>';
      h += '<tr class="totale"><td>Totale</td><td class="n">' + t.punti + '</td></tr>';
    }
    $('rie-tabella').innerHTML = h;
  }

  function fillRisultati() {
    const n = G.tornata - 1;
    $('ris-titolo').textContent = 'Tornata ' + G.tornata + ' di ' + R.TORNATE;
    let h = '<tr><th>Sestiere</th><th class="n">Tempo</th><th class="n">Colpi</th><th class="n">Pen.</th><th class="n">Punti</th></tr>';
    G.players.slice().sort((a, b) => b.tornate[n].punti - a.tornate[n].punti).forEach((p) => {
      const t = p.tornate[n];
      h += '<tr class="' + (p.me ? 'io' : '') + '"><td>' + scudo(p.s) + p.s.nome + '</td>' +
        (t.nulla ? '<td colspan="3" class="nulla">tornata nulla</td>' :
          '<td class="n">' + fmt(t.time) + '</td><td class="n">' + colpiTxt(t) + '</td><td class="n">' + (t.cordoli ? '−' + t.cordoli * R.PEN_CORDOLO : '') + '</td>') +
        '<td class="n">' + t.punti + '</td></tr>';
    });
    $('ris-tornata').innerHTML = h;
    let c = '<tr><th>#</th><th>Sestiere</th><th class="n">Totale</th></tr>';
    classifica().forEach((p, i) => {
      c += '<tr class="' + (p.me ? 'io' : '') + '"><td>' + (i + 1) + '</td><td>' + scudo(p.s) + p.s.nome + '</td><td class="n">' + totale(p) + '</td></tr>';
    });
    $('ris-classifica').innerHTML = c;
    $('btn-ris').textContent = G.tornata < R.TORNATE ? 'Tornata successiva' : 'Classifica finale';
  }

  function fillFinale(cl, nuovo) {
    const winner = cl[0];
    const me = G.players.find((p) => p.me);
    const pos = cl.indexOf(me) + 1;
    const palio = $('palio');
    palio.classList.toggle('on', G.win);
    $('finale').classList.toggle('vittoria', G.win);
    palio.style.setProperty('--c1', winner.s.c1);
    palio.style.setProperty('--c2', winner.s.c2);
    $('fin-titolo').textContent = G.win ? 'Il Palio è di ' + winner.s.nome + '!' : 'Vince ' + winner.s.nome;
    $('fin-testo').textContent = G.win
      ? 'Il Magnifico Messere consegna il Palio al tuo cavaliere.'
      : 'Il tuo cavaliere chiude la Quintana al ' + pos + '° posto. Il Palio va a ' + winner.s.nome + '.';
    let h = '<tr><th>#</th><th>Sestiere</th>' + ROMANI.map((r) => '<th class="n">' + r + '</th>').join('') + '<th class="n">Totale</th></tr>';
    cl.forEach((p, i) => {
      h += '<tr class="' + (p.me ? 'io' : '') + '"><td>' + (i + 1) + '</td><td>' + scudo(p.s) + p.s.nome + '</td>' +
        p.tornate.map((t) => '<td class="n">' + (t.nulla ? 'nulla' : t.punti) + '</td>').join('') +
        '<td class="n">' + totale(p) + '</td></tr>';
    });
    $('fin-classifica').innerHTML = h;
    $('fin-record').textContent = nuovo ? 'Nuovo record personale: ' + totale(me) + ' punti!' : recordTxt();
  }

  function recordTxt() {
    if (!record.totale && !record.tornata) return 'Nessun record personale: è la tua prima Quintana.';
    const p = [];
    if (record.totale) p.push('miglior Quintana ' + record.totale + ' punti');
    if (record.tornata) p.push('miglior tornata ' + record.tornata + ' punti');
    if (record.tempo) p.push('miglior tempo ' + fmt(record.tempo) + ' s');
    return 'Record personale: ' + p.join(' · ') + '.';
  }

  // ---------- menu ----------
  function buildMenu() {
    const box = $('sestieri');
    box.innerHTML = '';
    Q.SESTIERI.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'sestiere' + (s.id === G.sestiere.id ? ' scelto' : '');
      b.innerHTML = scudo(s) + '<b>' + s.nome + '</b>';
      b.addEventListener('click', () => {
        G.sestiere = s;
        box.querySelectorAll('.sestiere').forEach((e) => e.classList.remove('scelto'));
        b.classList.add('scelto');
      });
      box.appendChild(b);
    });
    $('record').textContent = recordTxt();
  }

  function closeAiuto() {
    $('aiuto').classList.add('hidden');
  }
  $('btn-aiuto').addEventListener('click', () => $('aiuto').classList.remove('hidden'));
  $('btn-pausa-aiuto').addEventListener('click', () => $('aiuto').classList.remove('hidden'));
  $('btn-aiuto-chiudi').addEventListener('click', closeAiuto);
  $('btn-gioca').addEventListener('click', () => {
    initAudio();
    if (TOUCH) goLandscape();
    newGame(G.sestiere);
    buildIntro();
    setState('intro');
  });
  $('btn-rie').addEventListener('click', () => setPhase('risultati'));
  $('btn-ris').addEventListener('click', nextTornata);
  $('btn-ancora').addEventListener('click', toMenu);
  $('btn-riprendi').addEventListener('click', () => { if (TOUCH) goLandscape(); setPaused(false); });
  $('btn-menu').addEventListener('click', () => { setPaused(false); toMenu(); });

  function toMenu() {
    G.paused = false;
    buildMenu();
    const p = tr.posAt(tr.startS);
    placeHorse(p.x, p.z, tr.yawOf(p));
    H.tipOn = false;
    setState('menu');
  }

  // ---------- messaggi ----------
  const msgState = { until: -1 };
  function msg(text, dur, cls, sub) {
    const el = $('msg');
    el.className = 'on' + (cls ? ' ' + cls : '');
    el.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.appendChild(s);
    }
    msgState.until = G.simT + dur;
  }
  const popup = { t: -99, text: '', zero: false };

  // ---------- camera ----------
  const CHASE = { r: 0, y: 3.2, f: -6.5, lr: 0, ly: 1.2, lf: 8, fov: 62 };
  // Alla spalla destra l'occhio sta sulla linea della lancia (r, y seguono la mira): senza parallasse
  // la proiezione della punta coincide con il punto in cui colpirà lo scudo.
  const SHOULDER = { r: 1.05, y: 2.05, f: -3.8, lr: 1.05, ly: 2.05, lf: 14, fov: 54 };
  const cam = { snap: true, h: 0, o: Object.assign({}, CHASE), t: 0 };
  const vA = new THREE.Vector3();

  function shoulderWeight(s) {
    if (G.state !== 'corsa') return 0;
    let w = 0;
    for (const a of tr.assaults) w = Math.max(w, smooth(a - SHOULDER_FROM, a - SHOULDER_FROM + 6, s) * (1 - smooth(a + 3, a + 9, s)));
    return w;
  }

  function chasePose(x, z, h, o) {
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const rx = -fz;
    const rz = fx;
    return {
      pos: new THREE.Vector3(x + fx * o.f + rx * o.r, o.y, z + fz * o.f + rz * o.r),
      look: new THREE.Vector3(x + fx * o.lf + rx * o.lr, o.ly, z + fz * o.lf + rz * o.lr),
    };
  }

  function buildIntro() {
    const P = LY.propilei;
    const b = LY.blocchi.find((k) => k.sestiere === G.sestiere.id) || LY.blocchi[0];
    const pal = LY.palco;
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    const sp = tr.posAt(tr.startS);
    const end = chasePose(sp.x, sp.z, tr.yawOf(sp), CHASE);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    G.introPos = new THREE.CatmullRomCurve3([V(P.x + 14, 4.5, P.z + 30), V(b.cx + fx * 13, 3.2, b.cz + fz * 13 - 4), V(pal.cx + 13, 4.2, pal.cz + 7), end.pos]);
    G.introLook = new THREE.CatmullRomCurve3([V(P.x, 6, P.z), V(b.cx, 1.8, b.cz), V(pal.cx, pal.h + 1.2, pal.cz), end.look]);
    G.introCaps = [
      'Il corteo storico entra dai propilei',
      'Il sestiere di ' + G.sestiere.nome + ' saluta il suo cavaliere',
      'Il Magnifico Messere attende sul palco con il Palio',
      'Il cavaliere di ' + G.sestiere.nome + ' scende in campo',
    ];
  }

  function updateCamera(dt, alpha) {
    const s = G.state;
    if (s === 'menu' || (s === 'finale' && !G.win)) {
      cam.t += dt;
      const a = cam.t * 0.05 + 0.6;
      camera.position.set(Math.sin(a) * 108, 46, -4 + Math.cos(a) * 108);
      camera.lookAt(0, 0, -4);
      setFov(55);
      cam.snap = true;
      return;
    }
    if (s === 'intro') {
      const n = G.introCaps.length - 1;
      const u = clamp(G.st / INTRO_LEN, 0, 1) * n;
      const k = Math.min(Math.floor(u), n - 1);
      const e = (k + smooth(0, 1, u - k)) / n;
      camera.position.copy(G.introPos.getPoint(e));
      camera.lookAt(G.introLook.getPoint(e));
      setFov(CHASE.fov);
      $('intro-testo').textContent = G.introCaps[Math.round(u)];
      cam.snap = true;
      return;
    }
    if (s === 'finale') {
      cam.t += dt;
      const pal = LY.palco;
      // dal varco tra i blocchi dei sestieri a sud del palco; il palco resta nella metà sinistra
      // perché a destra c'è il pannello della classifica
      camera.position.set(pal.cx + 9.5 + Math.sin(cam.t * 0.15) * 1.2, 3.6, pal.cz + 10.5);
      camera.lookAt(pal.cx + 4.5, pal.h + 0.4, pal.cz - 2.5);
      setFov(55);
      return;
    }
    const x = lerp(H.px, H.x, alpha);
    const z = lerp(H.pz, H.z, alpha);
    const h = H.ph + wrap(H.h - H.ph) * alpha;
    const w = shoulderWeight(H.s);
    SHOULDER.r = SHOULDER.lr = 1.05 + H.aimX;
    SHOULDER.y = SHOULDER.ly = 2.05 + H.aimY;
    const k = cam.snap ? 1 : 1 - Math.exp(-dt * 3.5);
    for (const key in CHASE) cam.o[key] += (lerp(CHASE[key], SHOULDER[key], w) - cam.o[key]) * k;
    cam.h = cam.snap ? h : cam.h + wrap(h - cam.h) * (1 - Math.exp(-dt * (4 + 8 * w)));
    cam.snap = false;
    const p = chasePose(x, z, cam.h, cam.o);
    camera.position.copy(p.pos);
    camera.lookAt(p.look);
    setFov(cam.o.fov);
  }

  function setFov(f) {
    if (Math.abs(camera.fov - f) < 0.01) return;
    camera.fov = f;
    camera.updateProjectionMatrix();
  }

  // ---------- HUD ----------
  const textCache = {};
  function setText(id, t) {
    if (textCache[id] === t) return;
    textCache[id] = t;
    $(id).textContent = t;
  }

  const mapCv = $('minimappa');
  const MAP = { w: 100, h: 220, sc: 1.5, x0: -27, z0: -66 };
  const mapBg = document.createElement('canvas');
  function mapXY(x, z) {
    return [(x - MAP.x0) * MAP.sc + 9.5, (z - MAP.z0) * MAP.sc + 10];
  }
  function drawMapBg(dpr) {
    mapBg.width = mapCv.width = MAP.w * dpr;
    mapBg.height = mapCv.height = MAP.h * dpr;
    const g = mapBg.getContext('2d');
    g.scale(dpr, dpr);
    const path = () => {
      g.beginPath();
      for (let s = 0; s <= tr.lap; s += 1) {
        const p = tr.posAt(s);
        const [u, v] = mapXY(p.x, p.z);
        if (s === 0) g.moveTo(u, v); else g.lineTo(u, v);
      }
      g.closePath();
    };
    g.lineJoin = 'round';
    path(); g.strokeStyle = '#2f5a22'; g.lineWidth = 2 * HW * MAP.sc + 3; g.stroke();
    path(); g.strokeStyle = '#e3c88e'; g.lineWidth = 2 * HW * MAP.sc; g.stroke();
    const s0 = tr.posAt(0);
    const [u0, v0] = mapXY(s0.x, s0.z);
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(u0 + s0.hz * 6, v0 - s0.hx * 6); g.lineTo(u0 - s0.hz * 6, v0 + s0.hx * 6); g.stroke();
    const [mu, mv] = mapXY(tr.moro.x, tr.moro.z);
    g.fillStyle = '#c8141c'; g.strokeStyle = '#f0d77a'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(mu, mv, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  let mapDpr = 0;
  function drawMap(x, z, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== mapDpr) { mapDpr = dpr; drawMapBg(dpr); }
    const g = mapCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, mapCv.width, mapCv.height);
    g.drawImage(mapBg, 0, 0);
    g.scale(dpr, dpr);
    const [u, v] = mapXY(x, z);
    g.strokeStyle = G.sestiere.c2; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(u, v); g.lineTo(u + Math.sin(h) * 9, v + Math.cos(h) * 9); g.stroke();
    g.fillStyle = G.sestiere.c1; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(u, v, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  function elapsed() {
    if (run.tFine !== null) return run.tFine;
    if (run.time !== null) return run.time;
    if (run.t0 === null) return 0;
    return G.simT - run.t0;
  }

  const tipV = new THREE.Vector3();
  function updateHud(alpha) {
    const el = $('msg');
    if (G.simT > msgState.until && el.classList.contains('on')) el.classList.remove('on');
    if ($('hud').classList.contains('hidden')) return;
    const s = G.sestiere;
    const sc = $('hud-scudo');
    sc.style.setProperty('--c1', s.c1);
    sc.style.setProperty('--c2', s.c2);
    setText('hud-nome', s.nome);
    setText('hud-tornata', 'Tornata ' + G.tornata + ' / ' + R.TORNATE);
    setText('hud-tempo', fmt(elapsed()));
    setText('hud-vel', String(Math.round(H.v * 3.6)));
    const next = run.hits.indexOf(null);
    for (let i = 0; i < 3; i++) {
      const p = run.hits[i];
      const e = $('hud-a' + i);
      e.className = 'assalto' + (p === null ? (i === next ? ' prossimo' : '') : ' fatto' + (p === 100 ? ' cento' : p === 0 ? ' zero' : ''));
      const b = e.querySelector('b');
      const t = p === null ? ROMANI[i] : p > 0 ? String(p) : '×';
      if (b.textContent !== t) b.textContent = t;
    }
    const pen = $('hud-pen');
    pen.classList.toggle('si', run.cordoli > 0);
    setText('hud-pen', run.cordoli ? 'Penalità: −' + run.cordoli * R.PEN_CORDOLO : 'Penalità: nessuna');
    $('frena').classList.toggle('on', brakeWarning());

    const x = lerp(H.px, H.x, alpha);
    const z = lerp(H.pz, H.z, alpha);
    const h = H.ph + wrap(H.h - H.ph) * alpha;
    drawMap(x, z, h);

    const mir = $('mirino');
    const vw = renderer.domElement.clientWidth;
    const vh = renderer.domElement.clientHeight;
    if (H.tipOn && G.state === 'corsa') {
      const tw = toWorld(tipLocal(tipTmp), x, z, h);
      tipV.set(tw.x, tw.y, tw.z).project(camera);
      if (tipV.z < 1) {
        mir.style.display = 'block';
        mir.style.transform = 'translate(' + ((tipV.x + 1) * 0.5 * vw).toFixed(1) + 'px,' + ((1 - tipV.y) * 0.5 * vh).toFixed(1) + 'px)';
        const dl = (tw.x - SHIELD.x) * RIGHT_A.x + (tw.z - SHIELD.z) * RIGHT_A.z;
        const d = Math.hypot(dl, tw.y - SHIELD.y);
        mir.className = d < 2 * R.RING_STEP ? 'centro' : d < R.TARGET_RADIUS ? 'bersaglio' : 'fuori';
      } else mir.style.display = 'none';
    } else mir.style.display = 'none';

    const pc = $('colpo');
    const age = G.simT - popup.t;
    if (age < 1.8) {
      tipV.set(SHIELD.x, SHIELD.y + 0.5 + age * 0.6, SHIELD.z).project(camera);
      pc.style.display = tipV.z < 1 ? 'block' : 'none';
      pc.className = popup.zero ? 'zero' : '';
      pc.textContent = popup.text;
      pc.style.left = ((tipV.x + 1) * 0.5 * vw).toFixed(1) + 'px';
      pc.style.top = ((1 - tipV.y) * 0.5 * vh).toFixed(1) + 'px';
      pc.style.opacity = String(clamp((1.8 - age) / 0.5, 0, 1));
    } else pc.style.display = 'none';
  }

  function debugTitle() {
    const pts = run.time !== null || run.nulla ? run.punti : run.hits.reduce((a, b) => a + (b || 0), 0);
    const me = G.players.find((p) => p.me);
    let t = G.state + (G.phase ? '/' + G.phase : '') +
      ' s=' + H.s.toFixed(1) + ' t=' + elapsed().toFixed(1) + ' punti=' + pts +
      ' colpi=' + run.hits.map((h) => (h === null ? '-' : h)).join(',') +
      ' pen=' + run.cordoli + ' v=' + H.v.toFixed(1) + ' lat=' + H.lat.toFixed(2) + ' tornata=' + G.tornata + '/' + R.TORNATE +
      ' totale=' + (me ? totale(me) : 0);
    if (run.nulla) t += ' NULLA';
    if (G.state === 'finale') t += ' vince=' + classifica()[0].s.id;
    document.title = t;
  }

  // ---------- ciclo ----------
  function slowTarget() {
    if (G.state !== 'corsa') return 1;
    for (const a of tr.assaults) if (H.s >= a - SLOW_FROM && H.s <= a + SLOW_TO) return 0.5;
    return 1;
  }

  function step(dt) {
    G.simT += dt;
    G.st += dt;
    const s = G.state;
    if (s === 'intro') {
      if (G.st >= INTRO_LEN) startTornata();
    } else if (s === 'pronto') {
      const c = AUTO ? autopilot() : playerControls(dt);
      if (c.throttle > 0) {
        setState('corsa');
        msgState.until = Math.min(msgState.until, G.simT + 1);
        physics(dt, c);
      }
    } else if (s === 'corsa') {
      physics(dt, AUTO ? autopilot() : playerControls(dt));
      rules(dt);
    } else if (s === 'fineTornata') {
      physics(dt, { decel: 4.5, steer: run.nulla ? 0 : pursuitSteer(0) });
      if (G.phase === 'arrivo' && G.st >= ARRIVO_LEN) setPhase('riepilogo');
      else if (AUTO >= 3 && G.phase === 'riepilogo' && G.st >= 4) setPhase('risultati');
      else if (AUTO >= 3 && G.phase === 'risultati' && G.st >= 4) nextTornata();
    } else if (s === 'finale') {
      H.px = H.x; H.pz = H.z; H.ph = H.h;
    }
  }

  let vw = 0;
  let vh = 0;
  function resize() {
    if (innerWidth === vw && innerHeight === vh) return;
    vw = innerWidth;
    vh = innerHeight;
    renderer.setSize(vw, vh);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    if (TOUCH && vh > vw && (G.state === 'pronto' || G.state === 'corsa')) setPaused(true);
  }
  addEventListener('resize', resize);

  let acc = 0;
  function frame(dtReal, visual) {
    dtReal = Math.min(dtReal, 0.1);
    const live = !G.paused && !G.frozen;
    if (live) {
      G.timeScale += (slowTarget() - G.timeScale) * (1 - Math.exp(-dtReal * 8));
      acc += dtReal * G.timeScale;
      while (acc >= STEP) { step(STEP); acc -= STEP; }
    }
    if (!visual) return;
    resize();
    const alpha = acc / STEP;
    const vdt = live ? dtReal * G.timeScale : 0;
    if (horse) {
      horse.group.position.set(lerp(H.px, H.x, alpha), 0, lerp(H.pz, H.z, alpha));
      horse.group.rotation.y = H.ph + wrap(H.h - H.ph) * alpha;
      horse.update(vdt, { speed: H.v, steer: H.steer, tip: H.tipOn ? tipLocal(tipTmp) : null });
    }
    world.update(vdt, G.simT);
    if (fig) fig.update(vdt, G.simT);
    moro.update(vdt);
    updateCamera(live ? dtReal : 0, alpha);
    const focus = G.state === 'menu' || (G.state === 'finale' && !G.win) ? vA.set(0, 0, -4) : vA.set(H.x, 0, H.z);
    sun.target.position.copy(focus);
    sun.position.copy(focus).add(sun.userData.offset);
    sun.target.updateMatrixWorld();
    updateHud(alpha);
    if (G.state === 'corsa' || G.state === 'fineTornata' || G.state === 'pronto') {
      sfx('gallop', live ? H.v : 0);
      const near = tr.assaults.some((a) => Math.abs(H.s - a) < 30);
      sfx('crowd', near ? 0.65 : 0.42);
    } else sfx('gallop', 0);
    if (DEBUG) debugTitle();
  }

  // Qualità adattiva: se più di metà dei frame supera 20 ms toglie un livello alla volta.
  const LOWER = [
    () => renderer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1)),
    () => { sun.castShadow = false; },
    () => renderer.setPixelRatio(0.75),
  ];
  // Conta i frame lenti e non la media: un singolo salto (scheda tornata visibile) non deve abbassare la qualità.
  const perf = { n: 0, slow: 0, sum: 0, level: 0 };
  function adaptQuality(dt) {
    if (DEBUG || G.paused || dt <= 0 || dt > 2 || perf.level >= LOWER.length) return;
    perf.n++;
    perf.sum += dt;
    if (dt > 0.02) perf.slow++;
    if (perf.n < 3 || (perf.n < 90 && perf.sum < 3)) return;
    if (perf.slow > perf.n / 2) LOWER[perf.level++]();
    perf.n = perf.slow = perf.sum = 0;
  }

  let last = 0;
  function loop(now) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    adaptQuality(dt);
    frame(dt, true);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  // ---------- avvio ----------
  buildMenu();
  buildHorse(G.sestiere);
  buildFiguranti(G.sestiere.id);
  toMenu();
  if (AUTO || qs.has('sestiere')) {
    newGame(G.sestiere);
    startTornata();
  }
  if (FF > 0) {
    const n = Math.round(FF * 60);
    // solo gli ultimi 2 s aggiornano animazioni e camera: il resto è pura simulazione
    for (let i = 0; i < n; i++) frame(STEP, i >= n - 120);
    G.frozen = !qs.get('live');
  }
  frame(0, true);
  requestAnimationFrame(loop);
})();
