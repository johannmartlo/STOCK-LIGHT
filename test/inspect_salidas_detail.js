const fs = require('fs');
const path = require('path');

const salidasDir = path.join(__dirname, '..', 'docs', 'samples', 'SALIDAS');
const files = fs.readdirSync(salidasDir).filter(f => f.endsWith('.extracted.txt'));

files.forEach(f => {
  console.log(`\n==============================================`);
  console.log(` ARCHIVO DE SALIDA: ${f}`);
  console.log(`==============================================`);
  const text = fs.readFileSync(path.join(salidasDir, f), 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // Buscar cabecera de documento
  const albMatch = text.match(/AVT\d{2}[\d\.]+/i);
  const cliMatch = text.match(/43\d{7,10}\s*(?:\r?\n)\s*([^\n\r]+)/i);
  const fechaMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:\r?\n)\s*FECHA ALB/i);

  console.log(`Albarán: ${albMatch ? albMatch[0] : 'N/A'} | Fecha: ${fechaMatch ? fechaMatch[1] : 'N/A'} | Cliente: ${cliMatch ? cliMatch[1] : 'N/A'}`);

  // Buscar bloque de suma
  const sumaMatch = text.match(/Suma\s*:\s*(?:\r?\n)?\s*(\d+)/i) || text.match(/(\d{1,6})\s*(?:\r?\n)\s*[\d\.,]+\s*(?:\r?\n)\s*Suma\s*:/i);
  console.log(`Total Envases (Suma): ${sumaMatch ? sumaMatch[1] : 'N/A'}`);

  // Artículos y envases
  const tableStart = lines.findIndex(l => l.includes('Tipo Envase'));
  const tableEnd = lines.findIndex(l => l.includes('Suma :'));
  if (tableStart !== -1 && tableEnd !== -1) {
    const tableSnippet = lines.slice(tableStart, tableEnd + 2).join(' | ');
    console.log('Snippet tabla:', tableSnippet.slice(0, 300));
  }
});
