(function (root) {
  const Q = (root.Q = root.Q || {});

  // Ogni tipo di figura è un'unica geometria disegnata con un InstancedMesh. L'attributo "slot" di ogni
  // vertice sceglie il colore: 0 = colore fisso del vertice, 1..5 = colori d'istanza colA..colE
  // (A e B = colori del costume, C = cappello o accento, D = capelli, E = pelle).
  const SA = 1, SB = 2, SC = 3, SH = 4, SK = 5;
  const W = '#ffffff';
  const SHOE = '#3b2a1d';
  const STEEL = '#626a73';
  const STEEL_D = '#3b4148';
  const WOOD = '#7a5a38';
  const GOLD = '#d9ae3c';
  const ERMINE = '#f3f0e8';

  const SKINS = ['#f0c8a8', '#e8b896', '#dca684', '#c98f68', '#b07a56'];
  const HAIRS = ['#2a1d14', '#4a3020', '#1a1410', '#6b4a2a', '#a07840', '#8a8580', '#3a2818'];
  const SHIRTS = ['#f4f4f0', '#f4f4f0', '#ecebe4', '#ffffff', '#2b3a5c', '#c8141c', '#3a78c8', '#f2c40f', '#e57aa0', '#7cc4e4', '#202020', '#6aa84f', '#f08030', '#a8a8a8', '#d8c8a0', '#9a2a4a'];
  const PANTS = ['#2c4a78', '#3a5a90', '#22324e', '#d8c8a8', '#1e1e1e', '#f0f0f0', '#6b6b5a', '#8a6a4a', '#c0b090'];
  const HATS = ['#f4f4f0', '#c8141c', '#2b3a5c', '#e8d8a0', '#f2c40f', '#ffffff'];
  // Spicchi della curva sud da est a ovest, vicini ai blocchi dello stesso lato.
  const TIFO_ORDER = ['emidio', 'tufilla', 'solesta', 'piazzarola', 'maggiore', 'romana'];

  const UP = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _col = new THREE.Color();

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

  function xf(x, y, z, o) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _q.setFromEuler(_e);
    _s.set(o.sx || 1, o.sy || 1, o.sz || 1);
    return _m.compose(_v.set(x, y, z), _q, _s);
  }

  // Accumula primitive trasformate in un'unica geometria non indicizzata.
  function Kit() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.s = [];
  }
  Kit.prototype.add = function (geo, m, color, slot) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    _col.set(color);
    for (let i = 0; i < pa.length; i += 3) {
      this.p.push(pa[i], pa[i + 1], pa[i + 2]);
      this.n.push(na[i], na[i + 1], na[i + 2]);
      this.c.push(_col.r, _col.g, _col.b);
      this.s.push(slot);
    }
    return this;
  };
  Kit.prototype.box = function (w, h, d, x, y, z, col, slot, o) {
    return this.add(new THREE.BoxGeometry(w, h, d), xf(x, y, z, o || {}), col, slot);
  };
  Kit.prototype.cyl = function (rt, rb, h, seg, x, y, z, col, slot, o) {
    o = o || {};
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open, o.t0 || 0, o.tl || Math.PI * 2), xf(x, y, z, o), col, slot);
  };
  Kit.prototype.ball = function (r, x, y, z, col, slot, o) {
    o = o || {};
    return this.add(new THREE.SphereGeometry(r, o.ws || 8, o.hs || 6, 0, Math.PI * 2, 0, o.tl || Math.PI), xf(x, y, z, o), col, slot);
  };
  // Parallelepipedo o cilindro steso tra due punti.
  Kit.prototype.between = function (a, b, geo, col, slot) {
    _v2.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _q.setFromUnitVectors(UP, _v2.normalize());
    _m.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    return this.add(geo, _m, col, slot);
  };
  Kit.prototype.limb = function (a, b, t, col, slot) {
    return this.between(a, b, new THREE.BoxGeometry(t, dist(a, b), t), col, slot);
  };
  Kit.prototype.tube = function (a, b, ra, rb, seg, col, slot, open) {
    return this.between(a, b, new THREE.CylinderGeometry(rb, ra, dist(a, b), seg, 1, !!open), col, slot);
  };
  Kit.prototype.geometry = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('slot', new THREE.Float32BufferAttribute(this.s, 1));
    return g;
  };

  function dist(a, b) {
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }

  // --- Pose delle braccia: sd = +1 sinistra (+X locale), -1 destra. Restituiscono [gomito, mano].
  const DRUM_HANDS = [[0.26, 1.13, 0.16], [-0.12, 1.15, 0.2]];
  const DRUM_HITS = [[0.14, 1.0, 0.3], [0.03, 1.0, 0.28]];
  const FLAG_HAND = [-0.26, 1.36, 0.34];
  const BANNER_O = [-0.78, 3.63, 0.15];
  const TR_YAW = -0.6;
  const TR_PITCH = 0.35;
  const TR_D = [Math.sin(TR_YAW) * Math.cos(TR_PITCH), Math.sin(TR_PITCH), Math.cos(TR_YAW) * Math.cos(TR_PITCH)];
  const trAt = (d) => [TR_D[0] * d, 1.6 + TR_D[1] * d, 0.11 + TR_D[2] * d];

  const DOWN = (sd) => [[sd * 0.27, 1.13, -0.01], [sd * 0.285, 0.86, 0.03]];
  const DRUM = (sd) => (sd > 0 ? [[0.29, 1.19, -0.07], DRUM_HANDS[0]] : [[-0.29, 1.19, -0.06], DRUM_HANDS[1]]);
  const TRUMPET = (sd) => (sd > 0 ? [[0.22, 1.3, 0.3], trAt(0.55)] : [[-0.27, 1.26, 0.1], trAt(0.22)]);
  const FLAG = (sd) => (sd > 0 ? [[0.4, 1.13, -0.05], [0.22, 0.98, 0.06]] : [[-0.33, 1.2, 0.1], FLAG_HAND]);
  const HALBERD = (sd) => (sd > 0 ? DOWN(1) : [[-0.29, 1.14, -0.06], [-0.32, 1.12, 0.14]]);
  const BANNER = (sd) => (sd > 0 ? [[0.13, 1.2, 0.22], [-0.23, 1.42, 0.14]] : [[-0.31, 1.17, -0.06], [-0.28, 1.18, 0.14]]);
  const CLASP = (sd) => [[sd * 0.27, 1.14, 0.03], [sd * 0.06, 1.0, 0.24]];

  function arms(k, pose, o) {
    o = o || {};
    for (const sd of [1, -1]) {
      const p = pose(sd);
      const slot = o.slot !== undefined ? o.slot : sd > 0 ? SB : SA;
      const col = o.col || W;
      const t = o.thick || 0.1;
      k.ball(0.072, sd * 0.215, 1.405, 0, col, slot, { ws: 6, hs: 4 });
      k.limb([sd * 0.23, 1.42, 0], p[0], t, col, slot);
      k.limb(p[0], p[1], t * 0.9, col, slot);
      k.box(0.075, 0.085, 0.075, p[1][0], p[1][1], p[1][2], o.hand || W, o.hand ? 0 : SK);
    }
  }

  function head(k, hat) {
    k.cyl(0.05, 0.055, 0.1, 6, 0, 1.49, 0, W, SK);
    k.ball(0.11, 0, 1.62, 0.01, W, SK, { sy: 1.12 });
    k.ball(0.118, 0, 1.64, -0.02, W, SH, { tl: Math.PI * 0.55, rx: -0.5 });
    if (hat === 'beret') k.cyl(0.165, 0.125, 0.09, 9, 0.02, 1.74, -0.01, W, SC, { rz: 0.2 });
  }

  // Calzamaglia bipartita a colori incrociati rispetto alla tunica.
  function legs(k) {
    for (const sd of [1, -1]) {
      k.box(0.12, 0.8, 0.13, sd * 0.095, 0.46, 0, W, sd > 0 ? SB : SA);
      k.box(0.12, 0.08, 0.23, sd * 0.095, 0.04, 0.035, SHOE, 0);
    }
  }

  function tunic(k) {
    for (const sd of [1, -1]) {
      const o = { t0: sd > 0 ? 0 : Math.PI, tl: Math.PI };
      const slot = sd > 0 ? SA : SB;
      k.cyl(0.2, 0.16, 0.52, 6, 0, 1.2, 0, W, slot, Object.assign({ sz: 0.62 }, o));
      k.cyl(0.17, 0.24, 0.3, 6, 0, 0.83, 0, W, slot, Object.assign({ sz: 0.75, open: true }, o));
    }
    k.cyl(0.172, 0.172, 0.05, 8, 0, 0.96, 0, SHOE, 0, { sz: 0.64 });
  }

  function kBase(pose) {
    const k = new Kit();
    legs(k);
    tunic(k);
    arms(k, pose || DOWN);
    head(k, 'beret');
    return k;
  }

  function kTamburino() {
    const k = kBase(DRUM);
    const ax = [0, Math.cos(0.4), Math.sin(0.4)];
    const c = [0.08, 0.86, 0.22];
    k.cyl(0.175, 0.175, 0.31, 10, c[0], c[1], c[2], '#efe8d8', 0, { rx: 0.4 });
    k.cyl(0.19, 0.19, 0.26, 10, c[0], c[1], c[2], W, SA, { rx: 0.4, open: true });
    for (const sg of [1, -1]) {
      k.cyl(0.198, 0.198, 0.04, 10, c[0], c[1] + sg * ax[1] * 0.135, c[2] + sg * ax[2] * 0.135, W, SB, { rx: 0.4, open: true });
    }
    k.limb([-0.15, 1.4, 0.11], [0.12, 1.0, 0.14], 0.045, '#ece4d4', 0);
    return k;
  }

  function kChiarina() {
    const k = kBase(TRUMPET);
    const end = trAt(1.15);
    k.tube(trAt(0), end, 0.016, 0.016, 5, GOLD, 0);
    k.tube(end, trAt(1.31), 0.022, 0.085, 8, GOLD, 0, true);
    // drappella bipartita appesa alla tromba
    const p1 = trAt(0.68);
    const p2 = trAt(0.9);
    k.box(0.015, 0.42, 0.22, p1[0], p1[1] - 0.22, p1[2], W, SA, { ry: TR_YAW });
    k.box(0.015, 0.42, 0.22, p2[0], p2[1] - 0.22, p2[2], W, SB, { ry: TR_YAW });
    return k;
  }

  function kSbandieratore() {
    return kBase(FLAG);
  }

  function kGonfaloniere() {
    const k = kBase(BANNER);
    k.cyl(0.24, 0.32, 0.6, 8, 0, 1.15, -0.01, W, SC, { t0: Math.PI / 2, tl: Math.PI, open: true, sz: 0.8 });
    k.tube([-0.28, 0, 0.15], [-0.28, 3.78, 0.15], 0.025, 0.022, 6, WOOD, 0);
    k.tube([BANNER_O[0] - 0.02, 3.65, 0.15], [0.24, 3.65, 0.15], 0.018, 0.018, 5, WOOD, 0);
    k.ball(0.05, -0.28, 3.82, 0.15, GOLD, 0, { ws: 6, hs: 4 });
    return k;
  }

  function kArmigero(pike) {
    const k = new Kit();
    for (const sd of [1, -1]) {
      k.box(0.13, 0.46, 0.16, sd * 0.095, 0.23, 0.01, STEEL_D, 0);
      k.box(0.125, 0.42, 0.135, sd * 0.095, 0.66, 0, W, sd > 0 ? SB : SA);
      k.ball(0.1, sd * 0.24, 1.41, 0, STEEL, 0, { ws: 6, hs: 4, sy: 0.8 });
    }
    k.cyl(0.235, 0.19, 0.55, 8, 0, 1.18, 0.01, STEEL, 0, { sz: 0.68 });
    k.cyl(0.2, 0.26, 0.26, 8, 0, 0.84, 0.01, STEEL_D, 0, { sz: 0.75, open: true });
    k.box(0.07, 0.16, 0.02, 0.035, 1.2, 0.16, W, SA);
    k.box(0.07, 0.16, 0.02, -0.035, 1.2, 0.16, W, SB);
    arms(k, HALBERD, { col: STEEL_D, slot: 0, hand: STEEL_D, thick: 0.11 });
    head(k, null);
    k.cyl(0.125, 0.13, 0.13, 8, 0, 1.72, -0.005, STEEL, 0);
    k.cyl(0.2, 0.2, 0.02, 10, 0, 1.665, 0, STEEL, 0);
    k.box(0.04, 0.2, 0.16, 0, 1.87, -0.03, W, SC);
    const x = -0.32, z = 0.14;
    if (pike) {
      k.tube([x, 0.02, z], [x, 3.3, z], 0.02, 0.018, 5, WOOD, 0);
      k.tube([x, 3.3, z], [x, 3.55, z], 0.035, 0.002, 5, STEEL, 0);
      // pennoncello bipartito
      k.box(0.22, 0.18, 0.012, x - 0.12, 3.12, z, W, SA);
      k.box(0.22, 0.18, 0.012, x - 0.34, 3.12, z, W, SB);
    } else {
      k.tube([x, 0.02, z], [x, 2.25, z], 0.02, 0.018, 5, WOOD, 0);
      k.tube([x, 2.25, z], [x, 2.52, z], 0.03, 0.002, 5, STEEL, 0);
      k.box(0.02, 0.24, 0.2, x, 2.05, z + 0.11, STEEL, 0);
      k.box(0.02, 0.06, 0.12, x, 2.08, z - 0.08, STEEL, 0);
    }
    return k;
  }

  function kDama() {
    const k = new Kit();
    k.cyl(0.19, 0.4, 1.02, 10, 0, 0.51, 0, W, SA);
    k.cyl(0.175, 0.15, 0.46, 8, 0, 1.22, 0, W, SA, { sz: 0.66 });
    k.box(0.15, 0.42, 0.03, 0, 1.2, 0.105, W, SB);
    arms(k, CLASP, { slot: SB, thick: 0.115 });
    head(k, null);
    k.ball(0.075, 0, 1.6, -0.11, W, SH, { ws: 6, hs: 4 });
    k.cyl(0.135, 0.125, 0.07, 10, 0, 1.725, -0.01, W, SB);
    // velo che scende dal copricapo e incornicia il viso
    k.cyl(0.14, 0.21, 0.46, 10, 0, 1.52, -0.01, W, SC, { t0: Math.PI * 0.35, tl: Math.PI * 1.3, open: true });
    return k;
  }

  function kAnziano(messere) {
    const k = new Kit();
    for (const sd of [1, -1]) k.box(0.11, 0.07, 0.22, sd * 0.09, 0.035, 0.12, SHOE, 0);
    k.cyl(0.2, 0.3, 1.42, 10, 0, 0.76, 0, W, SA, { sz: 0.8 });
    k.cyl(0.25, 0.4, 1.34, 10, 0, 0.8, -0.02, W, SB, { t0: Math.PI / 2 - 0.2, tl: Math.PI + 0.4, open: true, sz: 0.85 });
    if (messere) {
      k.cyl(0.26, 0.31, 0.22, 12, 0, 1.36, 0, ERMINE, 0, { sz: 0.84 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.box(0.025, 0.05, 0.025, Math.sin(a) * 0.29, 1.33 + (i % 2) * 0.06, Math.cos(a) * 0.29 * 0.84, '#151515', 0);
      }
      k.limb([0.14, 1.3, 0.19], [0, 1.18, 0.215], 0.02, GOLD, 0);
      k.limb([-0.14, 1.3, 0.19], [0, 1.18, 0.215], 0.02, GOLD, 0);
      k.cyl(0.05, 0.05, 0.02, 10, 0, 1.15, 0.22, GOLD, 0, { rx: Math.PI / 2 });
    } else {
      k.cyl(0.235, 0.255, 0.08, 10, 0, 1.43, 0, W, SB, { sz: 0.82 });
    }
    arms(k, CLASP, { slot: SA, thick: 0.13 });
    head(k, null);
    k.cyl(0.12, 0.125, 0.17, 9, 0, 1.79, -0.01, W, SC);
    return k;
  }

  // Spettatore seduto: piedi sul gradone (origine), bacino sul bordo del gradone successivo.
  function kSeduto() {
    const k = new Kit();
    k.box(0.3, 0.07, 0.2, 0, 0.035, 0.03, SHOE, 0);
    k.box(0.28, 0.44, 0.13, 0, 0.26, -0.05, W, SC);
    k.box(0.3, 0.14, 0.5, 0, 0.52, -0.3, W, SC);
    k.box(0.19, 0.55, 0.22, 0.095, 0.86, -0.56, W, SA, { rx: 0.08 });
    k.box(0.19, 0.55, 0.22, -0.095, 0.86, -0.56, W, SB, { rx: 0.08 });
    for (const sd of [1, -1]) {
      k.limb([sd * 0.22, 1.08, -0.55], [sd * 0.24, 0.78, -0.47], 0.09, W, sd > 0 ? SA : SB);
      k.limb([sd * 0.24, 0.78, -0.47], [sd * 0.14, 0.66, -0.22], 0.075, W, SK);
    }
    k.ball(0.11, 0, 1.27, -0.52, W, SK, { ws: 6, hs: 4, sy: 1.1 });
    k.ball(0.118, 0, 1.29, -0.545, W, SH, { ws: 6, hs: 3, tl: Math.PI * 0.55, rx: -0.4 });
    return k;
  }

  // Seduto per la grafica leggera: 5 parallelepipedi, 60 triangoli invece di 174.
  function kSedutoLite() {
    const k = new Kit();
    k.box(0.3, 0.16, 0.5, 0, 0.52, -0.3, W, SC);
    k.box(0.2, 0.6, 0.24, 0.1, 0.88, -0.56, W, SA, { rx: 0.08 });
    k.box(0.2, 0.6, 0.24, -0.1, 0.88, -0.56, W, SB, { rx: 0.08 });
    k.box(0.19, 0.23, 0.2, 0, 1.28, -0.52, W, SK);
    k.box(0.21, 0.07, 0.22, 0, 1.41, -0.54, W, SH);
    return k;
  }

  function figMaterial(side) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float slot;\nattribute vec3 colA;\nattribute vec3 colB;\nattribute vec3 colC;\nattribute vec3 colD;\nattribute vec3 colE;')
        .replace('#include <color_vertex>', 'vColor = color;\nif (slot > 0.5) vColor *= slot < 1.5 ? colA : slot < 2.5 ? colB : slot < 3.5 ? colC : slot < 4.5 ? colD : colE;');
    };
    m.customProgramCacheKey = () => 'figuranti-slot';
    return m;
  }

  function figMatrix(r, jy, out) {
    _q.setFromAxisAngle(UP, r.yaw);
    return (out || _m).compose(_v.set(r.x, r.y + jy, r.z), _q, _s.setScalar(r.s));
  }

  // recs: [{x, y, z, yaw, s, cols: [[r,g,b] x 5]}]
  function instanced(geo, recs, material, name) {
    const n = recs.length;
    const g = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'color', 'slot']) g.setAttribute(key, geo.attributes[key]);
    ['colA', 'colB', 'colC', 'colD', 'colE'].forEach((key, j) => {
      const a = new Float32Array(n * 3);
      recs.forEach((r, i) => a.set(r.cols[j], i * 3));
      g.setAttribute(key, new THREE.InstancedBufferAttribute(a, 3));
    });
    const mesh = new THREE.InstancedMesh(g, material, n);
    recs.forEach((r, i) => mesh.setMatrixAt(i, figMatrix(r, 0)));
    // r149 non calcola i limiti delle istanze: il culling userebbe solo la geometria base.
    mesh.frustumCulled = false;
    mesh.name = name;
    return mesh;
  }

  // --- Bandiere: atlante 1024x256, riquadri di 128 px. Riga 0 bandiere degli sbandieratori
  // (sestieri 0..5, Comune 6), riga 1 stendardi (sestieri 0..5, Palio 6).
  function atlas() {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 256;
    const g = cv.getContext('2d');
    Q.SESTIERI.forEach((s, i) => {
      flagTile(g, i * 128, 0, s.c1, s.c2);
      bannerTile(g, i * 128, 128, s.c1, s.c2);
    });
    const cm = Q.COMUNE;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i === 0 || i === 3 ? cm.c1 : cm.c2;
      g.fillRect(768 + (i % 2) * 64, Math.floor(i / 2) * 64, 64, 64);
    }
    palioTile(g, 768, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  function flagTile(g, x, y, c1, c2) {
    g.fillStyle = c1;
    g.fillRect(x, y, 128, 128);
    g.fillStyle = c2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 128, y);
    g.lineTo(x, y + 128);
    g.fill();
    // disco centrale a colori invertiti
    g.fillStyle = c1;
    g.beginPath();
    g.arc(x + 64, y + 64, 28, Math.PI * 0.75, Math.PI * 1.75);
    g.fill();
    g.fillStyle = c2;
    g.beginPath();
    g.arc(x + 64, y + 64, 28, -Math.PI * 0.25, Math.PI * 0.75);
    g.fill();
  }

  function bannerTile(g, x, y, c1, c2) {
    g.save();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 128, y);
    const pts = [[128, 100], [107, 126], [85, 100], [64, 126], [43, 100], [21, 126], [0, 100]];
    pts.forEach((p) => g.lineTo(x + p[0], y + p[1]));
    g.closePath();
    g.clip();
    g.fillStyle = c1;
    g.fillRect(x, y, 64, 128);
    g.fillStyle = c2;
    g.fillRect(x + 64, y, 64, 128);
    g.fillStyle = c2;
    g.beginPath();
    g.arc(x + 64, y + 50, 20, Math.PI / 2, Math.PI * 1.5);
    g.fill();
    g.fillStyle = c1;
    g.beginPath();
    g.arc(x + 64, y + 50, 20, -Math.PI / 2, Math.PI / 2);
    g.fill();
    g.strokeStyle = GOLD;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(x + 64, y + 50, 21, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 10;
    g.stroke(pathOf(x, y, pts));
    g.restore();
  }

  function pathOf(x, y, pts) {
    const p = new Path2D();
    p.moveTo(x, y);
    p.lineTo(x + 128, y);
    pts.forEach((q) => p.lineTo(x + q[0], y + q[1]));
    p.closePath();
    return p;
  }

  // Palio dipinto: cornice dorata, campo rosso, santo con aureola su fondo chiaro.
  function palioTile(g, x, y) {
    g.fillStyle = GOLD;
    g.fillRect(x, y, 128, 128);
    g.fillStyle = '#a3121c';
    g.fillRect(x + 6, y + 6, 116, 116);
    g.fillStyle = '#efe2c0';
    g.beginPath();
    g.moveTo(x + 24, y + 112);
    g.lineTo(x + 24, y + 40);
    g.arc(x + 64, y + 40, 40, Math.PI, 0);
    g.lineTo(x + 104, y + 112);
    g.fill();
    g.fillStyle = GOLD;
    g.beginPath();
    g.arc(x + 64, y + 36, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2c4c9c';
    g.beginPath();
    g.moveTo(x + 64, y + 44);
    g.lineTo(x + 42, y + 108);
    g.lineTo(x + 86, y + 108);
    g.fill();
    g.fillStyle = '#e8b896';
    g.beginPath();
    g.arc(x + 64, y + 38, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f4f0e0';
    g.fillRect(x + 58, y + 50, 12, 6);
  }

  const NU = 6;
  const NV = 5;
  const NVERT = (NU + 1) * (NV + 1);

  function flagMesh(flags, tex) {
    const n = flags.length;
    const pos = new Float32Array(n * NVERT * 3);
    const uv = new Float32Array(n * NVERT * 2);
    const idx = [];
    flags.forEach((f, k) => {
      const u0 = (f.tile[0] * 128 + 2) / 1024;
      const u1 = (f.tile[0] * 128 + 126) / 1024;
      const v0 = 1 - (f.tile[1] * 128 + 2) / 256;
      const v1 = 1 - (f.tile[1] * 128 + 126) / 256;
      for (let j = 0; j <= NV; j++) {
        for (let i = 0; i <= NU; i++) {
          const o = (k * NVERT + j * (NU + 1) + i) * 2;
          uv[o] = u0 + ((u1 - u0) * i) / NU;
          uv[o + 1] = v0 + ((v1 - v0) * j) / NV;
        }
      }
      for (let j = 0; j < NV; j++) {
        for (let i = 0; i < NU; i++) {
          const a = k * NVERT + j * (NU + 1) + i;
          idx.push(a, a + 1, a + NU + 1, a + 1, a + NU + 2, a + NU + 1);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 }));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.name = 'bandiere';
    return mesh;
  }

  // Telo su griglia: O = angolo in alto all'asta, U = verso il lembo libero, V = verso il basso,
  // N = U x V. Il vertice è spostato di w(u, v) lungo N; con U e V ortonormali la normale
  // della superficie è N - U * (dw/du) / larghezza - V * (dw/dv) / altezza.
  function writeFlag(pos, nor, k, f, t) {
    let o = k * NVERT * 3;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        let w, wu, wv;
        if (f.kind === 'flag') {
          const a = 5.5 * u - 9 * t + f.ph;
          const b = 7 * v - 6 * t;
          const sa = Math.sin(a);
          const sb = Math.sin(b);
          w = f.amp * u * sa + 0.04 * u * v * sb;
          wu = f.amp * (sa + 5.5 * u * Math.cos(a)) + 0.04 * v * sb;
          wv = 0.04 * u * (sb + 7 * v * Math.cos(b));
        } else {
          const c = 3 * v + 2 * u - 2.2 * t + f.ph;
          const sc = Math.sin(c);
          const cc = Math.cos(c);
          w = f.amp * v * sc;
          wu = 2 * f.amp * v * cc;
          wv = f.amp * (sc + 3 * v * cc);
        }
        const du = u * f.w;
        const dv = v * f.h;
        const gu = wu / f.w;
        const gv = wv / f.h;
        const nx = f.N.x - f.U.x * gu - f.V.x * gv;
        const ny = f.N.y - f.U.y * gu - f.V.y * gv;
        const nz = f.N.z - f.U.z * gu - f.V.z * gv;
        const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nor[o] = nx * il;
        nor[o + 1] = ny * il;
        nor[o + 2] = nz * il;
        pos[o++] = f.O.x + f.U.x * du + f.V.x * dv + f.N.x * w;
        pos[o++] = f.O.y + f.U.y * du + f.V.y * dv + f.N.y * w;
        pos[o++] = f.O.z + f.U.z * du + f.V.z * dv + f.N.z * w;
      }
    }
  }

  const smooth = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  const THROW = 2.0; // durata di un lancio della bandiera (s)
  const THROW_H = 5.0; // altezza del lancio (m)
  const PERIOD = 9.0; // un lancio ogni PERIOD secondi per gli sbandieratori dell'esibizione

  function build(scene, opts) {
    const L = Q.LAYOUT;
    const tr = Q.track;
    const player = (opts && opts.playerSestiereId) || null;
    const lite = !!(opts && opts.lite);
    const rnd = rng(20240);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const jit = (a) => (rnd() - 0.5) * 2 * a;
    const group = new THREE.Group();
    group.name = 'figuranti';
    scene.add(group);

    const kits = {
      base: kBase(),
      tamburino: kTamburino(),
      chiarina: kChiarina(),
      sbandieratore: kSbandieratore(),
      gonfaloniere: kGonfaloniere(),
      armigero: kArmigero(false),
      picchiere: kArmigero(true),
      dama: kDama(),
      anziano: kAnziano(false),
      messere: kAnziano(true),
    };
    const recs = {};
    for (const k in kits) recs[k] = [];
    const exc = {};
    const pauseUntil = {};
    const drumPhase = {};
    let now = 0;

    function tone(hex, k) {
      _col.set(hex);
      return [_col.r * k, _col.g * k, _col.b * k];
    }
    function cols(a, b, c, hair, skin) {
      const k = 0.94 + rnd() * 0.1;
      return [tone(a, k), tone(b, k), tone(c, k), tone(hair || pick(HAIRS), 1), tone(skin || pick(SKINS), 1)];
    }
    function put(type, x, y, z, yaw, c, o) {
      o = o || {};
      const r = { x, y, z, yaw, s: o.s || 1, cols: c, grp: o.grp || 'campo', jump: !!o.jump, ph: rnd() * 6.283, jy: 0 };
      recs[type].push(r);
      return r;
    }
    // (lx, lz) nel riferimento di un rettangolo ruotato di yaw: lz verso il fronte.
    function local(fr, lx, lz) {
      const c = Math.cos(fr.yaw);
      const s = Math.sin(fr.yaw);
      return { x: fr.cx + lx * c + lz * s, z: fr.cz - lx * s + lz * c };
    }
    function extent(fr, w, d) {
      const fx = Math.abs(Math.sin(fr.yaw));
      const fz = Math.abs(Math.cos(fr.yaw));
      return { depth: fx * w + fz * d, across: fz * w + fx * d };
    }

    const flags = [];
    const sband = [];
    const drums = [];
    const vec = () => new THREE.Vector3();
    function banner(rec, lo, w, h, tile, amp) {
      flags.push({ kind: 'banner', rec, lo: new THREE.Vector3().fromArray(lo), w, h, tile, amp, ph: rnd() * 6.283, O: vec(), U: vec(), V: vec(), N: vec() });
    }
    function flagger(rec, tile, show, first) {
      const fl = { kind: 'flag', w: 1.25, h: 1.2, tile, amp: 0.12, ph: rnd() * 6.283, O: vec(), U: vec(), V: vec(), N: vec() };
      flags.push(fl);
      sband.push({ rec, fl, show, next: first, t0: -99, a: rnd() * 6.283, b: vec(), prev: vec(), has: false });
    }
    function drummer(rec) {
      drums.push({ rec, ph: rnd() * 0.5 });
    }

    // 1. Blocchi dei sestieri: sei ranghi dal fronte (lato pista) verso il fondo.
    L.blocchi.forEach((b) => {
      const s = Q.sestiere(b.sestiere);
      const si = Q.SESTIERI.indexOf(s);
      const fr = { cx: b.cx, cz: b.cz, yaw: b.yaw };
      const ex = extent(fr, b.w, b.d);
      const step = (ex.depth - 1.2) / 5;
      const slot = (k, n, maxSp, i) => [(i - (n - 1) / 2) * Math.min(maxSp, (ex.across - 1.2) / (n - 1)), ex.depth / 2 - 0.6 - k * step];
      const at = (type, p, c, sc) => {
        const q = local(fr, p[0] + jit(0.08), p[1] + jit(0.08));
        return put(type, q.x, 0, q.z, b.yaw + jit(0.06), c, { grp: s.id, jump: true, s: sc });
      };
      for (let i = 0; i < 4; i++) flagger(at('sbandieratore', slot(0, 4, 2.3, i), cols(s.c1, s.c2, s.c2)), [si, 0], false, Infinity);
      ['paggio', 'dama', 'gonfaloniere', 'console', 'dama', 'paggio'].forEach((role, i) => {
        const p = slot(1, 6, 1.35, i);
        if (role === 'paggio') at('base', p, cols(s.c2, s.c1, s.c1), 0.8);
        else if (role === 'dama') at('dama', p, cols(s.c1, s.c2, '#f2efe6'));
        else if (role === 'console') at('anziano', p, cols(s.c1, s.c2, '#1c1c1c'));
        else banner(at('gonfaloniere', p, cols(s.c1, s.c2, s.c2)), BANNER_O, 1.0, 1.65, [si, 1], 0.06);
      });
      for (let i = 0; i < 6; i++) drummer(at('tamburino', slot(2, 6, 1.25, i), cols(s.c1, s.c2, s.c2)));
      for (let i = 0; i < 6; i++) {
        const p = slot(3, 6, 1.3, i);
        if (i === 0 || i === 5) at('base', p, cols(s.c2, s.c1, s.c1), 0.8);
        else at('chiarina', p, cols(s.c1, s.c2, s.c2));
      }
      for (let k = 4; k <= 5; k++) for (let i = 0; i < 4; i++) at('armigero', slot(k, 4, 1.8, i), cols(s.c1, s.c2, s.c1));
    });

    // 2. Gruppo comunale: palco, armigeri ai lati, musici nella goccia nord.
    const cm = Q.COMUNE;
    const pc = L.palco;
    const pf = { cx: pc.cx, cz: pc.cz, yaw: pc.yaw };
    const atP = (type, lx, lz, c, sc) => {
      const q = local(pf, lx, lz);
      return put(type, q.x, pc.h, q.z, pc.yaw, c, { grp: 'palco', s: sc });
    };
    atP('messere', 0, 1.2, cols('#b3101a', '#8e0c14', '#b3101a', '#8a8580'), 1.06);
    [-2.6, -1.4, 1.4, 2.6].forEach((lx, i) => atP('anziano', lx, 0.7, cols(i % 2 ? '#5a1418' : '#1e1e22', i % 2 ? '#1e1e22' : '#6a1a1e', '#18181a', pick(['#8a8580', '#4a3020']))));
    [-4.8, -3.8].forEach((lx) => atP('dama', lx, 0.7, cols(cm.c1, cm.c2, '#f2efe6')));
    [3.8, 5.2].forEach((lx) => atP('base', lx, 0.7, cols(cm.c1, cm.c2, cm.c1), 0.82));
    const palioPos = local(pf, 4.5, 0.3);
    banner({ x: palioPos.x, y: pc.h, z: palioPos.z, yaw: pc.yaw, s: 1, jy: 0 }, [-0.5, 2.93, 0.04], 1.0, 1.9, [6, 1], 0.03);
    const pex = extent(pf, pc.w, pc.d);
    for (const sd of [1, -1]) {
      for (const lz of [2.0, 0.8, -0.4]) {
        const q = local(pf, sd * (pex.across / 2 + 0.9), lz);
        put('armigero', q.x, 0, q.z, pc.yaw, cols(cm.c1, cm.c2, cm.c2), { grp: 'palco' });
      }
    }
    const mf = { cx: L.musici.cx, cz: L.musici.cz, yaw: 0 };
    for (let i = 0; i < 6; i++) {
      const q = local(mf, (i - 2.5) * 1.2, 1.0);
      drummer(put('tamburino', q.x, 0, q.z, mf.yaw, cols(cm.c2, cm.c1, cm.c1), { grp: 'comune', jump: true }));
    }
    for (let i = 0; i < 4; i++) {
      const q = local(mf, (i - 1.5) * 1.3, -0.6);
      put('chiarina', q.x, 0, q.z, mf.yaw, cols(cm.c2, cm.c1, cm.c1), { grp: 'comune', jump: true });
    }

    // 3. Esibizione: 12 sbandieratori in cerchio, a coppie per sestiere, rivolti verso l'esterno.
    const sb = L.sbandieratori;
    const ringR = sb.r * 0.7;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      const s = Q.SESTIERI[i >> 1];
      const x = sb.cx + ringR * Math.cos(a);
      const z = sb.cz + ringR * Math.sin(a);
      const r = put('sbandieratore', x, 0, z, Math.atan2(Math.cos(a), Math.sin(a)), cols(s.c1, s.c2, s.c2), { grp: 'show' });
      flagger(r, [i >> 1, 0], true, 0.8 + (i >> 1) * 1.5);
    }

    // 4. Mossiere, giudici al tavolo, valletti dietro al Moro (sull'asse della goccia, fuori pista).
    put('anziano', L.mossiere.x, 0, L.mossiere.z, L.mossiere.yaw, cols('#1c1c1e', cm.c1, cm.c1));
    const gj = L.giudici;
    const gf = { cx: gj.x, cz: gj.z, yaw: gj.yaw };
    [-0.9, 0, 0.9].forEach((lx) => {
      const q = local(gf, lx, -0.25);
      put('anziano', q.x, 0, q.z, gj.yaw, cols(pick(['#262a33', '#2e2a26', '#1a1a1c']), '#141414', '#141414'));
    });
    for (const sd of [1, -1]) put('base', tr.P.x + sd * 0.9, 0, tr.P.z + 12.5, Math.PI, cols(cm.c1, cm.c2, cm.c1), { s: 0.85 });

    // 5. Armigeri di guardia lungo il perimetro interno, partendo simmetrici dai propilei (punta nord).
    const ar = L.arena;
    const R = ar.capR - 3;
    const hz = ar.straightHalfZ;
    const per = 4 * hz + 2 * Math.PI * R;
    const nG = Math.round(per / 12);
    const perim = (d) => {
      const q = (Math.PI * R) / 2;
      if (d < q) return [R * Math.sin(d / R), -hz - R * Math.cos(d / R)];
      d -= q;
      if (d < 2 * hz) return [R, -hz + d];
      d -= 2 * hz;
      if (d < Math.PI * R) return [R * Math.cos(d / R), hz + R * Math.sin(d / R)];
      d -= Math.PI * R;
      if (d < 2 * hz) return [-R, hz - d];
      d -= 2 * hz;
      return [-R * Math.cos(d / R), -hz - R * Math.sin(d / R)];
    };
    for (let i = 0; i < nG; i++) {
      const p = perim(((i + 0.5) * per) / nG);
      if (p[0] < pc.cx + pc.w && Math.abs(p[1] - pc.cz) < pex.across / 2 + 4.5) continue;
      const tz = Math.max(-hz, Math.min(hz, p[1]));
      put('picchiere', p[0], 0, p[1], Math.atan2(-p[0], tz - p[1]), cols(cm.c1, cm.c2, cm.c2));
    }

    const matFig = figMaterial(THREE.DoubleSide);
    const field = [];
    for (const name in kits) {
      const geo = kits[name].geometry();
      if (!recs[name].length) continue;
      const mesh = instanced(geo, recs[name], matFig, 'fig-' + name);
      mesh.castShadow = !lite;
      group.add(mesh);
      field.push({ mesh, recs: recs[name] });
    }

    // Aste animate: bacchette dei tamburini e aste degli sbandieratori.
    const nAste = drums.length * 2 + sband.length;
    const aste = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), nAste);
    aste.frustumCulled = false;
    aste.name = 'aste';
    for (let i = 0; i < nAste; i++) aste.setColorAt(i, _col.set(i < drums.length * 2 ? '#e9dcc0' : '#f0ead8'));
    group.add(aste);

    const flagM = flagMesh(flags, atlas());
    flagM.castShadow = !lite;
    group.add(flagM);
    const flagPos = flagM.geometry.attributes.position;
    const flagNor = flagM.geometry.attributes.normal;

    // Oggetti fissi: tavolo dei giudici e asta del Palio.
    const props = new Kit();
    const tp = local(gf, 0, 0.45);
    props.box(2.6, 0.06, 0.8, tp.x, 0.76, tp.z, '#6b4a2c', 0, { ry: gj.yaw });
    for (const sd of [1, -1]) {
      const q = local(gf, sd * 0.65, 0.86);
      props.box(1.3, 0.66, 0.02, q.x, 0.42, q.z, sd > 0 ? cm.c2 : cm.c1, 0, { ry: gj.yaw });
      const lq = local(gf, sd * 1.22, 0.1);
      props.box(0.06, 0.74, 0.06, lq.x, 0.37, lq.z, '#4a3420', 0);
    }
    const bar = [local(pf, 3.95, 0.3), local(pf, 5.05, 0.3)];
    props.box(0.4, 0.08, 0.4, palioPos.x, pc.h + 0.04, palioPos.z, '#4a3420', 0, { ry: pc.yaw });
    props.tube([palioPos.x, pc.h, palioPos.z], [palioPos.x, pc.h + 3.0, palioPos.z], 0.025, 0.022, 6, WOOD, 0);
    props.tube([bar[0].x, pc.h + 2.95, bar[0].z], [bar[1].x, pc.h + 2.95, bar[1].z], 0.018, 0.018, 5, WOOD, 0);
    props.ball(0.05, palioPos.x, pc.h + 3.04, palioPos.z, GOLD, 0, { ws: 6, hs: 4 });
    const propM = new THREE.Mesh(props.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    propM.castShadow = !lite;
    propM.receiveShadow = true;
    propM.name = 'arredi';
    group.add(propM);

    // 6. Pubblico: tribune 'pubblico' in 4 mesh a fasi alterne, curva dei figuranti in 6 spicchi.
    const seatGeo = (lite ? kSedutoLite() : kSeduto()).geometry();
    const matCrowd = figMaterial(THREE.FrontSide);
    const pub = [[], [], [], []];
    const tifo = TIFO_ORDER.map(() => []);
    for (const st of L.stands) {
      const fig = st.chi === 'figuranti';
      for (const p of L.seats(st, 0.7)) {
        // l'ultima fila non ha un gradone dietro su cui sedersi
        if (p.row === st.rows - 1 || rnd() > (fig ? 0.9 : 0.75)) continue;
        const r = { x: p.x + jit(0.08), y: p.y, z: p.z + jit(0.08), yaw: p.yaw + jit(0.2), s: 0.95 + rnd() * 0.1 };
        if (fig) {
          const k = Math.min(5, Math.floor(p.u * 6));
          const s = Q.sestiere(TIFO_ORDER[k]);
          const v = rnd();
          const a = v < 0.75 ? (v < 0.45 ? s.c1 : s.c2) : v < 0.9 ? s.c1 : s.c2;
          const b2 = v < 0.75 ? (v < 0.45 ? s.c2 : s.c1) : a;
          const hat = rnd() < 0.5 ? (rnd() < 0.6 ? s.c2 : s.c1) : pick(HAIRS);
          r.cols = cols(a, b2, rnd() < 0.5 ? (a === s.c1 ? s.c2 : s.c1) : '#2a2a2a', hat);
          tifo[k].push(r);
        } else {
          const sh = pick(SHIRTS);
          r.cols = cols(sh, sh, pick(PANTS), rnd() < 0.35 ? pick(HATS) : pick(HAIRS));
          pub[Math.floor(rnd() * 4)].push(r);
        }
      }
    }
    const crowd = pub.map((rs, k) => instanced(seatGeo, rs, matCrowd, 'pubblico-' + k));
    const tifoM = tifo.map((rs, k) => {
      const m = instanced(seatGeo, rs, matCrowd, 'tifo-' + TIFO_ORDER[k]);
      m.userData.key = 'tifo-' + TIFO_ORDER[k];
      return m;
    });
    crowd.concat(tifoM).forEach((m) => group.add(m));

    const STICK = [0, 1].map((side) => {
      const h = DRUM_HANDS[side];
      const g = DRUM_HITS[side];
      const d = new THREE.Vector3(g[0] - h[0], g[1] - h[1], g[2] - h[2]).normalize();
      return { hand: new THREE.Vector3().fromArray(h), yaw: Math.atan2(d.x, d.z), pitch: Math.asin(-d.y) };
    });
    const HAND_V = new THREE.Vector3().fromArray(FLAG_HAND);
    const _F = new THREE.Matrix4();
    const _mL = new THREE.Matrix4();
    const _d = vec();
    const _d2 = vec();
    const _b0 = vec();
    const _b1 = vec();
    const _c = vec();
    const _tip = vec();
    const _vel = vec();
    const _back = vec();

    function jump(r, t) {
      if (!r.jump) return 0;
      const e = exc[r.grp] || 0;
      return e < 0.03 ? 0 : e * 0.24 * Math.abs(Math.sin(t * 7.5 + r.ph));
    }

    function updateSband(sb, t, dt, ai) {
      const r = sb.rec;
      const e = exc[r.grp] || 0;
      if (t >= sb.next && t - sb.t0 >= THROW) {
        sb.t0 = t;
        sb.next = sb.show ? t + PERIOD : Infinity;
      }
      sb.a += dt * (sb.show ? 3 : 2.1) * (1 + 0.9 * e);
      const phi = (sb.show ? 1.45 : 1.0) * Math.sin(sb.a);
      const th = 0.3 + 0.25 * Math.sin(2 * sb.a);
      _d.set(-Math.cos(th) * Math.sin(phi), Math.cos(th) * Math.cos(phi), Math.sin(th));
      _b0.copy(_d).multiplyScalar(-0.15).add(HAND_V);
      const k = (t - sb.t0) / THROW;
      if (k >= 0 && k < 1) {
        // lancio: l'asta sale e ricade ruotando nel piano frontale; si raccorda col movimento a terra
        const bl = smooth(0, 0.12, k) * smooth(1, 0.88, k);
        const ang = k * Math.PI * 4;
        _d2.set(-Math.sin(ang), Math.cos(ang), 0.15).normalize();
        _c.copy(HAND_V);
        _c.y += 0.6 + 4 * THROW_H * k * (1 - k);
        _b1.copy(_d2).multiplyScalar(-0.75).add(_c);
        _d.lerp(_d2, bl).normalize();
        _b0.lerp(_b1, bl);
      }
      figMatrix(r, r.jy, _F);
      _b0.applyMatrix4(_F);
      _d.transformDirection(_F);
      _q.setFromUnitVectors(UP, _d);
      aste.setMatrixAt(ai, _mL.compose(_b0, _q, _s.set(0.02 * r.s, 1.5 * r.s, 0.02 * r.s)));

      // il telo segue la punta dell'asta, con una spinta all'indietro che lo fa girare dietro all'asta
      _tip.copy(_d).multiplyScalar(1.5 * r.s).add(_b0);
      _back.set(-Math.sin(r.yaw), 0, -Math.cos(r.yaw));
      if (sb.has) _vel.subVectors(_tip, sb.prev).divideScalar(dt);
      else {
        _vel.set(0, 0, 0);
        sb.b.set(Math.cos(r.yaw), 0, -Math.sin(r.yaw));
      }
      sb.prev.copy(_tip);
      sb.has = true;
      _vel.negate().addScaledVector(_back, 1.5).normalize();
      sb.b.lerp(_vel, 1 - Math.exp(-dt * 7));
      sb.b.addScaledVector(_d, -_d.dot(sb.b));
      if (sb.b.lengthSq() < 1e-6) sb.b.copy(_back).addScaledVector(_d, -_d.dot(_back));
      sb.b.normalize();
      const f = sb.fl;
      f.amp = 0.12 + 0.06 * e;
      f.O.copy(_d).multiplyScalar(1.45 * r.s).add(_b0);
      f.U.copy(sb.b);
      f.V.copy(_d).negate();
      f.N.crossVectors(f.U, f.V);
    }

    function update(dt, t) {
      if (!(dt > 0)) dt = 1 / 60;
      now = t;
      const decay = Math.exp(-dt / 2.2);
      for (const g in exc) exc[g] *= decay;

      for (const F of field) {
        let dirty = false;
        F.recs.forEach((r, i) => {
          const jy = jump(r, t);
          if (jy !== r.jy) {
            r.jy = jy;
            F.mesh.setMatrixAt(i, figMatrix(r, jy));
            dirty = true;
          }
        });
        if (dirty) F.mesh.instanceMatrix.needsUpdate = true;
      }

      const eP = exc.pubblico || 0;
      crowd.forEach((m, k) => (m.position.y = eP * 0.16 * Math.max(0, Math.sin(t * 8.5 + k * 1.571))));
      tifoM.forEach((m, k) => {
        const e = exc[m.userData.key] || 0;
        m.position.y = e * 0.2 * Math.max(0, Math.sin(t * 8 + k * 1.05));
      });

      let ai = 0;
      for (const g in drumPhase) drumPhase[g] += dt * Math.PI * 2 * (1.7 + 1.3 * (exc[g] || 0));
      for (const d of drums) {
        const r = d.rec;
        if (drumPhase[r.grp] === undefined) drumPhase[r.grp] = 0;
        const e = exc[r.grp] || 0;
        const playing = !(t < (pauseUntil[r.grp] || 0));
        figMatrix(r, r.jy, _F);
        for (let side = 0; side < 2; side++) {
          const st = STICK[side];
          const lift = playing ? Math.max(0, Math.sin(drumPhase[r.grp] + d.ph + side * Math.PI)) : 0;
          const p = st.pitch - lift * (0.9 + 0.5 * e);
          _d.set(Math.sin(st.yaw) * Math.cos(p), -Math.sin(p), Math.cos(st.yaw) * Math.cos(p));
          _q.setFromUnitVectors(UP, _d);
          _mL.compose(st.hand, _q, _s.set(0.014, 0.4, 0.014));
          aste.setMatrixAt(ai++, _mL.premultiply(_F));
        }
      }
      for (const sb of sband) updateSband(sb, t, dt, ai++);
      aste.instanceMatrix.needsUpdate = true;

      flags.forEach((f, k) => {
        if (f.kind === 'banner') {
          figMatrix(f.rec, f.rec.jy, _F);
          f.O.copy(f.lo).applyMatrix4(_F);
          f.U.set(1, 0, 0).transformDirection(_F);
          f.V.set(0, -1, 0);
          f.N.crossVectors(f.U, f.V);
        }
        writeFlag(flagPos.array, flagNor.array, k, f, t);
      });
      flagPos.needsUpdate = true;
      flagNor.needsUpdate = true;
    }

    // valori: [pubblico, curva dei figuranti, sestiere del giocatore, altri sestieri e Comune]
    const REACT = {
      via: [0.3, 0.45, 0.6, 0.15],
      centro: [1, 1, 1, 0.5],
      colpo: [0.55, 0.6, 0.8, 0.25],
      arrivo: [0.8, 0.85, 1, 0.45],
    };
    const raise = (g, v) => (exc[g] = Math.max(exc[g] || 0, v));

    function react(kind) {
      if (kind === 'mancato' || kind === 'penalita') {
        exc.pubblico = (exc.pubblico || 0) * 0.3;
        if (player) {
          exc[player] = 0;
          exc['tifo-' + player] = 0;
          pauseUntil[player] = now + 2.5;
        }
        return;
      }
      const v = REACT[kind];
      if (!v) return;
      raise('pubblico', v[0]);
      for (const s of Q.SESTIERI) {
        const mine = s.id === player;
        raise(s.id, mine ? v[2] : v[3]);
        raise('tifo-' + s.id, mine ? v[1] : v[1] * 0.5);
      }
      raise('comune', v[3]);
      if (kind === 'centro' || kind === 'arrivo') {
        // lancio collettivo: esibizione e sbandieratori del blocco del giocatore
        for (const sb of sband) {
          if ((sb.show || sb.rec.grp === player) && now - sb.t0 >= THROW) sb.next = now;
        }
      }
    }

    return { update, react };
  }

  Q.Figuranti = { build };
})(typeof window !== 'undefined' ? window : globalThis);
