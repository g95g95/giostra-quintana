(function (root) {
  const Q = (root.Q = root.Q || {});

  // Colori dai dati ufficiali; il simbolo c'è solo dove la ricerca lo conferma.
  Q.SESTIERI = [
    { id: 'piazzarola', nome: 'Piazzarola', c1: '#f4f1e8', c2: '#c8141c', simbolo: 'aquila' },
    { id: 'maggiore', nome: 'Porta Maggiore', c1: '#16181a', c2: '#1f8a3b', simbolo: null },
    { id: 'romana', nome: 'Porta Romana', c1: '#c8141c', c2: '#3aa0e0', simbolo: 'unicorno' },
    { id: 'solesta', nome: 'Porta Solestà', c1: '#f2c40f', c2: '#1c3fa8', simbolo: null },
    { id: 'tufilla', nome: 'Porta Tufilla', c1: '#c8141c', c2: '#16181a', simbolo: null },
    { id: 'emidio', nome: "Sant'Emidio", c1: '#c8141c', c2: '#1f8a3b', simbolo: null },
  ];

  // Colori civici di Ascoli (gruppo comunale, propilei, palco).
  Q.COMUNE = { c1: '#c8141c', c2: '#f2c40f' };

  Q.sestiere = function (id) {
    return Q.SESTIERI.find((s) => s.id === id) || Q.SESTIERI[0];
  };
})(typeof window !== 'undefined' ? window : globalThis);
