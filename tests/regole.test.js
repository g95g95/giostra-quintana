const test = require('node:test');
const assert = require('node:assert');

require('../js/rules.js');
require('../js/track.js');
const { RULES, track } = globalThis.Q;

test('punteggio tornata: anelli, tempo al decimo, penalità cordoli, tornata nulla', () => {
  assert.deepStrictEqual([0, 0.059, 0.061, 0.29, 0.31].map((d) => RULES.ringScore(d)), [100, 100, 80, 20, 0]);
  assert.strictEqual(RULES.timePoints(60), 200);
  assert.strictEqual(RULES.timePoints(48.6), 428);
  assert.strictEqual(RULES.timePoints(61.5), 170);
  assert.strictEqual(RULES.tornataScore({ hits: [100, 80, 0], time: 50, cordoli: 1, nulla: false }), 550);
  assert.strictEqual(RULES.tornataScore({ hits: [100, 100, 100], time: 50, cordoli: 0, nulla: true }), 0);
});

test('percorso: 720 metri e proiezione sulla corsia giusta all\'incrocio', () => {
  assert.ok(Math.abs(track.L - 720) < 1, 'lunghezza ' + track.L);
  // Stesso punto vicino all'incrocio, visto prima dalla diagonale A e poi dalla diagonale B.
  const sCross = track.moro.s + track.halfWidth / Math.tan(track.alpha);
  const sA = sCross - 0.3;
  const pA = track.offsetAt(sA, 1.3);
  const onA = track.project(pA.x, pA.z, sA - 3);
  assert.ok(Math.abs(onA.s - sA) < 0.05 && Math.abs(onA.lat - 1.3) < 0.01);
  const sB = track.T + track.arcN + (track.T - sCross);
  const onB = track.project(pA.x, pA.z, sB);
  assert.ok(onB.s > track.T + track.arcN, 'resta sulla diagonale B: ' + onB.s);
});

test('cordoli: assenti dove le corsie si incrociano, presenti altrove', () => {
  const sCross = track.moro.s + track.halfWidth / Math.tan(track.alpha);
  assert.strictEqual(track.hasCordolo(sCross, 1), false);
  assert.strictEqual(track.hasCordolo(sCross, -1), false);
  assert.strictEqual(track.hasCordolo(sCross - 25, 1), true);
  assert.strictEqual(track.hasCordolo(track.T + 10, -1), true);
});
