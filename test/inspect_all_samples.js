const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function extractTextFromPdf(filePath) {
  const data = fs.readFileSync(filePath);
  const str = data.toString('latin1');
  
  const textChunks = [];
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
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(content)) !== null) {
        textChunks.push(tjMatch[1]);
      }
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

function processFolder(folderPath, category) {
  if (!fs.existsSync(folderPath)) return;
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.pdf'));
  console.log(`\n======================================================`);
  console.log(` CATEGORIA: ${category} (${files.length} archivos)`);
  console.log(`======================================================`);

  files.forEach(file => {
    const fullPath = path.join(folderPath, file);
    const text = extractTextFromPdf(fullPath);
    const txtPath = path.join(folderPath, `${file}.extracted.txt`);
    fs.writeFileSync(txtPath, text, 'utf8');
    console.log(`-> Procesado: ${file} (texto: ${text.length} caracteres)`);
  });
}

const samplesDir = path.join(__dirname, '..', 'docs', 'samples');
processFolder(path.join(samplesDir, 'COMPRAS'), 'ALBARANES DE COMPRA');
processFolder(path.join(samplesDir, 'SALIDAS'), 'ALBARANES DE SALIDA');
