(function (root) {
  const Q = (root.Q = root.Q || {});

  // Assi: +X = est, +Z = sud, Y = alto. Unità: metri.
  // Otto = due cerchi (nord e sud) uniti dalle due tangenti interne (le diagonali).
  const N = { x: 0, z: -45, r: 18 };
  const S = { x: 0, z: 40, r: 24 };
  const HALF_WIDTH = 3;

  const D = S.z - N.z;
  const alpha = Math.asin((N.r + S.r) / D);
  const sinA = Math.sin(alpha);
  const cosA = Math.cos(alpha);
  const P = { x: 0, z: N.z + (D * N.r) / (N.r + S.r) }; // incrocio delle diagonali
  const dN = (N.r / sinA) * cosA; // incrocio -> punto di tangenza nord
  const dS = (S.r / sinA) * cosA;
  const T = dN + dS;
  const arcN = N.r * (Math.PI + 2 * alpha);
  const arcS = S.r * (Math.PI + 2 * alpha);
  const LAP = 2 * T + arcN + arcS;

  const uA = { x: sinA, z: -cosA }; // diagonale A: da sud-ovest a nord-est
  const uB = { x: sinA, z: cosA }; // diagonale B: da nord-ovest a sud-est
  const startA = { x: P.x - uA.x * dS, z: P.z - uA.z * dS };
  const startB = { x: P.x - uB.x * dN, z: P.z - uB.z * dN };

  // Giro = A, curva nord, B, curva sud. posAt accetta qualsiasi s (ciclico).
  function posAt(s) {
    let m = ((s % LAP) + LAP) % LAP;
    if (m < T) return { x: startA.x + uA.x * m, z: startA.z + uA.z * m, hx: uA.x, hz: uA.z };
    m -= T;
    if (m < arcN) {
      const th = alpha - m / N.r;
      return { x: N.x + N.r * Math.cos(th), z: N.z + N.r * Math.sin(th), hx: Math.sin(th), hz: -Math.cos(th) };
    }
    m -= arcN;
    if (m < T) return { x: startB.x + uB.x * m, z: startB.z + uB.z * m, hx: uB.x, hz: uB.z };
    m -= T;
    const th = -alpha + m / S.r;
    return { x: S.x + S.r * Math.cos(th), z: S.z + S.r * Math.sin(th), hx: -Math.sin(th), hz: Math.cos(th) };
  }

  // Destra del senso di marcia per una direzione (hx, hz).
  function rightOf(p) {
    return { x: -p.hz, z: p.hx };
  }

  function offsetAt(s, lat) {
    const p = posAt(s);
    return { x: p.x - p.hz * lat, z: p.z + p.hx * lat, hx: p.hx, hz: p.hz };
  }

  function dist2(p, x, z) {
    return (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
  }

  // Proiezione locale attorno a sHint: all'incrocio le due corsie si sovrappongono,
  // quindi la ricerca globale del punto più vicino darebbe la corsia sbagliata.
  function project(x, z, sHint) {
    let best = sHint;
    let bestD = Infinity;
    for (let s = sHint - 8; s <= sHint + 16; s += 0.5) {
      const d = dist2(posAt(s), x, z);
      if (d < bestD) { bestD = d; best = s; }
    }
    const from = best - 0.5;
    for (let s = from; s <= from + 1; s += 0.02) {
      const d = dist2(posAt(s), x, z);
      if (d < bestD) { bestD = d; best = s; }
    }
    const p = posAt(best);
    const lat = (x - p.x) * -p.hz + (z - p.z) * p.hx;
    return { s: best, lat };
  }

  // Distanza minima dall'asse della pista su tutto il giro (per piazzare oggetti fuori pista).
  function distToTrack(x, z) {
    let bestD = Infinity;
    for (let s = 0; s < LAP; s += 1) bestD = Math.min(bestD, dist2(posAt(s), x, z));
    return Math.sqrt(bestD);
  }

  // All'incrocio le corsie si sovrappongono: lì il bordo di una corsia cade dentro l'altra
  // e non ha cordolo. side = +1 bordo destro, -1 bordo sinistro.
  function hasCordolo(s, side) {
    const m = ((s % LAP) + LAP) % LAP;
    let other;
    if (m < T) other = uB;
    else if (m >= T + arcN && m < 2 * T + arcN) other = uA;
    else return true;
    const e = offsetAt(s, side * HALF_WIDTH);
    const d = Math.abs((e.x - P.x) * other.z - (e.z - P.z) * other.x);
    return d >= HALF_WIDTH + 0.4;
  }

  // Il Moro sta sulla punta della goccia d'erba a sud dell'incrocio, a destra della diagonale A.
  const sCross = dS;
  const sMoro = sCross - HALF_WIDTH / Math.tan(alpha);
  const SHIELD_LAT = 2.35;
  const SHIELD_Y = 2.05;
  const post = offsetAt(sMoro, HALF_WIDTH + 0.75);
  const shield = offsetAt(sMoro, SHIELD_LAT);

  const COURSE = 2 * LAP + T; // 5 diagonali + 4 curve

  Q.track = {
    N, S, P, alpha, uA, uB,
    halfWidth: HALF_WIDTH,
    T, arcN, arcS,
    lap: LAP,
    L: COURSE,
    startS: -22, // posizione di partenza del cavallo (il tempo parte a s = 0)
    assaults: [sMoro, sMoro + LAP, sMoro + 2 * LAP],
    moro: {
      s: sMoro,
      x: post.x,
      z: post.z,
      // il busto guarda verso chi arriva sulla diagonale A
      yaw: Math.atan2(-uA.x, -uA.z),
      shield: { x: shield.x, y: SHIELD_Y, z: shield.z, lat: SHIELD_LAT },
    },
    posAt,
    offsetAt,
    rightOf,
    project,
    distToTrack,
    hasCordolo,
    // yaw per un oggetto Three.js il cui "avanti" locale è +Z
    yawOf(p) { return Math.atan2(p.hx, p.hz); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
