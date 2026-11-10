// Prova end-to-end su telefono emulato via CDP: tocchi e sensore di orientamento.
// Uso: node mobile_e2e.mjs <url> <cartella screenshot> [tilt|stick]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, outDir, mode = 'tilt'] = process.argv.slice(2);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = mode === 'tilt' ? 9343 : 9345;
const edge = spawn(EDGE, ['--headless=new', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-first-run',
  '--user-data-dir=' + outDir + '/edge_e2e_' + mode, '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outDir + '/' + mode + '_' + name, Buffer.from(r.data, 'base64'));
}
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tap(sel) {
  const c = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await touch('touchStart', [{ x: c[0], y: c[1], id: 9 }]);
  await sleep(60);
  await touch('touchEnd', []);
  await sleep(300);
}
const state = async () => {
  const t = await ev('document.title');
  const o = { raw: t, state: t.split(' ')[0] };
  for (const m of t.matchAll(/(\w+)=(-?[\d.]+)/g)) o[m[1]] = Number(m[2]);
  return o;
};
const log = (...a) => console.log(...a);
let fail = 0;
const check = (name, ok, info) => { if (!ok) fail++; log((ok ? 'OK   ' : 'FAIL ') + name + (info !== undefined ? '  [' + info + ']' : '')); };

const W = 812;
const H = 375;
const R = { x: W - 70, y: H - 70, id: 1 };
const L = { x: 70, y: H - 70, id: 2 };
// dita attualmente appoggiate
let right = null;
let left = null;
const fingers = () => [right, left].filter(Boolean);
async function put() {
  await touch(fingers().length ? 'touchMove' : 'touchEnd', fingers());
}
async function gas(on) {
  if (on && !right) { right = { ...R }; await touch('touchStart', fingers()); }
  if (!on && right) { right = null; await touch('touchEnd', fingers()); }
}
// u = -1..1, positivo a destra
async function steer(u) {
  if (mode === 'tilt') {
    await send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: Math.sign(u) * (2 + Math.abs(u) * 20), gamma: -70 });
    return;
  }
  if (!left) { left = { ...L }; await touch('touchStart', fingers()); }
  left.x = L.x + u * 55;
  await put();
}
async function brake(on) {
  if (on) {
    if (!left) { left = { ...L }; await touch('touchStart', fingers()); }
    left.y = L.y + (mode === 'tilt' ? 0 : 50);
    await put();
  } else if (left) { left = null; await touch('touchEnd', fingers()); }
}
// Guida ad anello chiuso fino a s >= target: PD sullo scarto laterale, più la sterzata della curva di rincorsa.
async function driveTo(target, max = 40000) {
  const t0 = Date.now();
  let o = await state();
  let prev = o.lat;
  let tPrev = Date.now();
  while (o.s < target && o.state !== 'fineTornata' && Date.now() - t0 < max) {
    await sleep(60);
    o = await state();
    const now = Date.now();
    const rate = (o.lat - prev) / Math.max(0.03, (now - tPrev) / 1000);
    prev = o.lat;
    tPrev = now;
    const ff = o.s < 0 ? 0.4 : 0;
    await steer(Math.max(-1, Math.min(1, ff - 0.9 * o.lat - 0.45 * rate)));
  }
  return o;
}
async function freshRun() {
  if (fingers().length) await touch('touchEnd', []);
  right = left = null;
  await send('Page.navigate', { url: url + '?sestiere=romana&ff=0.02&live=1' });
  await sleep(5000);
}

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* non ancora pronto */ }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) p.rej(new Error(p.method + ': ' + d.error.message)); else p.res(d.result);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (mode === 'tilt') await steer(0);

  // 1. menu senza parametri: il telefono viene riconosciuto da solo
  await send('Page.navigate', { url });
  await sleep(5000);
  check('riconosce il telefono', await ev('document.documentElement.classList.contains("touch")'));
  check('nessun errore JS', (await ev('document.getElementById("err").textContent')) === '', await ev('document.getElementById("err").textContent'));
  await shot('menu.png');
  await tap('#btn-aiuto');
  await shot('aiuto.png');
  await tap('#btn-aiuto-chiudi');

  // 2. lo sterzo sposta il cavallo dal lato giusto: due partenze, una a destra e una a sinistra
  const lats = [];
  for (const dir of [1, -1]) {
    await freshRun();
    if (dir === 1) {
      const s = await state();
      check('parte in "pronto"', s.state === 'pronto', s.raw);
      check('pad visibili', await ev('!document.getElementById("touch").classList.contains("hidden")'));
      await shot('pronto.png');
    }
    await gas(true);
    await sleep(300);
    await steer(dir * 0.2);
    let o = await state();
    const t0 = Date.now();
    while (o.v < 7 && Date.now() - t0 < 15000) { await sleep(50); o = await state(); }
    lats.push(o.lat);
    if (dir === 1) {
      check('pollice destro galoppa', o.state === 'corsa' && o.v > 3, o.raw);
      log('sterzo:', await ev('document.getElementById("btn-sterzo").textContent'), '| pomo sx:', await ev('document.getElementById("pomo-sx").textContent'));
    }
  }
  check('sterzo a destra e a sinistra', lats[0] - lats[1] > 1, 'lat destra ' + lats[0] + ', lat sinistra ' + lats[1]);

  // 3. guida ad anello chiuso con lo stesso comando, poi mira, freno e pausa
  await freshRun();
  await gas(true);
  // mira: con la camera da inseguimento (prima della camera alla spalla) il mirino si sposta sullo schermo
  await driveTo(-6);
  const mirAvg = async () => {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let i = 0; i < 6; i++) {
      const m = await ev('(() => { const m = document.getElementById("mirino"); return m.style.display + " " + m.style.transform; })()');
      const v = (m.match(/-?[\d.]+/g) || []).map(Number);
      if (m.startsWith('block')) { x += v[0]; y += v[1]; n++; }
      await sleep(40);
    }
    return n ? [Math.round(x / n), Math.round(y / n)] : null;
  };
  const a0 = await mirAvg();
  right.x -= 110;
  right.y -= 110;
  await put();
  await sleep(250);
  const a1 = await mirAvg();
  check('trascinare il pollice destro sposta il mirino in alto a sinistra', a0 && a1 && a1[0] < a0[0] - 8 && a1[1] < a0[1] - 8, a0 + ' -> ' + a1);
  let s = await driveTo(14);
  check('il cavallo resta in pista guidando con ' + (mode === 'tilt' ? "l'inclinazione" : 'il pollice'), s.state === 'corsa' && Math.abs(s.lat) < 2.2 && s.pen === 0, s.raw);
  await steer(0);

  await shot('corsa.png');

  s = await state();
  const v0 = s.v;
  await brake(true);
  await sleep(700);
  s = await state();
  check('pollice sinistro frena anche col destro premuto', s.v < v0 - 1.5, v0 + ' -> ' + s.v);
  await brake(false);
  await gas(false);

  await tap('#btn-pausa-touch');
  check('pausa dal pulsante', await ev('!document.getElementById("pausa").classList.contains("hidden")'));
  await shot('pausa.png');

  // 4. in verticale compare l'invito a ruotare; il menu resta usabile
  await send('Emulation.setDeviceMetricsOverride', { width: H, height: W, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await sleep(800);
  check('in verticale chiede di ruotare', (await ev('getComputedStyle(document.getElementById("ruota")).display')) === 'flex');
  await send('Page.navigate', { url });
  await sleep(4000);
  check('menu in verticale senza invito a ruotare', (await ev('getComputedStyle(document.getElementById("ruota")).display')) === 'none');
  await shot('menu_verticale.png');
} catch (e) {
  fail++;
  log('ERRORE', e.message);
} finally {
  try { await send('Browser.close'); } catch (e) { /* già chiuso */ }
  edge.kill();
}
log(fail ? 'RISULTATO: ' + fail + ' falliti' : 'RISULTATO: OK');
process.exit(fail ? 1 : 0);
