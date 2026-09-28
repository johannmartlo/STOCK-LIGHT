const fs = require('fs');
const path = require('path');

const samplesDir = path.join(__dirname, '..', 'docs', 'samples');

const articles = new Set();
const envases = new Set();

function scanFolder(folder) {
  const files = fs.readdirSync(folder).filter(f => f.endsWith('.extracted.txt'));
  files.forEach(f => {
    const text = fs.readFileSync(path.join(folder, f), 'utf8');
    const lines = text.split(/\r?\n/).map(l => l.trim());

    lines.forEach(l => {
      // Articulos tipicos
      if (/^TOMATE\s+[A-Z0-9\s\.\/\-_]{3,40}$/i.test(l)) {
        articles.add(l.trim());
      }
      // Envases tipicos
      if (/^(?:EPS|CARTON|MADERA|CHEP|PLASTICO|IFCO)\d*/i.test(l)) {
        // Filtrar si es linea compuesta
        const clean = l.split(/\d+\s*€|\d+\s*Kg/)[0].trim();
        if (clean.length < 35) envases.add(clean);
      }
    });
  });
}

scanFolder(path.join(samplesDir, 'COMPRAS'));
scanFolder(path.join(samplesDir, 'SALIDAS'));

console.log('ARTICULOS DETECTADOS EN MUESTRAS REALES:');
Array.from(articles).sort().forEach(a => console.log(' -', a));

console.log('\nENVASES DETECTADOS EN MUESTRAS REALES:');
Array.from(envases).sort().forEach(e => console.log(' -', e));
