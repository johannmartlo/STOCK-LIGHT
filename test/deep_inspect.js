const fs = require('fs');
const path = require('path');

const samplesDir = path.join(__dirname, '..', 'docs', 'samples');

function inspectFolder(folder, title) {
  console.log(`\n======================================================`);
  console.log(` ANALISIS DETALLADO: ${title}`);
  console.log(`======================================================`);
  const files = fs.readdirSync(folder).filter(f => f.endsWith('.extracted.txt'));

  files.forEach(f => {
    const text = fs.readFileSync(path.join(folder, f), 'utf8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    console.log(`\n--- DOCUMENTO: ${f} ---`);
    console.log('Primeras 25 líneas:');
    console.log(lines.slice(0, 25).join(' | '));

    // Buscar números de albarán o serie
    const albMatch = text.match(/(ACT\d{2}\s*\/\s*[\d\.]+|AVT\d{2}[\d\.]+|Albar[aá]n[^\n\r]+)/i);
    console.log('Identificador detectado:', albMatch ? albMatch[0] : 'NO DETECTADO');

    // Buscar fechas
    const fechaMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/g);
    console.log('Fechas encontradas:', fechaMatch ? [...new Set(fechaMatch)].join(', ') : 'NINGUNA');

    // Buscar partidas
    const partidaMatch = text.match(/(?:Partida|Nº\s*Partida)[^\n\r]+/gi);
    console.log('Partidas encontradas:', partidaMatch ? partidaMatch.join(' ; ') : 'NINGUNA');

    // Buscar líneas de producto / envases
    const envMatch = text.match(/(?:EPS\d*|CARTON|MADERA|TOMATE)[^\n\r]+/gi);
    console.log('Menciones de producto/envase:', envMatch ? envMatch.slice(0, 10).join(' ; ') : 'NINGUNA');
  });
}

inspectFolder(path.join(samplesDir, 'COMPRAS'), 'COMPRAS');
inspectFolder(path.join(samplesDir, 'SALIDAS'), 'SALIDAS');
