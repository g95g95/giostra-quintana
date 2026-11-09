(function (root) {
  const Q = (root.Q = root.Q || {});
  const tr = Q.track;

  // Arena a forma di stadio: rettangolo |x| <= halfX, |z| <= straightHalfZ, più due semicerchi.
  const arena = { halfX: 40, straightHalfZ: 50, capR: 40 };

  // Tribune. 'straight': gradoni paralleli a Z, salgono allontanandosi dal campo (side = -1 ovest, +1 est).
  // 'curve': gradoni ad arco attorno a (0, cz); dir = -1 curva nord, +1 curva sud; a0..a1 in radianti
  // (0 = est, PI/2 = fondo curva, PI = ovest); gap = semiapertura centrale per i propilei.
  const stands = [
    { id: 'ovest', kind: 'straight', side: -1, x0: 43, z0: -34, z1: 34, rows: 14, rowDepth: 0.9, rowHeight: 0.48, baseY: 1.3, roof: true, material: 'cemento', chi: 'pubblico' },
    { id: 'ovest-nord', kind: 'straight', side: -1, x0: 43, z0: -50, z1: -37, rows: 9, rowDepth: 0.9, rowHeight: 0.45, baseY: 1.0, roof: false, material: 'ferro', chi: 'pubblico' },
    { id: 'ovest-sud', kind: 'straight', side: -1, x0: 43, z0: 37, z1: 50, rows: 9, rowDepth: 0.9, rowHeight: 0.45, baseY: 1.0, roof: false, material: 'ferro', chi: 'pubblico' },
    { id: 'est', kind: 'straight', side: 1, x0: 43, z0: -50, z1: 50, rows: 10, rowDepth: 0.9, rowHeight: 0.45, baseY: 1.0, roof: false, material: 'ferro', chi: 'pubblico' },
    { id: 'nord', kind: 'curve', dir: -1, cz: -50, r0: 43, a0: 0.06, a1: Math.PI - 0.06, gap: 0.17, rows: 9, rowDepth: 0.9, rowHeight: 0.45, baseY: 1.0, material: 'cemento', chi: 'pubblico' },
    { id: 'sud', kind: 'curve', dir: 1, cz: 50, r0: 43, a0: 0.06, a1: Math.PI - 0.06, gap: 0, rows: 12, rowDepth: 0.9, rowHeight: 0.45, baseY: 1.0, material: 'cemento', chi: 'figuranti' },
  ];

  // Posti a sedere di una tribuna: [{x, y, z, yaw, row, u}] con u in 0..1 lungo la tribuna.
  // yaw = rotazione Y per un oggetto con "avanti" locale +Z che guarda il campo.
  function seats(stand, spacing) {
    const out = [];
    const sp = spacing || 0.6;
    for (let row = 0; row < stand.rows; row++) {
      const y = stand.baseY + row * stand.rowHeight;
      const off = row * stand.rowDepth + stand.rowDepth * 0.5;
      if (stand.kind === 'straight') {
        const x = stand.side * (stand.x0 + off);
        const n = Math.floor((stand.z1 - stand.z0) / sp);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          out.push({ x, y, z: stand.z0 + (stand.z1 - stand.z0) * u, yaw: -stand.side * Math.PI / 2, row, u });
        }
      } else {
        const r = stand.r0 + off;
        const n = Math.floor(((stand.a1 - stand.a0) * r) / sp);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          const a = stand.a0 + (stand.a1 - stand.a0) * u;
          if (stand.gap && Math.abs(a - Math.PI / 2) < stand.gap) continue;
          const x = r * Math.cos(a);
          const z = stand.cz + stand.dir * r * Math.sin(a);
          out.push({ x, y, z, yaw: Math.atan2(-x, stand.cz - z), row, u });
        }
      }
    }
    return out;
  }

  const EST = -Math.PI / 2; // guarda verso ovest (dal lato est verso il campo)
  const OVEST = Math.PI / 2;

  // Blocchi dei sestieri sull'erba ai lati dell'otto: rettangoli centro (cx, cz), w lungo X, d lungo Z.
  const blocchi = [
    { sestiere: 'piazzarola', cx: -26, cz: -30, w: 10, d: 9, yaw: OVEST },
    { sestiere: 'maggiore', cx: -25, cz: -9, w: 8, d: 8, yaw: OVEST },
    { sestiere: 'romana', cx: -26, cz: 12, w: 10, d: 9, yaw: OVEST },
    { sestiere: 'solesta', cx: 26, cz: -30, w: 10, d: 9, yaw: EST },
    { sestiere: 'tufilla', cx: 26, cz: -9, w: 10, d: 9, yaw: EST },
    { sestiere: 'emidio', cx: 26, cz: 12, w: 10, d: 9, yaw: EST },
  ];

  const mossiere = tr.offsetAt(0, -5.5);

  Q.LAYOUT = {
    arena,
    stands,
    seats,
    blocchi,
    // Palco del Magnifico Messere: pedana rialzata sul lato ovest, guarda a est verso il Moro.
    palco: { cx: -36.5, cz: tr.P.z, w: 6, d: 12, h: 1.6, yaw: OVEST },
    // Propilei bianchi d'ingresso al centro della curva nord.
    propilei: { x: 0, z: -50 - 43 - 4, apertura: 7, yaw: 0 },
    // Sbandieratori dentro la goccia sud, musici del Comune dentro la goccia nord.
    sbandieratori: { cx: tr.S.x, cz: tr.S.z, r: 13 },
    musici: { cx: tr.N.x, cz: tr.N.z, r: 9 },
    giudici: { x: 0, z: tr.P.z + 17, yaw: Math.PI },
    mossiere: { x: mossiere.x, z: mossiere.z, yaw: Math.atan2(-tr.uA.z, tr.uA.x) },
    // Fuori dall'arena (solo scenografia)
    forteMalatesta: { x: -120, z: -135 },
    sanVittore: { x: 105, z: 120 },

    insideArena(x, z, margin) {
      const m = margin || 0;
      if (Math.abs(z) <= arena.straightHalfZ) return Math.abs(x) <= arena.halfX - m;
      const dz = Math.abs(z) - arena.straightHalfZ;
      return Math.hypot(x, dz) <= arena.capR - m;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
