(function (root) {
  const Q = (root.Q = root.Q || {});

  const TAU = Math.PI * 2;
  const SPIN_TIME = 2.2; // secondi: il busto torna fermo entro 2,5 s
  const FACE_R = 0.33;
  const RING_COLORS = ['#f2c40f', '#c8141c', '#f4f1e8', '#c8141c', '#f4f1e8'];
  const UP = new THREE.Vector3(0, 1, 0);

  function targetTexture() {
    const N = 512, px = N / 2 / FACE_R;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    g.fillStyle = '#2d2620';
    g.fillRect(0, 0, N, N);
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    for (let i = Q.RULES.RINGS.length - 1; i >= 0; i--) {
      g.beginPath();
      g.arc(N / 2, N / 2, (i + 1) * Q.RULES.RING_STEP * px, 0, TAU);
      g.fillStyle = RING_COLORS[i % RING_COLORS.length];
      g.fill();
      g.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 4;
    return t;
  }

  function between(a, b, r0, r1, n = 8) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len, n);
    geo.translate(0, len / 2, 0);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    geo.translate(a.x, a.y, a.z);
    return geo;
  }

  function lathe(pts, n) {
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
  }

  function create() {
    const m = Q.track.moro;
    const group = new THREE.Group();
    group.position.set(m.x, 0, m.z);
    group.rotation.y = m.yaw;
    // Centro dello scudo nel riferimento del gruppo (+Z verso il cavaliere in arrivo).
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
    const dx = m.shield.x - m.x, dz = m.shield.z - m.z;
    const SH = new THREE.Vector3(dx * c - dz * s, m.shield.y, dx * s + dz * c);
    const side = Math.sign(SH.x) || -1; // lato dello scudo
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    const mat = (color) => new THREE.MeshLambertMaterial({ color });
    const wood = mat('#4a2c1a'), dark = mat('#2f1c12'), iron = mat('#2c2c2e');
    const add = (geo, material, parent) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const baseGeo = new THREE.BoxGeometry(0.9, 0.22, 0.9);
    baseGeo.translate(0, 0.11, 0);
    add(baseGeo, mat('#8a857c'), group);
    add(between(V(0, 0.2, 0), V(0, 1.5, 0), 0.08, 0.065), mat('#6b4a2e'), group);

    // Il busto ruota sull'asse del palo; a riposo la rotazione torna esattamente a 0.
    const bust = new THREE.Object3D();
    group.add(bust);
    const torso = lathe([[0.001, 1.4], [0.12, 1.42], [0.17, 1.5], [0.2, 1.65], [0.25, 1.88], [0.27, 2.01], [0.22, 2.12], [0.1, 2.17], [0.001, 2.18]], 16);
    torso.scale(1, 1, 0.72);
    add(torso, wood, bust);
    const head = new THREE.SphereGeometry(0.13, 14, 10);
    head.scale(0.92, 1.05, 0.95);
    head.translate(0, 2.32, 0.01);
    add(head, dark, bust);
    add(lathe([[0.001, 2.34], [0.15, 2.35], [0.17, 2.42], [0.16, 2.5], [0.1, 2.56], [0.001, 2.585]], 14), mat('#ece6d6'), bust);

    const shoulder = (sx) => V(sx * 0.24, 2.06, 0);
    const shieldHand = V(SH.x, SH.y, SH.z - 0.07);
    add(between(shoulder(side), shieldHand, 0.065, 0.05), wood, bust);
    const maceHand = V(-side * 0.62, 1.78, 0.1);
    add(between(shoulder(-side), maceHand, 0.065, 0.05), wood, bust);

    const back = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 32);
    back.rotateX(Math.PI / 2);
    back.translate(SH.x, SH.y, SH.z - 0.022);
    add(back, mat('#7d7468'), bust);
    const face = add(new THREE.CircleGeometry(FACE_R, 48), new THREE.MeshLambertMaterial({ map: targetTexture() }), bust);
    face.position.copy(SH);
    face.name = 'scudo';

    // Mazzafrusto: manico, catena e palla chiodata; la catena si apre per la forza centrifuga.
    const gripEnd = V(-side * 0.86, 1.86, 0.1);
    add(between(maceHand, gripEnd, 0.025, 0.022), dark, bust);
    const chain = new THREE.Object3D();
    chain.position.copy(gripEnd);
    bust.add(chain);
    add(between(V(0, 0, 0), V(0, -0.42, 0), 0.012, 0.012, 5), mat('#5a5a5c'), chain);
    const ball = new THREE.SphereGeometry(0.085, 12, 8);
    ball.translate(0, -0.5, 0);
    add(ball, iron, chain);
    const spikes = new THREE.IcosahedronGeometry(0.125);
    spikes.translate(0, -0.5, 0);
    add(spikes, new THREE.MeshLambertMaterial({ color: '#3a3a3d', flatShading: true }), chain);

    let spin = null;

    function hit(points) {
      if (!(points > 0)) return;
      // Il colpo sullo scudo spinge all'indietro: rotazione nel verso che allontana lo scudo dal cavaliere.
      spin = { t: 0, A: side * TAU * (points >= 80 ? 2 : 1) };
    }

    function update(dt) {
      if (!(dt > 0)) return;
      let omega = 0;
      if (spin) {
        spin.t += dt;
        const u = spin.t / SPIN_TIME;
        if (u >= 1) {
          bust.rotation.y = 0;
          spin = null;
        } else {
          const ang = spin.A * (1 - Math.exp(-4 * u) * (1 - u) * Math.cos(3 * Math.PI * u));
          omega = (ang - bust.rotation.y) / dt;
          bust.rotation.y = ang;
        }
      }
      const open = -side * Math.atan((omega * omega * 0.86) / 9.8);
      chain.rotation.z += (open - chain.rotation.z) * (1 - Math.exp(-8 * dt));
    }

    return { group, update, hit };
  }

  Q.Moro = { create };
})(typeof window !== 'undefined' ? window : globalThis);
