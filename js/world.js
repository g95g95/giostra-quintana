(function (root) {
  const Q = (root.Q = root.Q || {});

  const SUN_OFFSET = [-55, 45, 25]; // sole di tardo pomeriggio da ovest-sud-ovest
  const HORIZON = 0xdcd6c4;
  const UP = [0, 1, 0];

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

  function smooth(k) {
    k = Math.min(1, Math.max(0, k));
    return k * k * (3 - 2 * k);
  }

  // Colline: piano attorno al campo, poi salgono; più alte a nord e a est (ref_01, ref_02).
  function hillH(x, z) {
    const r = Math.hypot(x, z);
    if (r < 110) return 0;
    const north = Math.max(0, -z / r);
    const east = Math.max(0, x / r);
    const dir = 0.3 + 0.7 * Math.max(north, 0.85 * east);
    const n = 0.8 + 0.22 * Math.sin(x * 0.012 + 1.7) * Math.cos(z * 0.014 - 0.4) + 0.1 * Math.sin(x * 0.037 + z * 0.029) + 0.05 * Math.sin(x * 0.081 - z * 0.067 + 0.5);
    return smooth((r - 110) / 520) * 230 * dir * n;
  }

  // 0..1: macchie di bosco e radure sulle colline
  function forestN(x, z) {
    return 0.5 + 0.3 * Math.sin(x * 0.021 + 0.8) * Math.cos(z * 0.018 + 2.2) + 0.2 * Math.sin(x * 0.047 - z * 0.039);
  }

  const colorCache = {};
  function C(c) {
    if (c && c.isColor) return c;
    return colorCache[c] || (colorCache[c] = new THREE.Color(c));
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  function mat(x, y, z, ry, sx, sy, sz, rx, rz) {
    _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0));
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
  }

  // Accumula triangoli non indicizzati con colore per vertice: tante parti statiche, una sola draw call.
  class Merger {
    constructor() {
      this.p = [];
      this.n = [];
      this.c = [];
    }

    // hint = direzione verso cui deve guardare la faccia; se serve inverte l'ordine dei vertici.
    tri(a, b, c, col, hint) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
        const t = b; b = c; c = t;
        nx = -nx; ny = -ny; nz = -nz;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const k = C(col);
      for (const q of [a, b, c]) {
        this.p.push(q[0], q[1], q[2]);
        this.n.push(nx / l, ny / l, nz / l);
        this.c.push(k.r, k.g, k.b);
      }
    }

    quad(a, b, c, d, col, hint) {
      this.tri(a, b, c, col, hint);
      this.tri(a, c, d, col, hint);
    }

    // col null = usa gli attributi colore della geometria.
    geo(g, col, m) {
      const src = g.index ? g.toNonIndexed() : g;
      const p = src.attributes.position, n = src.attributes.normal, cc = src.attributes.color;
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const v = new THREE.Vector3();
      const k = col == null ? null : C(col);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        this.p.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        this.n.push(v.x, v.y, v.z);
        if (k) this.c.push(k.r, k.g, k.b);
        else this.c.push(cc.getX(i), cc.getY(i), cc.getZ(i));
      }
    }

    box(w, h, d, x, y, z, col, ry, rx, rz) {
      this.geo(UNIT.box, col, mat(x, y, z, ry, w, h, d, rx, rz));
    }

    cyl(rTop, rBot, h, x, y, z, col, seg) {
      this.geo(new THREE.CylinderGeometry(rTop, rBot, h, seg || 8), col, mat(x, y + h / 2, z));
    }

    // Prisma verticale su una base a 4 vertici [x, z] ordinati; mask sceglie quali lati disegnare.
    prism(cs, y0, y1, topCol, sideCol, mask) {
      const cx = (cs[0][0] + cs[1][0] + cs[2][0] + cs[3][0]) / 4;
      const cz = (cs[0][1] + cs[1][1] + cs[2][1] + cs[3][1]) / 4;
      const t = cs.map((c) => [c[0], y1, c[1]]);
      this.quad(t[0], t[1], t[2], t[3], topCol, UP);
      for (let k = 0; k < 4; k++) {
        if (mask && !mask[k]) continue;
        const a = cs[k], b = cs[(k + 1) % 4];
        const hint = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
        this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], sideCol, hint);
      }
    }

    // Segmento orientato da (x0, z0) a (x1, z1): trave di sezione w x h centrata a quota y.
    beam(x0, z0, x1, z1, y, w, h, col) {
      const dx = x1 - x0, dz = z1 - z0;
      this.box(w, h, Math.hypot(dx, dz), (x0 + x1) / 2, y, (z0 + z1) / 2, col, Math.atan2(dx, dz));
    }

    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      return g;
    }
  }

  const UNIT = {};

  function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d'), w, h);
    return new THREE.CanvasTexture(cv);
  }

  function speckle(g, w, h, n, cols, rnd, size) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      const s = 1 + rnd() * size;
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
  }

  // Tetto a padiglione unitario: base 1 x 1 a y = 0, colmo lungo X a y = 1.
  function hipGeo() {
    const m = new Merger();
    const r = 0.25;
    const a = [-0.5, 0, 0.5], b = [0.5, 0, 0.5], c = [0.5, 0, -0.5], d = [-0.5, 0, -0.5];
    const e = [r, 1, 0], f = [-r, 1, 0];
    m.quad(a, b, e, f, 0xffffff, [0, 1, 1]);
    m.quad(c, d, f, e, 0xffffff, [0, 1, -1]);
    m.tri(b, c, e, 0xffffff, [1, 1, 0]);
    m.tri(d, a, f, 0xffffff, [-1, 1, 0]);
    return m.build();
  }

  // Tetto a capanna: colmo lungo X lungo w, base profonda d, alto h; base a y = 0.
  function gableGeo(w, h, d) {
    const m = new Merger();
    const x = w / 2, z = d / 2;
    m.quad([-x, 0, z], [x, 0, z], [x, h, 0], [-x, h, 0], 0xffffff, [0, 1, 1]);
    m.quad([x, 0, -z], [-x, 0, -z], [-x, h, 0], [x, h, 0], 0xffffff, [0, 1, -1]);
    m.tri([x, 0, z], [x, 0, -z], [x, h, 0], 0xffffff, [1, 0, 0]);
    m.tri([-x, 0, -z], [-x, 0, z], [-x, h, 0], 0xffffff, [-1, 0, 0]);
    return m.build();
  }

  function skyTexture(sun) {
    const rnd = rng(11);
    return canvasTex(1024, 512, (g, w, h) => {
      const img = g.createImageData(w, h);
      const zen = [70, 124, 192], mid = [150, 188, 226], hor = [228, 220, 200], glow = [255, 238, 205];
      for (let py = 0; py < h; py++) {
        const elev = Math.PI / 2 - ((py + 0.5) / h) * Math.PI;
        const e = Math.max(0, Math.sin(elev));
        const ce = Math.cos(elev);
        const t1 = Math.pow(e, 0.5);
        for (let px = 0; px < w; px++) {
          // stessa parametrizzazione di SphereGeometry: x = -cos(phi), z = sin(phi)
          const phi = ((px + 0.5) / w) * Math.PI * 2;
          const dx = -Math.cos(phi) * ce, dz = Math.sin(phi) * ce;
          const ds = Math.max(0, dx * sun.x + Math.sin(elev) * sun.y + dz * sun.z);
          const sh = Math.max(0, (dx * sun.x + dz * sun.z) / (ce || 1));
          const gl = Math.min(1, 0.55 * Math.pow(ds, 14) + Math.pow(ds, 400) + 0.35 * Math.pow(sh, 3) * Math.pow(1 - e, 5));
          const i = (py * w + px) * 4;
          for (let k = 0; k < 3; k++) {
            const base = t1 < 0.35 ? hor[k] + (mid[k] - hor[k]) * (t1 / 0.35) : mid[k] + (zen[k] - mid[k]) * ((t1 - 0.35) / 0.65);
            img.data[i + k] = base + (glow[k] - base) * gl;
          }
          img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      // nuvole sparse tra 4 e 30 gradi sull'orizzonte
      for (let c = 0; c < 26; c++) {
        const cx = rnd() * w, el = 4 + Math.pow(rnd(), 1.5) * 26;
        const cy = ((90 - el) / 180) * h;
        const sz = 10 + rnd() * 22 * (1 - el / 40);
        for (let b = 0; b < 9; b++) {
          const bx = cx + (rnd() - 0.5) * sz * 4, by = cy + (rnd() - 0.6) * sz * 0.45, br = sz * (0.5 + rnd() * 0.7);
          const gr = g.createRadialGradient(bx, by, 0, bx, by, br);
          gr.addColorStop(0, 'rgba(255,255,255,0.55)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.save();
          g.translate(bx, by);
          g.scale(1, 0.45);
          g.translate(-bx, -by);
          g.beginPath();
          g.arc(bx, by, br, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
    });
  }

  Q.World = {
    build(scene, renderer, opts) {
      const lite = !!(opts && opts.lite);
      const L = Q.LAYOUT, tr = Q.track, A = L.arena;
      const rnd = rng(20240804);
      const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
      if (renderer) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = lite ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
      }
      UNIT.box = UNIT.box || new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      const lambertVC = (opts) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, opts));
      const inStadium = (x, z, R) => {
        const dz = Math.max(0, Math.abs(z) - A.straightHalfZ);
        return dz === 0 ? Math.abs(x) <= R : Math.hypot(x, dz) <= R;
      };

      // ---------- cielo, nebbia, luci ----------
      const sunDir = new THREE.Vector3().fromArray(SUN_OFFSET).normalize();
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(1000, 48, 24),
        new THREE.MeshBasicMaterial({ map: skyTexture(sunDir), side: THREE.BackSide, fog: false, depthWrite: false })
      );
      sky.renderOrder = -1;
      sky.frustumCulled = false;
      sky.onBeforeRender = (r, s, cam) => {
        sky.position.copy(cam.position);
        sky.updateMatrixWorld();
      };
      scene.add(sky);
      scene.background = new THREE.Color(HORIZON);
      scene.fog = new THREE.Fog(HORIZON, 160, 1050);

      scene.add(new THREE.HemisphereLight(0xd4e2f4, 0x7f7656, 0.6));
      const sun = new THREE.DirectionalLight(0xffe2b8, 0.78);
      sun.userData.offset = new THREE.Vector3().fromArray(SUN_OFFSET);
      sun.castShadow = true;
      sun.shadow.mapSize.setScalar(lite ? 1024 : 2048);
      const sc = sun.shadow.camera;
      sc.left = -25; sc.right = 25; sc.top = 25; sc.bottom = -25;
      sc.near = 1; sc.far = 220;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      sun.target.position.set(tr.moro.x, 0, tr.moro.z);
      sun.position.copy(sun.target.position).add(sun.userData.offset);
      scene.add(sun, sun.target);

      // ---------- terreno e colline ----------
      const terr = new THREE.PlaneGeometry(1800, 1800, 160, 160);
      terr.rotateX(-Math.PI / 2);
      {
        const p = terr.attributes.position;
        const col = new Float32Array(p.count * 3);
        const city = C(0x7f875a), meadow = C(0x76914a), forest = C(0x3a5729), tmp = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), z = p.getZ(i);
          const h = hillH(x, z);
          p.setY(i, h - 0.06);
          tmp.copy(meadow).lerp(forest, smooth(h / 50) * smooth((forestN(x, z) - 0.3) * 2.5));
          tmp.lerp(city, 1 - smooth((Math.hypot(x, z) - 140) / 140));
          col.set([tmp.r, tmp.g, tmp.b], i * 3);
        }
        terr.setAttribute('color', new THREE.BufferAttribute(col, 3));
        terr.computeVertexNormals();
      }
      const terrain = new THREE.Mesh(terr, lambertVC());
      terrain.receiveShadow = true;
      scene.add(terrain);

      // ---------- arena: piazzale, erba, anello di sabbia, pista ----------
      const stadiumPts = (R, n) => {
        const sz = A.straightHalfZ, pts = [[R, -sz], [R, sz]];
        for (let i = 1; i < n; i++) { const a = (Math.PI * i) / n; pts.push([R * Math.cos(a), sz + R * Math.sin(a)]); }
        pts.push([-R, sz], [-R, -sz]);
        for (let i = 1; i < n; i++) { const a = Math.PI + (Math.PI * i) / n; pts.push([R * Math.cos(a), -sz + R * Math.sin(a)]); }
        return pts;
      };
      // forma nel piano XY con y = -z: dopo rotateX(-PI/2) torna in XZ e le UV sono in metri
      const v2 = (pts) => pts.map((p) => new THREE.Vector2(p[0], -p[1]));
      const flatShape = (outer, hole) => {
        const sh = new THREE.Shape(v2(outer));
        if (hole) sh.holes.push(new THREE.Path(v2(hole)));
        const g = new THREE.ShapeGeometry(sh);
        g.rotateX(-Math.PI / 2);
        return g;
      };
      const groundTex = (draw, rep) => {
        const t = canvasTex(256, 256, draw);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rep, rep);
        t.anisotropy = aniso;
        return t;
      };
      const grassTex = groundTex((g, w, h) => {
        // fasce di taglio del prato (ref_01)
        g.fillStyle = '#62a03c'; g.fillRect(0, 0, w, h / 2);
        g.fillStyle = '#558f33'; g.fillRect(0, h / 2, w, h / 2);
        speckle(g, w, h, 5000, ['#4f8a30', '#6aa845', '#5c9838', '#71ad4a'], rnd, 2);
      }, 1 / 16);
      const sandTex = groundTex((g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 7000, ['#e9e3d6', '#f4efe6', '#d9d0bf', '#e2dacb', '#cfc5b2'], rnd, 2);
      }, 1 / 5);
      const ground = (geo, mat, y) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        m.receiveShadow = true;
        scene.add(m);
        return m;
      };
      const offsetMat = (opts, k) => new THREE.MeshLambertMaterial(Object.assign({ polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -2 * k }, opts));

      const R = A.capR;
      ground(flatShape(stadiumPts(R + 26, 24), stadiumPts(R, 48)), new THREE.MeshLambertMaterial({ color: 0xbab19c }), 0);
      ground(flatShape(stadiumPts(R, 48)), new THREE.MeshLambertMaterial({ map: grassTex }), 0);
      ground(flatShape(stadiumPts(R, 48), stadiumPts(R - 5, 48)), offsetMat({ map: sandTex, color: 0xdcd0b4 }, 1), 0.01);
      {
        const hw = tr.halfWidth, pos = [], uv = [], nor = [], idx = [];
        const steps = Math.ceil(tr.lap / 0.75);
        for (let i = 0; i <= steps; i++) {
          const s = (tr.lap * i) / steps;
          for (const lat of [-hw, hw]) {
            const o = tr.offsetAt(s, lat);
            pos.push(o.x, 0, o.z);
            uv.push(o.x, -o.z);
            nor.push(0, 1, 0);
          }
          if (i < steps) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        ground(g, offsetMat({ map: sandTex, color: 0xd6c8a8 }, 2), 0.02);

        // linee di partenza (s = 0) e di arrivo (s = T)
        const lm = new Merger();
        for (const s of [0, tr.T]) {
          const p = tr.posAt(s);
          const rx = -p.hz * hw, rz = p.hx * hw, fx = p.hx * 0.2, fz = p.hz * 0.2;
          lm.quad([p.x - rx - fx, 0, p.z - rz - fz], [p.x + rx - fx, 0, p.z + rz - fz], [p.x + rx + fx, 0, p.z + rz + fz], [p.x - rx + fx, 0, p.z - rz + fz], 0xffffff, UP);
        }
        ground(lm.build(), offsetMat({ vertexColors: true, color: 0xf4f4f0 }, 3), 0.03);
      }

      // ---------- cordoli a cuneo ----------
      {
        const g = new THREE.BoxGeometry(0.42, 0.25, 1.2);
        g.translate(0, 0.125, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.2) { p.setX(i, p.getX(i) * 0.5); p.setZ(i, p.getZ(i) * 0.82); }
        g.computeVertexNormals();
        const list = [];
        for (let s = 0; s < tr.lap; s += 2) {
          for (const side of [-1, 1]) {
            if (!tr.hasCordolo(s, side)) continue;
            const o = tr.offsetAt(s, side * (tr.halfWidth + 0.21));
            const near = Math.hypot(o.x - tr.P.x, o.z - tr.P.z) < 30;
            list.push({ o, col: near ? (Math.round(s / 2) % 2 ? 0xc8141c : 0xf2f0ea) : 0x4f8a5b });
          }
        }
        const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
        list.forEach((c, i) => {
          im.setMatrixAt(i, mat(c.o.x, 0, c.o.z, tr.yawOf(c.o)));
          im.setColorAt(i, C(c.col));
        });
        im.castShadow = !lite;
        im.receiveShadow = true;
        scene.add(im);
      }

      // ---------- staccionata a croce lungo il perimetro (ref_03) ----------
      const arch = new Merger(); // architettura vicina al campo: proietta ombre
      const WOOD = 0x9a7650;
      {
        const SEG = 2.5;
        const fm = new Merger();
        fm.box(0.13, 1.15, 0.13, 0, 0.575, 0, WOOD);
        fm.box(0.08, 0.12, SEG, 0, 1.05, SEG / 2, WOOD);
        const diag = Math.atan2(0.8, SEG);
        fm.box(0.05, 0.1, Math.hypot(SEG, 0.8), 0, 0.55, SEG / 2, WOOD, 0, diag);
        fm.box(0.05, 0.1, Math.hypot(SEG, 0.8), 0, 0.55, SEG / 2, WOOD, 0, -diag);
        const pts = [];
        const sz = A.straightHalfZ;
        const nS = Math.round((2 * sz) / SEG), nC = Math.round((Math.PI * R) / SEG);
        for (let i = 0; i < nS; i++) pts.push([R, -sz + (2 * sz * i) / nS]);
        for (let i = 0; i < nC; i++) { const a = (Math.PI * i) / nC; pts.push([R * Math.cos(a), sz + R * Math.sin(a)]); }
        for (let i = 0; i < nS; i++) pts.push([-R, sz - (2 * sz * i) / nS]);
        for (let i = 0; i < nC; i++) { const a = Math.PI + (Math.PI * i) / nC; pts.push([R * Math.cos(a), -sz + R * Math.sin(a)]); }
        const segs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          // varco davanti ai propilei per l'ingresso del corteo
          if (Math.abs((a[0] + b[0]) / 2 - L.propilei.x) < L.propilei.apertura / 2 + 1 && (a[1] + b[1]) / 2 < -sz) {
            arch.box(0.13, 1.15, 0.13, a[0], 0.575, a[1], WOOD);
            arch.box(0.13, 1.15, 0.13, b[0], 0.575, b[1], WOOD);
            continue;
          }
          segs.push([a, b]);
        }
        const im = new THREE.InstancedMesh(fm.build(), lambertVC(), segs.length);
        segs.forEach(([a, b], i) => {
          const dx = b[0] - a[0], dz = b[1] - a[1];
          im.setMatrixAt(i, mat(a[0], 0, a[1], Math.atan2(dx, dz), 1, 1, Math.hypot(dx, dz) / SEG));
        });
        im.castShadow = !lite;
        im.receiveShadow = true;
        scene.add(im);
      }

      // ---------- tribune ----------
      // Tribune e strutture alte non proiettano ombre: il frustum del sole (±25 m attorno al cavallo)
      // taglierebbe le loro ombre lunghe con bordi netti che si spostano col cavallo.
      const stands = new Merger();
      const RAIL = 0x3c4246;
      const arcsOf = (st) => (st.gap ? [[st.a0, Math.PI / 2 - st.gap], [Math.PI / 2 + st.gap, st.a1]] : [[st.a0, st.a1]]);
      const arcPt = (st, r, a) => [r * Math.cos(a), st.cz + st.dir * r * Math.sin(a)];
      // polilinea [x, z] del bordo di una tribuna a distanza d dal campo
      const edgeOf = (st, d) => {
        if (st.kind === 'straight') return [[[st.side * (st.x0 + d), st.z0], [st.side * (st.x0 + d), st.z1]]];
        return arcsOf(st).map(([a0, a1]) => {
          const n = Math.ceil((a1 - a0) / 0.06), out = [];
          for (let i = 0; i <= n; i++) out.push(arcPt(st, st.r0 + d, a0 + ((a1 - a0) * i) / n));
          return out;
        });
      };
      const railing = (m, line, y, h, post) => {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], b = line[i + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.round(len / post));
          for (let k = 0; k < n; k++) {
            const x0 = a[0] + ((b[0] - a[0]) * k) / n, z0 = a[1] + ((b[1] - a[1]) * k) / n;
            m.box(0.05, h, 0.05, x0, y + h / 2, z0, RAIL);
          }
          m.beam(a[0], a[1], b[0], b[1], y + h, 0.06, 0.06, RAIL);
          m.beam(a[0], a[1], b[0], b[1], y + h * 0.5, 0.03, 0.03, RAIL);
        }
        const e = line[line.length - 1];
        m.box(0.05, h, 0.05, e[0], y + h / 2, e[1], RAIL);
      };
      for (const st of L.stands) {
        const conc = st.material === 'cemento';
        const top = new THREE.Color(conc ? 0xd3cec3 : 0xa3a9aa);
        const side = new THREE.Color(conc ? 0xc2bdb1 : 0x6a7276);
        // la tribuna coperta guarda a est: col sole a ovest è in ombra
        if (st.roof) { top.multiplyScalar(0.78); side.multiplyScalar(0.78); }
        for (let row = 0; row < st.rows; row++) {
          const y1 = st.baseY + row * st.rowHeight;
          const dIn = row * st.rowDepth, dOut = dIn + st.rowDepth;
          const last = row === st.rows - 1;
          if (st.kind === 'straight') {
            const xi = st.side * (st.x0 + dIn), xo = st.side * (st.x0 + dOut);
            stands.prism([[xi, st.z0], [xo, st.z0], [xo, st.z1], [xi, st.z1]], 0, y1, top, side, [true, last, true, true]);
          } else {
            for (const [a0, a1] of arcsOf(st)) {
              const n = Math.ceil((a1 - a0) / 0.035);
              for (let i = 0; i < n; i++) {
                const b0 = a0 + ((a1 - a0) * i) / n, b1 = a0 + ((a1 - a0) * (i + 1)) / n;
                const r0 = st.r0 + dIn, r1 = st.r0 + dOut;
                stands.prism([arcPt(st, r0, b0), arcPt(st, r1, b0), arcPt(st, r1, b1), arcPt(st, r0, b1)], 0, y1, top, side, [i === 0, last, i === n - 1, true]);
              }
            }
          }
        }
        for (const line of edgeOf(st, 0.08)) railing(stands, line, st.baseY, 1.0, 2);
        const yTop = st.baseY + (st.rows - 1) * st.rowHeight;
        if (!st.roof) for (const line of edgeOf(st, st.rows * st.rowDepth - 0.08)) railing(stands, line, yTop, 1.1, 2);
        if (st.roof) {
          // tettoia a sbalzo in cemento retta dal muro di fondo
          const CEM = 0xc9c4b8;
          const back = st.x0 + st.rows * st.rowDepth;
          const yR = 11.2, zc = (st.z0 + st.z1) / 2, len = st.z1 - st.z0 + 1;
          const xIn = st.x0 - 0.8, xOut = back + 0.6;
          stands.box(0.5, yR, len, st.side * (back + 0.25), yR / 2, zc, CEM);
          stands.box(xOut - xIn, 0.35, len, st.side * (xIn + xOut) / 2, yR + 0.2, zc, CEM);
          stands.box(0.25, 0.9, len, st.side * xIn, yR, zc, 0xe2ded4);
          for (let z = st.z0; z <= st.z1 + 0.01; z += (st.z1 - st.z0) / 12) {
            const ribL = xOut - xIn - 0.3;
            stands.box(ribL, 0.7, 0.3, st.side * (xIn + xOut) / 2, yR - 0.3, z, CEM, 0, 0, st.side * -0.03);
          }
        }
      }

      // ---------- propilei (ref_01, ref_03) ----------
      {
        const pr = L.propilei, pm = new Merger();
        const W = 0xf1efe8, W2 = 0xe2dfd6;
        const pw = 2.4, pd = 1.8, ph = 8.2;
        const yel = C(Q.COMUNE.c2), red = C(Q.COMUNE.c1);
        for (const sgn of [-1, 1]) {
          const x = sgn * (pr.apertura / 2 + pw / 2);
          pm.box(pw, ph, pd, x, ph / 2, 0, W);
          pm.box(pw + 0.25, 0.3, pd + 0.25, x, ph + 0.15, 0, W2);
          pm.box(pw - 0.5, 0.55, pd - 0.5, x, ph + 0.57, 0, W);
          pm.box(pw - 1.1, 0.5, pd - 1.0, x, ph + 1.1, 0, W);
          pm.box(pw + 0.15, 0.6, pd + 0.15, x, 0.3, 0, W2);
          // nicchia ad arco: metà gialla, metà rossa, su entrambe le facce
          const nw = 0.8, y0 = 0.9, yA = 6.4;
          for (const face of [1, -1]) {
            const zf = face * (pd / 2 + 0.012);
            for (const half of [-1, 1]) {
              const sh = new THREE.Shape();
              sh.moveTo(0, y0);
              sh.lineTo(half * nw, y0);
              sh.lineTo(half * nw, yA);
              sh.absarc(0, yA, nw, half > 0 ? 0 : Math.PI, Math.PI / 2, half < 0);
              sh.lineTo(0, y0);
              const g = new THREE.ShapeGeometry(sh, 10);
              const ry = face > 0 ? 0 : Math.PI;
              pm.geo(g, (half < 0) === (face > 0) ? yel : red, mat(x, 0, zf, ry));
            }
            // cornice in rilievo attorno alla nicchia
            pm.box(0.14, yA - y0, 0.06, x - nw - 0.07, (y0 + yA) / 2, face * (pd / 2 + 0.03), W2);
            pm.box(0.14, yA - y0, 0.06, x + nw + 0.07, (y0 + yA) / 2, face * (pd / 2 + 0.03), W2);
            pm.box(2 * nw + 0.28, 0.14, 0.06, x, y0 - 0.07, face * (pd / 2 + 0.03), W2);
            pm.box(2 * nw + 0.28, 0.2, 0.08, x, yA + nw + 0.25, face * (pd / 2 + 0.04), W2);
          }
          // muretto bianco verso le tribune
          pm.box(2.6, 2.4, 0.5, x + sgn * (pw / 2 + 1.3), 1.2, 0, W2);
        }
        // architrave basso tra i piloni
        pm.box(pr.apertura + 0.4, 0.75, 0.9, 0, 5.0, 0, W);
        pm.box(0.35, 5.0, 0.35, -pr.apertura / 2 + 0.6, 2.5, 0, W2);
        pm.box(0.35, 5.0, 0.35, pr.apertura / 2 - 0.6, 2.5, 0, W2);
        arch.geo(pm.build(), null, mat(pr.x, 0, pr.z, pr.yaw));
      }

      // ---------- palco del Magnifico Messere ----------
      {
        const pc = L.palco, h = pc.h;
        const x0 = pc.cx - pc.w / 2, x1 = pc.cx + pc.w / 2, z0 = pc.cz - pc.d / 2, z1 = pc.cz + pc.d / 2;
        const red = C(Q.COMUNE.c1), yel = C(Q.COMUNE.c2);
        arch.box(pc.w - 0.1, h - 0.15, pc.d - 0.1, pc.cx, (h - 0.15) / 2, pc.cz, 0x4b3a2a);
        arch.box(pc.w, 0.15, pc.d, pc.cx, h - 0.075, pc.cz, 0x8c5e34);
        // drappi a strisce rosse e gialle sui quattro lati
        const sides = [
          [[x1, z0], [x1, z1], [1, 0]], [[x0, z1], [x0, z0], [-1, 0]],
          [[x1, z1], [x0, z1], [0, 1]], [[x0, z0], [x1, z0], [0, -1]],
        ];
        for (const [a, b, nrm] of sides) {
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.round(len / 0.75);
          for (let i = 0; i < n; i++) {
            const t0 = i / n, t1 = (i + 1) / n;
            const p0 = [a[0] + (b[0] - a[0]) * t0 + nrm[0] * 0.03, a[1] + (b[1] - a[1]) * t0 + nrm[1] * 0.03];
            const p1 = [a[0] + (b[0] - a[0]) * t1 + nrm[0] * 0.03, a[1] + (b[1] - a[1]) * t1 + nrm[1] * 0.03];
            const hint = [nrm[0], 0, nrm[1]];
            arch.quad([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], h - 0.02, p1[1]], [p0[0], h - 0.02, p0[1]], i % 2 ? yel : red, hint);
          }
          arch.beam(a[0] + nrm[0] * 0.05, a[1] + nrm[1] * 0.05, b[0] + nrm[0] * 0.05, b[1] + nrm[1] * 0.05, h - 0.12, 0.04, 0.2, yel);
        }
        // baldacchino su 4 pali agli angoli: il piano resta libero
        const top = h + 3.3, GOLD = 0xc9a14a;
        for (const x of [x0 + 0.2, x1 - 0.2]) for (const z of [z0 + 0.2, z1 - 0.2]) {
          arch.cyl(0.06, 0.07, 3.3, x, h, z, GOLD);
        }
        arch.box(pc.w + 0.3, 0.12, pc.d + 0.3, pc.cx, top + 0.06, pc.cz, red);
        arch.geo(gableGeo(pc.d + 0.3, 0.9, pc.w + 0.3), red, mat(pc.cx, top + 0.12, pc.cz, Math.PI / 2));
        const valance = (ax, az, bx, bz) => {
          const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 0.5);
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            arch.box(0.46, 0.4, 0.46, ax + (bx - ax) * t, top - 0.18, az + (bz - az) * t, i % 2 ? red : yel, Math.atan2(bx - ax, bz - az), 0, 0);
          }
        };
        const vx0 = x0 - 0.15, vx1 = x1 + 0.15, vz0 = z0 - 0.15, vz1 = z1 + 0.15;
        valance(vx0, vz0, vx1, vz0); valance(vx1, vz0, vx1, vz1); valance(vx1, vz1, vx0, vz1); valance(vx0, vz1, vx0, vz0);
        // scaletta sul lato sud
        const nSteps = 5, run = 0.32;
        for (let i = 0; i < nSteps; i++) {
          const y = (h * (nSteps - i)) / (nSteps + 1);
          arch.box(1.4, y, run, pc.cx + pc.w / 2 - 1.2, y / 2, z1 + 0.05 + run * (i + 0.5), 0x7a5230);
        }
      }

      // ---------- pennoni con stendardi, torri faro ----------
      const banners = [];
      {
        const cols = Q.SESTIERI.map((s) => [s.c1, s.c2]).concat([[Q.COMUNE.c1, Q.COMUNE.c2]]);
        const poles = [];
        const nord = L.stands.find((s) => s.id === 'nord'), sud = L.stands.find((s) => s.id === 'sud');
        const est = L.stands.find((s) => s.id === 'est'), ovest = L.stands.find((s) => s.id === 'ovest');
        const rN = nord.r0 + nord.rows * nord.rowDepth + 1.8, rS = sud.r0 + sud.rows * sud.rowDepth + 1.8;
        for (const a of [0.45, 0.95, Math.PI - 0.95, Math.PI - 0.45]) {
          poles.push(arcPt(nord, rN, a), arcPt(sud, rS, a));
        }
        const xE = est.x0 + est.rows * est.rowDepth + 2, xO = -(ovest.x0 + ovest.rows * ovest.rowDepth + 2.3);
        for (const z of [-36, -12, 12, 36]) poles.push([xE, z]);
        poles.push([-53, -44], [xO, -18], [xO, 18], [-53, 44]);
        poles.forEach((p, i) => {
          const H = 15;
          stands.cyl(0.07, 0.11, H, p[0], 0, p[1], 0xe8e6e0, 6);
          banners.push({ x: p[0], z: p[1], y: H - 0.5, w: 1.4, h: 4.6, col: i % cols.length });
        });
        // due stendardi del Comune sopra i propilei
        const pr = L.propilei;
        for (const sgn of [-1, 1]) {
          const lx = sgn * (pr.apertura / 2 + 1.2);
          const x = pr.x + lx * Math.cos(pr.yaw), z = pr.z - lx * Math.sin(pr.yaw);
          stands.cyl(0.05, 0.07, 4, x, 9.6, z, 0xe8e6e0, 6);
          banners.push({ x, z, y: 13.2, w: 1.0, h: 2.8, col: cols.length - 1 });
        }
        for (const b of banners) {
          const f = Math.hypot(b.x, b.z) || 1;
          b.fx = -b.x / f; b.fz = -b.z / f; // il drappo guarda il campo
          b.rx = -b.fz; b.rz = b.fx;
          stands.beam(b.x - b.rx * (b.w / 2 + 0.1), b.z - b.rz * (b.w / 2 + 0.1), b.x + b.rx * (b.w / 2 + 0.1), b.z + b.rz * (b.w / 2 + 0.1), b.y + 0.05, 0.05, 0.05, 0xe8e6e0);
          stands.geo(new THREE.SphereGeometry(0.13, 8, 6), 0xd4b04a, mat(b.x, b.y + 0.55, b.z));
        }

        // torri faro agli angoli, fari rivolti al campo
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = sx * 58, z = sz * 62, H = 28;
          stands.cyl(0.32, 0.6, H, x, 0, z, 0x8e9296, 8);
          const yaw = Math.atan2(-x, -z);
          const fwd = [Math.sin(yaw), Math.cos(yaw)], rgt = [Math.cos(yaw), -Math.sin(yaw)];
          stands.box(4.4, 2.8, 0.25, x, H + 0.8, z, 0x6d7276, yaw);
          for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
            const u = (i - 1.5) * 1.05, v = H + 0.15 + j * 1.3;
            stands.box(0.9, 0.9, 0.4, x + rgt[0] * u + fwd[0] * 0.3, v, z + rgt[1] * u + fwd[1] * 0.3, 0xf3efdc, yaw, -0.25);
          }
        }
      }
      {
        const sm = new THREE.Mesh(stands.build(), lambertVC());
        sm.receiveShadow = true;
        scene.add(sm);
        const am = new THREE.Mesh(arch.build(), lambertVC());
        am.castShadow = !lite;
        am.receiveShadow = true;
        scene.add(am);
      }

      // stendardi animati: un'unica geometria con atlante dei colori
      const NX = 4, NY = 10, PER = (NX + 1) * (NY + 1);
      const COLS = 8;
      const atlas = canvasTex(512, 256, (g) => {
        const cols = Q.SESTIERI.map((s) => [s.c1, s.c2]).concat([[Q.COMUNE.c1, Q.COMUNE.c2]]);
        cols.forEach(([a, b], i) => {
          const x = i * 64;
          g.fillStyle = a; g.fillRect(x, 0, 32, 256);
          g.fillStyle = b; g.fillRect(x + 32, 0, 32, 256);
          g.fillStyle = '#d9b44a'; g.fillRect(x, 0, 64, 10); g.fillRect(x, 236, 64, 20);
        });
      });
      const bPos = new Float32Array(banners.length * PER * 3);
      const bUv = new Float32Array(banners.length * PER * 2);
      const bIdx = [];
      const bBase = new Float32Array(banners.length * PER * 3);
      banners.forEach((b, k) => {
        b.phase = k * 1.7;
        for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
          const u = i / NX;
          // coda a punta: il bordo inferiore risale al centro
          const v = j < NY ? j / NY : 1 - 0.16 * (1 - Math.abs(2 * u - 1));
          const n = k * PER + j * (NX + 1) + i;
          bBase.set([b.x + b.rx * (u - 0.5) * b.w + b.fx * 0.12, b.y - v * b.h, b.z + b.rz * (u - 0.5) * b.w + b.fz * 0.12], n * 3);
          bUv.set([(b.col * 64 + 2 + u * 60) / (64 * COLS), 1 - v], n * 2);
          if (i < NX && j < NY) bIdx.push(n, n + NX + 1, n + 1, n + 1, n + NX + 1, n + NX + 2);
        }
      });
      bPos.set(bBase);
      const bGeo = new THREE.BufferGeometry();
      bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
      bGeo.setAttribute('uv', new THREE.BufferAttribute(bUv, 2));
      bGeo.setIndex(bIdx);
      bGeo.computeVertexNormals();
      const bMesh = new THREE.Mesh(bGeo, new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide }));
      bMesh.frustumCulled = false;
      scene.add(bMesh);
      function waveBanners(t) {
        banners.forEach((b, k) => {
          for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
            const n = (k * PER + j * (NX + 1) + i) * 3;
            const u = i / NX, v = j / NY;
            const d = v * (0.32 * Math.sin(t * 2.4 + v * 3.1 - u * 1.3 + b.phase) + 0.1 * Math.sin(t * 4.3 + v * 5 + b.phase * 1.7));
            const s = v * 0.12 * Math.sin(t * 1.6 + b.phase);
            bPos[n] = bBase[n] + b.fx * d + b.rx * s;
            bPos[n + 1] = bBase[n + 1] + Math.abs(d) * 0.15;
            bPos[n + 2] = bBase[n + 2] + b.fz * d + b.rz * s;
          }
        });
        bGeo.attributes.position.needsUpdate = true;
        bGeo.computeVertexNormals();
      }

      // ---------- fuori dall'arena: Forte Malatesta, San Vittore ----------
      const far = new Merger();
      const STONE = 0xcdbd9a, STONE2 = 0xb7a581, ROOF = 0xa95e3a, DARK = 0x3a332b;
      {
        const f = L.forteMalatesta, y = hillH(f.x, f.z);
        // bastione poligonale a scarpa
        const n = 7, rb = 25, rt = 22.5, h0 = y - 6, h1 = y + 9;
        const ring = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.3;
          const k = 1 + 0.12 * Math.sin(i * 2.3);
          ring.push([Math.cos(a) * k, Math.sin(a) * k]);
        }
        for (let i = 0; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n];
          const hint = [a[0] + b[0], 0.3, a[1] + b[1]];
          far.quad([f.x + a[0] * rb, h0, f.z + a[1] * rb], [f.x + b[0] * rb, h0, f.z + b[1] * rb], [f.x + b[0] * rt, h1, f.z + b[1] * rt], [f.x + a[0] * rt, h1, f.z + a[1] * rt], STONE, hint);
          far.tri([f.x, h1, f.z], [f.x + a[0] * rt, h1, f.z + a[1] * rt], [f.x + b[0] * rt, h1, f.z + b[1] * rt], STONE2, UP);
          // merli lungo il ciglio
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * rt, m = Math.floor(len / 2.4);
          for (let j = 0; j < m; j++) {
            const t = (j + 0.5) / m;
            const x = f.x + (a[0] + (b[0] - a[0]) * t) * (rt - 0.4), z = f.z + (a[1] + (b[1] - a[1]) * t) * (rt - 0.4);
            far.box(1.1, 1.1, 0.7, x, h1 + 0.55, z, STONE, Math.atan2(b[0] - a[0], b[1] - a[1]));
          }
        }
        // torrioni tondi su due vertici
        for (const i of [1, 4]) {
          const a = ring[i];
          far.cyl(6.5, 7.5, 18, f.x + a[0] * rt, h0, f.z + a[1] * rt, STONE2, 16);
        }
        // palazzo con tetto in coppi (ref_02)
        const pw = 26, pd = 14, phh = 13, yaw = 0.35;
        far.box(pw, phh, pd, f.x + 2, h1 + phh / 2, f.z - 1, STONE, yaw);
        far.geo(hipGeo(), ROOF, mat(f.x + 2, h1 + phh, f.z - 1, yaw, pw + 1, 3.2, pd + 1));
        for (let i = 0; i < 6; i++) for (const side of [1, -1]) {
          const lx = -pw / 2 + 2.5 + i * ((pw - 5) / 5), lz = side * (pd / 2 + 0.05);
          const c = Math.cos(yaw), s = Math.sin(yaw);
          for (const fy of [4.5, 9]) far.box(0.9, 1.4, 0.1, f.x + 2 + lx * c + lz * s, h1 + fy, f.z - 1 - lx * s + lz * c, DARK, yaw);
        }
      }
      {
        const sv = L.sanVittore, y = hillH(sv.x, sv.z), yaw = 0.15;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const at = (lx, lz) => [sv.x + lx * c + lz * s, sv.z - lx * s + lz * c];
        const nl = 24, nw = 11, nh = 9;
        let p = at(0, 0);
        far.box(nl, nh + 2, nw, p[0], y - 2 + (nh + 2) / 2, p[1], 0xd8c7a2, yaw);
        far.geo(gableGeo(nl + 0.6, 3.4, nw + 0.8), ROOF, mat(p[0], y + nh, p[1], yaw));
        // abside a est
        p = at(nl / 2, 0);
        far.geo(new THREE.CylinderGeometry(4.5, 4.5, nh - 1.5, 16, 1, false, 0, Math.PI), 0xd2c09a, mat(p[0], y + (nh - 1.5) / 2 - 1, p[1], yaw));
        far.geo(new THREE.ConeGeometry(4.9, 2.4, 16, 1, false, 0, Math.PI), ROOF, mat(p[0], y + nh - 2.5 + 1.2, p[1], yaw));
        // facciata a ovest: portale e rosone
        p = at(-nl / 2 - 0.05, 0);
        far.box(0.1, 3.4, 2, p[0], y + 1.7, p[1], DARK, yaw);
        far.geo(new THREE.CircleGeometry(1.2, 16), DARK, mat(p[0], y + 6.2, p[1], yaw - Math.PI / 2));
        // campanile quadrato con cuspide
        p = at(-nl / 2 + 3, -nw / 2 - 3.2);
        const th = 24;
        far.box(6, th + 2, 6, p[0], y - 2 + (th + 2) / 2, p[1], 0xcfbd97, yaw);
        far.geo(new THREE.ConeGeometry(4.4, 4.5, 4), ROOF, mat(p[0], y + th + 2.25, p[1], yaw + Math.PI / 4));
        for (const [lx, lz] of [[3.05, 0], [-3.05, 0], [0, 3.05], [0, -3.05]]) {
          const q = at(-nl / 2 + 3 + lx, -nw / 2 - 3.2 + lz);
          far.box(lz ? 1.4 : 0.1, 2.4, lz ? 0.1 : 1.4, q[0], y + th - 2.5, q[1], DARK, yaw);
        }
      }
      scene.add(new THREE.Mesh(far.build(), lambertVC()));

      // ---------- case ----------
      const houses = [];
      {
        const nearLandmark = (x, z, d) => Math.hypot(x - L.forteMalatesta.x, z - L.forteMalatesta.z) < 40 + d || Math.hypot(x - L.sanVittore.x, z - L.sanVittore.z) < 26 + d;
        let tries = 0;
        while (houses.length < 64 && tries++ < 8000) {
          const a = rnd() * Math.PI * 2;
          const r = 84 + Math.pow(rnd(), 1.3) * 230;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          // il paese si arrampica sulle colline a nord e a est (ref_01, ref_02)
          if (rnd() > 0.3 + 0.7 * Math.max(0, -z / r, x / r)) continue;
          if (inStadium(x, z, R + 32) || nearLandmark(x, z, 0)) continue;
          const w = 9 + rnd() * 6, d = 7 + rnd() * 3;
          if (houses.some((hh) => Math.hypot(hh.x - x, hh.z - z) < (hh.w + w) * 0.55 + 2)) continue;
          const floors = 2 + Math.floor(rnd() * 3);
          const rad = Math.hypot(w, d) / 2;
          let hmin = Infinity, hmax = -Infinity;
          for (let k = 0; k < 4; k++) {
            const hk = hillH(x + Math.cos(k * 1.57) * rad, z + Math.sin(k * 1.57) * rad);
            hmin = Math.min(hmin, hk); hmax = Math.max(hmax, hk);
          }
          const y0 = hmin - 1.5, top = hmax + floors * 3.1;
          houses.push({ x, z, w, d, y0, hT: top - y0, roofH: 1.6 + d * 0.12, yaw: Math.atan2(-x, -z) + (rnd() - 0.5) * 0.6 });
        }
        const winTex = canvasTex(128, 128, (g, w, h) => {
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
          speckle(g, w, h, 600, ['#f1ece4', '#e8e2d8'], rnd, 3);
          for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
            const x = 10 + i * 30, y = 14 + j * 40;
            g.fillStyle = '#6b5a45'; g.fillRect(x - 3, y, 20, 24);
            g.fillStyle = '#3a342e'; g.fillRect(x + 1, y + 2, 12, 20);
          }
        });
        const wallG = new THREE.BoxGeometry(1, 1, 1);
        wallG.translate(0, 0.5, 0);
        const walls = new THREE.InstancedMesh(wallG, new THREE.MeshLambertMaterial({ map: winTex }), houses.length);
        const roofs = new THREE.InstancedMesh(hipGeo(), new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length);
        const pastel = [0xe8d3a9, 0xe6c79c, 0xf0dcc0, 0xdcb89a, 0xefe3c8, 0xd9a982, 0xe9cfa0, 0xcfb59a, 0xf2e2b0, 0xe4bfa6, 0xe7d9c3];
        const tiles = [0xb5653d, 0xa85a36, 0xc27448, 0x9c5232, 0xb86e48];
        houses.forEach((hh, i) => {
          walls.setMatrixAt(i, mat(hh.x, hh.y0, hh.z, hh.yaw, hh.w, hh.hT, hh.d));
          walls.setColorAt(i, C(pastel[i % pastel.length]));
          roofs.setMatrixAt(i, mat(hh.x, hh.y0 + hh.hT, hh.z, hh.yaw, hh.w + 0.8, hh.roofH, hh.d + 0.8));
          roofs.setColorAt(i, C(tiles[i % tiles.length]));
        });
        scene.add(walls, roofs);
      }

      // ---------- alberi: cipressi e chiome tonde ----------
      {
        const clear = (x, z, m) => {
          if (inStadium(x, z, R + 28)) return false;
          if (Math.hypot(x - L.forteMalatesta.x, z - L.forteMalatesta.z) < 38 || Math.hypot(x - L.sanVittore.x, z - L.sanVittore.z) < 22) return false;
          return !houses.some((hh) => Math.hypot(hh.x - x, hh.z - z) < hh.w * 0.6 + m);
        };
        const round = [];
        let tries = 0;
        while (round.length < 1600 && tries++ < 40000) {
          const a = rnd() * Math.PI * 2, r = 92 + rnd() * 680;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          const h = hillH(x, z);
          if (rnd() > 0.1 + 0.9 * smooth(h / 40) * smooth((forestN(x, z) - 0.3) * 2.5)) continue;
          if (!clear(x, z, 3)) continue;
          const cr = 2.6 + rnd() * 2 + r / 320;
          round.push({ x, z, y: h, cr, th: cr * 0.9 });
        }
        const cyp = [];
        tries = 0;
        while (cyp.length < 80 && tries++ < 8000) {
          const a = rnd() * Math.PI * 2, r = cyp.length < 40 ? 70 + rnd() * 45 : 110 + rnd() * 220;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (!clear(x, z, 2)) continue;
          cyp.push({ x, z, y: hillH(x, z) - 0.3, h: 9 + rnd() * 8, r: 1.1 + rnd() * 0.6 });
        }
        if (lite) round.splice(0, round.length, ...round.filter((t, i) => i % 8 < 3));
        const crownG = new THREE.IcosahedronGeometry(1, lite ? 0 : 1);
        const trunkG = new THREE.CylinderGeometry(0.16, 0.24, 1, lite ? 3 : 5, 1, lite);
        trunkG.translate(0, 0.5, 0);
        const cypG = new THREE.LatheGeometry([[0, 0], [0.55, 0.3], [0.95, 1.6], [1, 3.2], [0.85, 5.5], [0.55, 7.6], [0.2, 9.3], [0, 10]].map((p) => new THREE.Vector2(p[0], p[1])), 8);
        const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff }), round.length);
        const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x5a4330 }), round.length);
        const cyps = new THREE.InstancedMesh(cypG, new THREE.MeshLambertMaterial({ color: 0xffffff }), cyp.length);
        const tmp = new THREE.Color();
        round.forEach((t, i) => {
          crowns.setMatrixAt(i, mat(t.x, t.y + t.th + t.cr * 0.7, t.z, rnd() * 6, t.cr, t.cr * 0.9, t.cr));
          crowns.setColorAt(i, tmp.setHSL(0.22 + rnd() * 0.08, 0.35 + rnd() * 0.15, 0.17 + rnd() * 0.09));
          trunks.setMatrixAt(i, mat(t.x, t.y, t.z, 0, t.cr * 0.5, t.th + 0.5, t.cr * 0.5));
        });
        cyp.forEach((t, i) => {
          cyps.setMatrixAt(i, mat(t.x, t.y, t.z, 0, t.r, t.h / 10, t.r));
          cyps.setColorAt(i, tmp.setHSL(0.27 + rnd() * 0.04, 0.38, 0.17 + rnd() * 0.05));
        });
        scene.add(crowns, trunks, cyps);
      }

      return {
        sun,
        update(dt, t) {
          waveBanners(t);
        },
      };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
