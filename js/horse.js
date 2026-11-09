(function (root) {
  const Q = (root.Q = root.Q || {});

  const TAU = Math.PI * 2;
  const COL = {
    coat: '#7a3d1b', points: '#221710', hair: '#141010', wrap: '#ecebe6', hoof: '#3a3430',
    saddle: '#2a1a10', metal: '#a9a9a9', shirt: '#f2f2ee', vest: '#151515', pants: '#1c1c1f',
    boot: '#0c0c0c', skin: '#d6a47f', helmet: '#111111',
  };
  const STRIDE = 3.2; // metri per falcata
  const DUTY = 0.25; // frazione della falcata con lo zoccolo a terra
  const PASTERN = 0.21; // nodello -> appoggio dello zoccolo
  const PASTERN_REST = -0.45;
  const BODY_Y = 1.2; // perno di beccheggio del tronco
  const HEAD_REST = -0.66;
  const LANCE = 3;
  const ARM = [0.3, 0.29];
  const HAND_AIM = new THREE.Vector3(-0.35, 1.75, 0.15);
  const HAND_REST = new THREE.Vector3(-0.2, 1.92, 0.36);
  const DIR_REST = new THREE.Vector3(0.62, 0.76, 0.12).normalize();
  const REST_REACH = 2;
  const POLE_R = new THREE.Vector3(-0.7, -0.3, -0.6);
  const POLE_L = new THREE.Vector3(0.8, -0.4, -0.5);
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);

  // Galoppo traverso, piede guida destro: posteriore sx, posteriore dx, anteriore sx, anteriore dx.
  const LEGS = [
    { x: 0.15, y: 1.34, z: 0.5, a: 0.8, b: 0.36, front: true, off: 0.35, zN: 0.56 },
    { x: -0.15, y: 1.34, z: 0.5, a: 0.8, b: 0.36, front: true, off: 0.47, zN: 0.56 },
    { x: 0.17, y: 1.3, z: -0.5, a: 0.7, b: 0.48, front: false, off: 0, zN: -0.6 },
    { x: -0.17, y: 1.3, z: -0.5, a: 0.7, b: 0.48, front: false, off: 0.12, zN: -0.6 },
  ];

  // Sezioni del tronco: [z, y, semilarghezza, semialtezza]
  const BODY = [
    [-0.94, 1.37, 0.05, 0.06], [-0.88, 1.37, 0.16, 0.2], [-0.76, 1.36, 0.25, 0.28],
    [-0.56, 1.33, 0.29, 0.32], [-0.3, 1.31, 0.29, 0.3], [0, 1.27, 0.31, 0.33],
    [0.28, 1.28, 0.3, 0.37], [0.48, 1.31, 0.27, 0.36], [0.66, 1.29, 0.23, 0.3],
    [0.81, 1.26, 0.17, 0.21], [0.89, 1.25, 0.08, 0.11],
  ];
  // Testa appesa lungo -Y dalla nuca; +Z = fronte, -Z = ganasce.
  const HEAD = [
    [0, 0.04, 0.085, 0.09], [0, -0.04, 0.1, 0.14, 0.03], [0, -0.16, 0.105, 0.15, 0.04],
    [0, -0.3, 0.085, 0.1, 0.01], [0, -0.44, 0.07, 0.08], [0, -0.54, 0.07, 0.08, 0.005], [0, -0.6, 0.05, 0.06],
  ];
  const TORSO = [
    [0, 0.02, 0.15, 0.11], [0, 0.14, 0.155, 0.11], [0, 0.27, 0.145, 0.1],
    [0, 0.4, 0.175, 0.115, 0.01], [0, 0.47, 0.17, 0.1], [0, 0.53, 0.1, 0.075],
  ];

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const lerp = (a, b, t) => a + (b - a) * t;
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

  function smooth(s, k) {
    const f = s.map((p) => [p[0], p[1], p[2], p[3], p[4] || 0]);
    const out = [];
    for (let i = 0; i < f.length - 1; i++) {
      const p0 = f[Math.max(0, i - 1)], p1 = f[i], p2 = f[i + 1], p3 = f[Math.min(f.length - 1, i + 2)];
      for (let j = 0; j < k; j++) out.push(p1.map((_, n) => cr(p0[n], p1[n], p2[n], p3[n], j / k)));
    }
    out.push(f[f.length - 1]);
    return out;
  }

  // Tangente e normale del percorso nel piano YZ; la normale è a destra della tangente guardando da +X.
  function frames(s) {
    return s.map((p, i) => {
      const q = s[Math.max(0, i - 1)], r = s[Math.min(s.length - 1, i + 1)];
      let tz = r[0] - q[0], ty = r[1] - q[1];
      const l = Math.hypot(tz, ty) || 1;
      tz /= l; ty /= l;
      return { ty, tz, ny: -tz, nz: ty };
    });
  }

  // Superficie a sezioni ellittiche lungo un percorso nel piano YZ. s: [z, y, rx, rn, scostamento lungo n].
  // Con a0/a1 genera solo un arco di sezione (fasce aperte, es. sottosella), senza tappi.
  function loft(s, c, o = {}) {
    const seg = o.seg || 12;
    const full = o.a0 === undefined;
    const a0 = full ? 0 : o.a0, a1 = full ? TAU : o.a1;
    const ring = full ? seg : seg + 1;
    const fr = frames(s);
    const pos = [], idx = [];
    const center = (i) => [s[i][1] + fr[i].ny * (s[i][4] || 0), s[i][0] + fr[i].nz * (s[i][4] || 0)];
    s.forEach((p, i) => {
      const [cy, cz] = center(i);
      for (let j = 0; j < ring; j++) {
        const a = a0 + ((a1 - a0) * j) / seg;
        const sa = Math.sin(a) * p[3];
        pos.push(Math.cos(a) * p[2], cy + fr[i].ny * sa, cz + fr[i].nz * sa);
      }
    });
    for (let i = 0; i < s.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const A = i * ring + j, B = i * ring + (full ? (j + 1) % seg : j + 1);
        idx.push(A, A + ring, B, B, A + ring, B + ring);
      }
    }
    const cap = (i, end) => {
      const base = pos.length / 3;
      const [cy, cz] = center(i);
      pos.push(0, cy, cz);
      for (let j = 0; j < seg; j++) pos.push(...pos.slice((i * ring + j) * 3, (i * ring + j) * 3 + 3));
      for (let j = 0; j < seg; j++) {
        const u = base + 1 + j, v = base + 1 + ((j + 1) % seg);
        if (end) idx.push(base, v, u); else idx.push(base, u, v);
      }
    };
    if (full && o.cap0) cap(0, false);
    if (full && o.cap1) cap(s.length - 1, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return [g, c];
  }

  function ell(x, y, z, rx, ry, rz, c, w = 12, h = 8) {
    const g = new THREE.SphereGeometry(1, w, h);
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    return [g, c];
  }

  // Tronco di cono da a (raggio r0) a b (raggio r1).
  function cyl(a, b, r0, r1, c, n = 8) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, n);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate(a.x, a.y, a.z);
    return [g, c];
  }

  // Unisce parti [geometria, colore] in una sola geometria con colori per vertice (una draw call).
  function merge(parts) {
    const gs = parts.map(([g, c]) => {
      const ng = g.index ? g.toNonIndexed() : g;
      if (ng !== g) g.dispose();
      return [ng, new THREE.Color(c)];
    });
    const n = gs.reduce((t, [g]) => t + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const [g, c] of gs) {
      const k = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      for (let i = (o + k) * 3 - 3; i >= o * 3; i -= 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
      o += k;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  function spiralTexture(c1, c2) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    x.fillStyle = c1;
    x.fillRect(0, 0, 64, 64);
    x.fillStyle = c2;
    x.beginPath();
    x.moveTo(0, 0); x.lineTo(32, 0); x.lineTo(0, 32); x.closePath();
    x.moveTo(64, 0); x.lineTo(64, 32); x.lineTo(32, 64); x.lineTo(0, 64); x.closePath();
    x.fill();
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 13);
    t.anisotropy = 4;
    return t;
  }

  // IK a due ossa nel piano sagittale. Angolo θ attorno a X: direzione (z = -sin θ, y = -cos θ).
  // Ginocchio anteriore in avanti, garretto posteriore indietro.
  function solveLeg(L, tz, ty) {
    const dz = tz - L.z, dy = ty - L.y;
    const d = Math.min(Math.max(Math.hypot(dz, dy), Math.abs(L.a - L.b) + 1e-3), (L.a + L.b) * 0.999);
    const thT = Math.atan2(-dz, -dy);
    const al = Math.acos(Math.min(1, Math.max(-1, (L.a * L.a + d * d - L.b * L.b) / (2 * L.a * d))));
    const t1 = L.front ? thT - al : thT + al;
    const kz = L.z - L.a * Math.sin(t1), ky = L.y - L.a * Math.cos(t1);
    return [t1, Math.atan2(-(tz - kz), -(ty - ky))];
  }

  function bodyParts(c1, c2) {
    const s = smooth(BODY, 3);
    const at = (z) => {
      let i = 1;
      while (i < s.length - 1 && s[i][0] < z) i++;
      const t = (z - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1].map((v, n) => lerp(v, s[i][n], t));
    };
    const band = (z0, z1, k, c, arc) => {
      const pts = [];
      for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 8) {
        const p = at(z);
        pts.push([z, p[1], p[2] * k, p[3] * k, 0]);
      }
      return arc ? loft(pts, c, { seg: 10, a0: -Math.PI / 2 - arc, a1: -Math.PI / 2 + arc }) : loft(pts, c, { seg: 14 });
    };
    const parts = [
      loft(s, COL.coat, { seg: 14, cap0: true, cap1: true }),
      band(-0.36, 0.3, 1.028, c2, 1.22),
      band(-0.32, 0.26, 1.04, c1, 1.12),
      band(-0.12, 0.18, 1.05, COL.saddle, 0.95),
      band(0.12, 0.17, 1.045, COL.saddle),
      ell(0, 1.62, -0.04, 0.19, 0.06, 0.28, COL.saddle),
      ell(0, 1.66, -0.28, 0.15, 0.06, 0.06, COL.saddle),
      ell(0, 1.66, 0.2, 0.11, 0.05, 0.06, COL.saddle),
    ];
    for (const sx of [1, -1]) {
      const H = V(sx * 0.12, 1.66, -0.06), K = V(sx * 0.35, 1.44, 0.24), A = V(sx * 0.34, 1.05, 0.1), T = V(sx * 0.35, 1.01, 0.27);
      const cuff = K.clone().lerp(A, 0.12);
      const st = new THREE.TorusGeometry(0.06, 0.008, 4, 10);
      st.translate(sx * 0.35, 1.04, 0.19);
      parts.push(
        cyl(H, K, 0.085, 0.065, COL.pants), ell(K.x, K.y, K.z, 0.068, 0.068, 0.068, COL.pants),
        ell(cuff.x, cuff.y, cuff.z, 0.066, 0.04, 0.066, COL.boot), cyl(cuff, A, 0.062, 0.05, COL.boot),
        cyl(A.clone().add(V(0, -0.01, -0.04)), T, 0.05, 0.04, COL.boot),
        cyl(V(sx * 0.29, 1.56, 0.04), V(sx * 0.35, 1.1, 0.19), 0.012, 0.012, COL.saddle, 4),
        [st, COL.metal],
      );
    }
    return parts;
  }

  function neckSamples() {
    const s = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6, b = 2 * u * (1 - u), c = u * u;
      s.push([b * 0.12 + c * 0.55, b * 0.42 + c * 0.58, lerp(0.2, 0.105, u), lerp(0.3, 0.125, Math.pow(u, 0.8)), -0.03 * Math.sin(Math.PI * u)]);
    }
    return smooth(s, 2);
  }

  function headParts() {
    const ear = (sx) => cyl(V(sx * 0.055, 0.02, -0.03), V(sx * 0.075, 0.12, 0.08), 0.035, 0.008, COL.coat, 6);
    return [
      loft(smooth(HEAD, 2), COL.coat, { seg: 12, cap0: true, cap1: true }),
      loft([[0, -0.385, 0.079, 0.091, 0.004], [0, -0.42, 0.077, 0.087, 0.002]], COL.hair, { seg: 12 }),
      ear(1), ear(-1),
      ell(0.1, -0.13, 0.035, 0.022, 0.022, 0.022, COL.hair), ell(-0.1, -0.13, 0.035, 0.022, 0.022, 0.022, COL.hair),
      ell(0.036, -0.575, 0.035, 0.018, 0.022, 0.018, COL.hair), ell(-0.036, -0.575, 0.035, 0.018, 0.022, 0.018, COL.hair),
      ell(0, 0.0, 0.075, 0.05, 0.08, 0.03, COL.hair),
      cyl(V(0.088, -0.39, -0.01), V(0.09, -0.02, -0.03), 0.009, 0.009, COL.hair, 4),
      cyl(V(-0.088, -0.39, -0.01), V(-0.09, -0.02, -0.03), 0.009, 0.009, COL.hair, 4),
      ell(0.072, -0.5, -0.02, 0.012, 0.022, 0.022, COL.metal), ell(-0.072, -0.5, -0.02, 0.012, 0.022, 0.022, COL.metal),
    ];
  }

  function legParts(L) {
    const P = PASTERN;
    const upper = L.front
      ? [ell(0, -0.42, -0.01, 0.085, 0.18, 0.11, COL.coat), cyl(V(0, -0.3, 0), V(0, -L.a + 0.04, 0), 0.09, 0.05, COL.coat),
        ell(0, -L.a, 0, 0.052, 0.07, 0.058, COL.coat)]
      : [ell(0, -0.3, 0.02, 0.095, 0.3, 0.15, COL.coat), cyl(V(0, -0.35, 0), V(0, -L.a + 0.04, 0), 0.09, 0.05, COL.coat),
        ell(0, -L.a, -0.02, 0.05, 0.07, 0.075, COL.points)];
    const cannon = [
      cyl(V(0, 0.02, 0), V(0, -0.12, 0), 0.045, 0.042, COL.points),
      cyl(V(0, -0.1, 0), V(0, -L.b + 0.02, 0), 0.052, 0.054, COL.wrap),
      ell(0, -L.b, 0, 0.057, 0.062, 0.062, COL.wrap),
    ];
    // Lo zoccolo è inclinato rispetto al pastorale così da poggiare in piano nella posa a riposo.
    const vert = V(0, Math.cos(-PASTERN_REST), Math.sin(-PASTERN_REST));
    const sole = V(0, -P, 0), top = sole.clone().addScaledVector(vert, 0.085);
    const pastern = [cyl(V(0, 0, 0), top, 0.04, 0.042, COL.points), cyl(sole, top, 0.062, 0.05, COL.hoof, 10)];
    return [upper, cannon, pastern];
  }

  function tailParts(len, r0, r1, c) {
    return [loft([[0, 0.02, r0, r0], [0, -len / 2, (r0 + r1) * 0.55, (r0 + r1) * 0.55], [0, -len - 0.02, r1, r1]], c, { seg: 8, cap0: true, cap1: true })];
  }

  function riderParts(c1, c2) {
    const s = smooth(TORSO, 2);
    const vest = s.filter((p) => p[1] > 0.06 && p[1] < 0.49);
    const grow = (pts, k) => pts.map((p) => [p[0], p[1], p[2] + k, p[3] + k, p[4]]);
    const OPEN = 0.42;
    const arc = { seg: 14, a0: Math.PI / 2 + OPEN, a1: Math.PI / 2 - OPEN + TAU };
    const edge = (a, y) => {
      const p = s.reduce((b, q) => (Math.abs(q[1] - y) < Math.abs(b[1] - y) ? q : b));
      return V((p[2] + 0.015) * Math.cos(a), y, (p[3] + 0.015) * Math.sin(a) + p[4]);
    };
    const parts = [
      ell(0, 0.04, -0.03, 0.165, 0.11, 0.15, COL.pants),
      loft(s, COL.shirt, { seg: 14, cap0: true, cap1: true }),
      loft(grow(vest, 0.012), COL.vest, arc),
      loft(grow([[0, 0.07, 0.151, 0.11, 0], [0, 0.1, 0.152, 0.11, 0]], 0.018), c1, arc),
      cyl(V(0, 0.5, 0.01), V(0, 0.64, 0.02), 0.05, 0.045, COL.skin),
      ell(0.19, 0.455, 0, 0.065, 0.065, 0.065, COL.shirt), ell(-0.19, 0.455, 0, 0.065, 0.065, 0.065, COL.shirt),
    ];
    for (const a of [Math.PI / 2 + OPEN, Math.PI / 2 - OPEN]) parts.push(cyl(edge(a, 0.08), edge(a, 0.47), 0.012, 0.012, c2, 5));
    return parts;
  }

  function riderHeadParts() {
    const helm = new THREE.SphereGeometry(0.115, 14, 8, 0, TAU, 0, 1.75);
    helm.translate(0, 0.11, -0.005);
    return [
      ell(0, 0.09, 0.015, 0.095, 0.11, 0.1, COL.skin),
      [helm, COL.helmet],
      ell(0, 0.1, 0.1, 0.085, 0.012, 0.05, COL.helmet),
    ];
  }

  function armParts(len, r0, r1, hand) {
    const p = [cyl(V(0, 0, 0), V(0, -len + (hand ? 0.03 : 0), 0), r0, r1, COL.shirt)];
    if (hand) p.push(ell(0, -len, 0, 0.042, 0.05, 0.042, COL.skin));
    else p.push(ell(0, -len, 0, r1, r1, r1, COL.shirt));
    return p;
  }

  function create(opt) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const group = new THREE.Group();
    const mk = (parts, parent) => {
      const m = new THREE.Mesh(merge(parts), mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    const body = new THREE.Object3D();
    body.position.y = BODY_Y;
    group.add(body);
    const inner = new THREE.Object3D();
    inner.position.y = -BODY_Y;
    body.add(inner);
    const trunk = mk(bodyParts(opt.c1, opt.c2), inner);

    const legs = LEGS.map((L) => {
      const [pu, pc, pp] = legParts(L);
      const up = mk(pu, inner);
      up.position.set(L.x, L.y, L.z);
      const low = mk(pc, up);
      low.position.y = -L.a;
      const pas = mk(pp, low);
      pas.position.y = -L.b;
      return Object.assign({ up, low, pas }, L);
    });

    const neckS = neckSamples();
    const neck = mk([loft(neckS, COL.coat, { seg: 12, cap0: true })], inner);
    neck.position.set(0, 1.42, 0.62);
    const fr = frames(neckS);
    const crest = neckS.map((p, i) => {
      const o = p[4] - p[3] * 0.92;
      return [p[0] + fr[i].nz * o, p[1] + fr[i].ny * o, 0.03, 0.035, 0];
    }).slice(1, -1);
    mk([loft(crest, COL.hair, { seg: 6, cap0: true, cap1: true })], neck);

    // Criniera: ciuffi istanziati lungo la cresta, mossi dal vento e dalla falcata.
    const tuftGeo = new THREE.ConeGeometry(0.075, 0.24, 4);
    tuftGeo.rotateX(Math.PI);
    tuftGeo.translate(0, -0.12, 0);
    tuftGeo.scale(0.3, 1, 1);
    const tuftColor = new THREE.Color(COL.hair);
    const tc = new Float32Array(tuftGeo.attributes.position.count * 3);
    for (let i = 0; i < tc.length; i += 3) { tc[i] = tuftColor.r; tc[i + 1] = tuftColor.g; tc[i + 2] = tuftColor.b; }
    tuftGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    const TUFTS = 14;
    const mane = new THREE.InstancedMesh(tuftGeo, mat, TUFTS);
    mane.castShadow = true;
    mane.frustumCulled = false;
    neck.add(mane);
    const tufts = [];
    for (let i = 0; i < TUFTS; i++) {
      const k = (i + 0.5) / TUFTS * (crest.length - 1);
      const j = Math.floor(k), f = k - j;
      const a = crest[j], b = crest[Math.min(crest.length - 1, j + 1)];
      const t = V(0, b[1] - a[1], b[0] - a[0]).normalize();
      tufts.push({ p: V(0, lerp(a[1], b[1], f), lerp(a[0], b[0], f)), t, n: V(0, -t.z, t.y), s: 1.15 - 0.4 * (i / TUFTS) });
    }

    const head = mk(headParts(), neck);
    const poll = neckS[neckS.length - 1];
    head.position.set(0, poll[1], poll[0]);
    head.rotation.x = HEAD_REST;
    const bitL = new THREE.Object3D(), bitR = new THREE.Object3D();
    bitL.position.set(0.075, -0.5, -0.02);
    bitR.position.set(-0.075, -0.5, -0.02);
    head.add(bitL, bitR);

    const tail0 = mk(tailParts(0.22, 0.055, 0.075, COL.hair), inner);
    tail0.position.set(0, 1.5, -0.9);
    const tail1 = mk(tailParts(0.32, 0.075, 0.115, COL.hair), tail0);
    tail1.position.y = -0.22;
    const tail2 = mk(tailParts(0.42, 0.115, 0.035, COL.hair), tail1);
    tail2.position.y = -0.32;

    const pelvis = mk(riderParts(opt.c1, opt.c2), inner);
    pelvis.position.set(0, 1.64, -0.05);
    const rHead = mk(riderHeadParts(), pelvis);
    rHead.position.set(0, 0.6, 0.01);
    const shR = new THREE.Object3D(), shL = new THREE.Object3D();
    shR.position.set(-0.19, 0.46, 0);
    shL.position.set(0.19, 0.46, 0);
    pelvis.add(shR, shL);
    const reinHand = new THREE.Object3D();
    reinHand.position.set(0.06, 1.8, 0.36);
    inner.add(reinHand);

    const upR = mk(armParts(ARM[0], 0.05, 0.043), group);
    const foR = mk(armParts(ARM[1], 0.043, 0.036, true), group);
    foR.name = 'avambraccioDx';
    const upL = mk(armParts(ARM[0], 0.05, 0.043), group);
    const foL = mk(armParts(ARM[1], 0.043, 0.036, true), group);
    const reins = [0, 1].map(() => mk([cyl(V(0, 0, 0), V(0, -1, 0), 0.008, 0.008, COL.hair, 4)], group));

    // Lancia: l'origine dell'oggetto è la punta, l'asta si estende lungo -Z.
    const lance = new THREE.Object3D();
    lance.name = 'lancia';
    group.add(lance);
    const shaftGeo = new THREE.CylinderGeometry(0.017, 0.027, LANCE - 0.08, 10, 1);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 0, -0.08 - (LANCE - 0.08) / 2);
    const shaft = new THREE.Mesh(shaftGeo, new THREE.MeshLambertMaterial({ map: spiralTexture(opt.c1, opt.c2) }));
    shaft.castShadow = true;
    lance.add(shaft);
    const pointGeo = new THREE.ConeGeometry(0.019, 0.09, 8);
    pointGeo.rotateX(Math.PI / 2);
    pointGeo.translate(0, 0, -0.045);
    const point = mk([[pointGeo, COL.metal], cyl(V(0, 0, -LANCE), V(0, 0, -LANCE + 0.25), 0.03, 0.029, COL.hair)], lance);
    point.name = 'puntaLancia';

    let phase = 0, run = -1, amp = 0, roll = 0, w = 0, time = 0;
    const lastTip = new THREE.Vector3();
    const Minv = new THREE.Matrix4();
    const tmp = new THREE.Vector3(), hand = new THREE.Vector3(), sh = new THREE.Vector3(), elbow = new THREE.Vector3();
    const dv = new THREE.Vector3(), perp = new THREE.Vector3(), dir = new THREE.Vector3(), aim = new THREE.Vector3();
    const rest = new THREE.Vector3(), bit = new THREE.Vector3(), basis = new THREE.Matrix4();
    const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();

    const toGroup = (obj, out) => {
      out.set(0, 0, 0);
      for (let o = obj; o !== group; o = o.parent) { o.updateMatrix(); out.applyMatrix4(o.matrix); }
      return out;
    };
    const orient = (m, A, B) => {
      m.position.copy(A);
      m.quaternion.setFromUnitVectors(DOWN, dv.subVectors(B, A).normalize());
    };
    // Braccio a due ossa da S verso H; se H è fuori portata viene avvicinato a S.
    const reach = (S, H, pole, mUp, mFo) => {
      const [a, b] = ARM;
      dir.subVectors(H, S);
      const L = Math.min(Math.max(dir.length(), a - b + 0.01), (a + b) * 0.999);
      dir.normalize();
      H.copy(S).addScaledVector(dir, L);
      const x = (a * a - b * b + L * L) / (2 * L);
      perp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
      elbow.copy(S).addScaledVector(dir, x).addScaledVector(perp, Math.sqrt(Math.max(0, a * a - x * x)));
      orient(mUp, S, elbow);
      orient(mFo, elbow, H);
    };

    function update(dt, st) {
      const v = Math.max(0, st.speed || 0);
      const moving = v > 0.3 ? 1 : 0;
      const ampT = Math.min(1, Math.max(0, (v - 0.3) / 9));
      if (run < 0) { run = moving; amp = ampT; w = st.tip ? 1 : 0; } // primo fotogramma: nessuna transizione
      const k3 = 1 - Math.exp(-3 * dt);
      run += (moving - run) * k3;
      amp += (ampT - amp) * k3;
      roll += ((st.steer || 0) * 0.16 * Math.min(1, v / 8) - roll) * (1 - Math.exp(-4 * dt));
      w = st.tip ? Math.min(1, w + dt * 1.4) : Math.max(0, w - dt * 1.4);
      if (st.tip) lastTip.copy(st.tip);
      phase += (dt * v) / STRIDE;
      time += dt;

      const ph = phase - Math.floor(phase);
      const g = run * amp * (2 - amp);
      const breathe = Math.sin(time * 1.7);
      const pitch = -0.06 * g * Math.cos(TAU * (ph - 0.05));
      let bob = 0.065 * g * Math.cos(TAU * (ph - 0.86)) - 0.03 * g + (1 - run) * 0.006 * breathe;

      // Zoccoli: in appoggio fermi a terra (scorrono all'indietro alla velocità del cavallo),
      // in volo seguono un arco; l'IK ricava gli angoli da dove deve stare il nodello.
      const S = DUTY * STRIDE;
      const P = PASTERN, sP = Math.sin(-PASTERN_REST), cP = Math.cos(PASTERN_REST);
      for (const L of legs) {
        const lp = (((ph - L.off) % 1) + 1) % 1;
        let fz, fy;
        L.thp = PASTERN_REST;
        L.sw = -1;
        if (lp < DUTY) {
          const u = lp / DUTY;
          L.thp = PASTERN_REST - 0.35 * Math.sin(Math.PI * u) * amp;
          fz = L.zN + S / 2 - S * u + P * Math.sin(L.thp);
          fy = P * Math.cos(L.thp);
        } else {
          const u = (lp - DUTY) / (1 - DUTY);
          const lift = L.front ? 0.12 + 0.36 * amp : 0.1 + 0.3 * amp;
          fz = L.zN - S / 2 + S * u * u * (3 - 2 * u) - P * sP;
          fy = P * cP + lift * Math.sin(Math.PI * Math.pow(u, L.front ? 0.75 : 0.9));
          L.sw = Math.sin(Math.PI * u);
        }
        L.fz = lerp(L.zN - P * sP, fz, run);
        L.fy = lerp(P * cP, fy, run);
        // Il tronco non sale oltre la portata delle gambe in appoggio, così lo zoccolo resta a terra.
        if (L.sw < 0) {
          const dz = L.fz - (L.z + (L.y - BODY_Y) * pitch);
          const R = (L.a + L.b) * 0.998;
          if (Math.abs(dz) < R) bob = Math.min(bob, L.fy + Math.sqrt(R * R - dz * dz) - (L.y - L.z * pitch + L.x * roll));
        }
      }

      body.position.y = BODY_Y + bob;
      body.rotation.set(pitch, 0, roll);
      trunk.scale.x = 1 + (1 - run) * 0.012 * breathe;
      body.updateMatrix();
      inner.updateMatrix();
      Minv.multiplyMatrices(body.matrix, inner.matrix).invert();

      for (const L of legs) {
        tmp.set(L.x, L.fy, L.fz).applyMatrix4(Minv);
        const [t1, t2] = solveLeg(L, tmp.z, tmp.y);
        const restP = PASTERN_REST - pitch;
        const sw = L.sw, thp = L.thp;
        let tp = sw < 0 ? thp - pitch : lerp(restP, t2 + (L.front ? 0.8 : 0.6) * amp + 0.15, sw);
        tp = lerp(restP, tp, run);
        L.up.rotation.x = t1;
        L.low.rotation.x = t2 - t1;
        L.pas.rotation.x = tp - t2;
      }

      neck.rotation.x = 0.12 + 0.06 * g +0.07 * g * Math.sin(TAU * (ph - 0.3)) - pitch * 0.5 + (1 - run) * 0.03 * Math.sin(time * 0.6);
      head.rotation.x = HEAD_REST - 0.2 * g + 0.05 * g * Math.sin(TAU * (ph - 0.45));
      for (let i = 0; i < TUFTS; i++) {
        const T = tufts[i];
        const fl = 0.35 * g * Math.sin(time * 15 + i * 1.7) + 0.05 * Math.sin(time * 2 + i);
        by.set(-0.75, 0, 0).addScaledVector(T.n, 0.4 - fl).addScaledVector(T.t, -0.15 - 0.6 * g).normalize().negate();
        bz.copy(T.t).addScaledVector(by, -T.t.dot(by)).normalize();
        bx.crossVectors(by, bz);
        basis.makeBasis(bx, by, bz).scale(tmp.set(1, T.s * (1 + 0.15 * g), T.s)).setPosition(T.p);
        mane.setMatrixAt(i, basis);
      }
      mane.instanceMatrix.needsUpdate = true;

      tail0.rotation.x = 0.55 + 0.5 * g + 0.08 * g * Math.sin(TAU * (ph - 0.1)) - pitch;
      tail0.rotation.z = (1 - run) * 0.12 * Math.sin(time * 0.9) + 0.04 * g * Math.sin(TAU * (ph + 0.2));
      tail1.rotation.x = -0.35 + 0.05 * g + 0.15 * g * Math.sin(TAU * (ph - 0.25));
      tail2.rotation.x = -0.15 + 0.1 * g + 0.2 * g * Math.sin(TAU * (ph - 0.4));
      tail2.rotation.z = 0.1 * g * Math.sin(TAU * (ph - 0.3));

      pelvis.rotation.x = 0.06 + 0.32 * g - pitch * 0.7;
      pelvis.position.y = 1.64 + 0.015 * g * Math.cos(TAU * (ph - 0.6));
      rHead.rotation.x = -pelvis.rotation.x * 0.7;

      // Mano destra: a riposo in alto davanti al petto, in resta all'altezza dell'anca.
      const wq = w * w * (3 - 2 * w);
      hand.lerpVectors(HAND_REST, HAND_AIM, wq);
      hand.y += bob * (1 - 0.5 * wq);
      reach(toGroup(shR, sh), hand, POLE_R, upR, foR);
      rest.copy(DIR_REST);
      rest.x += 0.03 * g * Math.sin(TAU * ph);
      rest.y += 0.03 * g * Math.cos(TAU * ph);
      rest.normalize();
      let len = REST_REACH;
      dir.copy(rest);
      if (wq > 0) {
        aim.subVectors(lastTip, hand);
        const la = aim.length();
        aim.divideScalar(la);
        dir.lerpVectors(rest, aim, wq).normalize();
        len = lerp(REST_REACH, la, wq);
      }
      // A transizione conclusa (wq = 1) la punta coincide con tip: mano + direzione * distanza.
      lance.position.copy(hand).addScaledVector(dir, len);
      lance.quaternion.setFromUnitVectors(FWD, dir);

      const handL = toGroup(reinHand, tmp);
      reach(toGroup(shL, sh), handL, POLE_L, upL, foL);
      [bitL, bitR].forEach((b, i) => {
        toGroup(b, bit);
        orient(reins[i], handL, bit);
        reins[i].scale.y = handL.distanceTo(bit);
      });
    }

    return {
      group,
      update,
      get stride() { return phase; },
    };
  }

  Q.Horse = { create };
})(typeof window !== 'undefined' ? window : globalThis);
