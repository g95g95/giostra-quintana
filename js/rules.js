(function (root) {
  const Q = (root.Q = root.Q || {});

  const RINGS = [100, 80, 60, 40, 20];
  const RING_STEP = 0.06; // metri: bersaglio di 60 cm di diametro

  Q.RULES = {
    TORNATE: 3,
    ASSALTI: 3,
    BASE_TIME: 60,
    BASE_TIME_POINTS: 200,
    POINTS_PER_TENTH: 2,
    PEN_CORDOLO: 30,
    RINGS,
    RING_STEP,
    TARGET_RADIUS: RINGS.length * RING_STEP,

    // dist = distanza in metri tra la punta della lancia e il centro del bersaglio
    ringScore(dist) {
      const i = Math.floor(dist / RING_STEP);
      return i < RINGS.length ? RINGS[i] : 0;
    },

    // 60,0 s = 200 punti; ogni decimo in meno o in più vale +2 o -2 punti
    timePoints(seconds) {
      const tenths = Math.round(seconds * 10);
      return Math.max(0, 200 + (600 - tenths) * 2);
    },

    // t = { hits: [punti...], time: secondi, cordoli: numero penalità, nulla: bool }
    tornataScore(t) {
      if (t.nulla) return 0;
      const hits = t.hits.reduce((a, b) => a + b, 0);
      return Math.max(0, hits + this.timePoints(t.time) - t.cordoli * this.PEN_CORDOLO);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
