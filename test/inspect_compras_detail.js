const fs = require('fs');
const path = require('path');

const comprasDir = path.join(__dirname, '..', 'docs', 'samples', 'COMPRAS');
const files = fs.readdirSync(comprasDir).filter(f => f.endsWith('.extracted.txt'));

files.forEach(f => {
  console.log(`\n==============================================`);
  console.log(` ARCHIVO: ${f}`);
  console.log(`==============================================`);
  const text = fs.readFileSync(path.join(comprasDir, f), 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // Buscar bloque de productos (entre "ACT26" y "BASE IMPONIBLE" o "CUOTA I.V.A.")
  const start = lines.findIndex(l => l.startsWith('ACT26'));
  const end = lines.findIndex(l => l.includes('BASE IMPONIBLE') || l.includes('CUOTA I.V.A.') || l.includes('LÍQUIDO A PAGAR'));

  if (start !== -1 && end !== -1) {
    console.log(lines.slice(start, end).join('\n'));
  } else {
    console.log(lines.slice(0, 50).join('\n'));
  }
});
