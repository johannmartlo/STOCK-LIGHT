/**
 * Extractor nativo de texto de PDF en Node.js puro usando zlib nativo.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function extractTextFromPdf(filePath) {
  const data = fs.readFileSync(filePath);
  const str = data.toString('latin1');
  
  const textChunks = [];
  // Expresión regular robusta para streams en PDF
  const streamRegex = /stream\r?\n?([\s\S]*?)(?:\r?\n)?endstream/g;
  let match;

  while ((match = streamRegex.exec(str)) !== null) {
    const rawStream = Buffer.from(match[1], 'latin1');
    let decompressed;
    try {
      decompressed = zlib.inflateSync(rawStream);
    } catch (e) {
      try {
        decompressed = zlib.inflateRawSync(rawStream);
      } catch (e2) {
        continue;
      }
    }

    if (decompressed) {
      const content = decompressed.toString('latin1');
      // Buscar operadores Tj y TJ
      // (texto) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(content)) !== null) {
        textChunks.push(tjMatch[1]);
      }
      // [(t) (e) (x) (t) ...] TJ
      const bigTjRegex = /\[(.*?)\]\s*TJ/g;
      let bigTjMatch;
      while ((bigTjMatch = bigTjRegex.exec(content)) !== null) {
        const inner = bigTjMatch[1];
        const parts = inner.match(/\(([^)]*)\)/g);
        if (parts) {
          textChunks.push(parts.map(p => p.slice(1, -1)).join(''));
        }
      }
    }
  }

  return textChunks.join('\n');
}

const samplesDir = path.join(__dirname, '..', 'docs', 'samples');
const files = fs.readdirSync(samplesDir).filter(f => f.endsWith('.pdf'));

files.forEach(file => {
  console.log(`\n======================================================`);
  console.log(` ARCHIVO: ${file}`);
  console.log(`======================================================`);
  const fullPath = path.join(samplesDir, file);
  const text = extractTextFromPdf(fullPath);
  console.log(text.slice(0, 3000)); // Primeros 3000 caracteres
  fs.writeFileSync(path.join(samplesDir, `${file}.extracted.txt`), text, 'utf8');
});
