/**
 * STOCK-LIGHT — SalidaParser.js
 * 
 * Parser calibrado para Albaranes de Salida / Venta de Hispatec (Crystal Reports).
 * Verificado con muestra real: AVT26 6227 ALBARAN DE VENTA.pdf
 * 
 * REGLA CRÍTICA:
 * - Extrae exclusivamente Nº. Envases (Cajas).
 * - Ignora Kilos Brutos y Kilos Netos.
 */

// Importación condicional para Node.js
if (typeof createNormalizedDocument === 'undefined' && typeof require !== 'undefined') {
  var { createNormalizedDocument, createNormalizedLine } = require('../NormalizedDocument');
}

class SalidaParser {
  canParse(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    const upper = rawText.toUpperCase();
    return (
      (upper.includes('ALBARAN DE VENTA') || upper.includes('ALBARÁN DE VENTA') ||
       upper.includes('FECHA ALB.') || upper.includes('AVT26') ||
       upper.includes('ESPECIE-VARIEDAD')) &&
      !upper.includes('RECEPCION') && !upper.includes('RECEPCIÓN') &&
      !upper.includes('COMPRA')
    );
  }

  parse(rawText, fileMeta = {}) {
    if (!rawText) throw new Error('El contenido del albarán de salida está vacío');

    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    let series = 'AVT26';
    let number = '';
    let date = '';
    let entityCode = '';
    let entityName = '';
    let totalEnvasesSuma = null;

    // 1. Extracción de Serie y Número
    // En muestra real: "AVT260006227" o "Nro. ALBARÁN \n AVT260006227"
    const snMatch = rawText.match(/AVT(\d{2})(\d{1,8})/i) ||
                    rawText.match(/(?:ALBAR[AÁ]N|ALB\.)\s*[:.]?\s*([A-Z0-9]{2,8})[\/\-\s]?(\d{1,10})/i);
    if (snMatch) {
      if (snMatch[0].toUpperCase().startsWith('AVT')) {
        series = `AVT${snMatch[1]}`;
        // Quitar ceros a la izquierda para número limpio (ej. 0006227 -> 6227)
        number = String(parseInt(snMatch[2], 10));
      } else {
        series = snMatch[1].toUpperCase();
        number = String(parseInt(snMatch[2], 10));
      }
    }

    // 2. Extracción de Fecha
    // En muestra real: "24/09/2026 \n FECHA ALB."
    const dMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(?:\r?\n)?\s*FECHA\s*ALB/i) ||
                  rawText.match(/(?:FECHA\s*ALB\.?|FECHA)\s*[:.]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i);
    if (dMatch) {
      const d = dMatch[1].padStart(2, '0');
      const m = dMatch[2].padStart(2, '0');
      const y = dMatch[3];
      date = `${y}-${m}-${d}`;
    }

    // 3. Extracción de Cliente
    // En muestra real: "43000000169 \n CULTIVOS ARABA SL" o tras COD. CLIENTE
    const cliCodeMatch = rawText.match(/(43\d{7,10})/);
    if (cliCodeMatch) {
      entityCode = cliCodeMatch[1];
    }
    const cliNameMatch = rawText.match(/43\d{7,10}\s*(?:\r?\n)\s*([A-ZÁÉÍÓÚÑ0-9\s,\.\-]{3,60})/i);
    if (cliNameMatch) {
      entityName = cliNameMatch[1].split(/\r?\n/)[0].trim();
    }

    // 4. Extracción de Total Envases al pie
    // Estructura: [Kg Netos] \n [Envases: 584] \n [Kg Brutos] \n Suma :
    const sumMatch = rawText.match(/(\d{1,6})\s*(?:\r?\n)\s*[\d\.,]+\s*(?:\r?\n)\s*Suma\s*:/i) ||
                     rawText.match(/Suma\s*:\s*(?:\r?\n)?\s*(\d{1,6})/i);
    if (sumMatch) {
      totalEnvasesSuma = parseInt(sumMatch[1], 10);
    }

    // 5. Extracción de Bloques de Artículos
    // En el stream extraído, cada línea de detalle de Crystal Reports termina con "*"
    // Bloques entre "*" o antes de "Suma :"
    const parsedLines = [];
    let lineIdx = 1;

    // Segmentar el texto entre la cabecera de columnas y la suma final
    const headerIndex = rawText.indexOf('Tipo Envase');
    const footerIndex = rawText.indexOf('Suma :');
    const tableText = (headerIndex !== -1 && footerIndex !== -1)
      ? rawText.substring(headerIndex, footerIndex)
      : rawText;

    // Dividir por el separador de línea de producto "*" que emite Crystal Reports
    const blocks = tableText.split('*').map(b => b.trim()).filter(b => b.length > 0);

    for (const block of blocks) {
      const bLines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (bLines.length < 3) continue;

      // Buscar el nombre del artículo: suele ser la línea que empieza por TOMATE, PEPINO, CALABACIN, etc.
      let artName = '';
      let envDesc = '';
      let cajas = null;

      // Patrón de envase: ej. "EPS106 9x500", "EPS104 5x500", "EPS154", "EPS104", "CARTON..."
      for (const line of bLines) {
        if (/^(?:TOMATE|CALABACIN|PEPINO|BERENJENA|PIMIENTO|SANDIA|MELON)\b/i.test(line)) {
          artName = line;
        } else if (/^(?:EPS|CARTON|MADERA|CHEP|PLASTICO)\d*/i.test(line)) {
          envDesc = line;
        }
      }

      // Si encontramos artículo y envase, buscar las cajas (número entero que corresponde al Nº Envases)
      if (artName && envDesc) {
        // En la estructura observada:
        // [Piezas (opcional)] \n [Envase] \n [Nº Envases (cajas)] \n [Kg Brutos] \n [Kg Netos] \n [Articulo]
        const envIdx = bLines.indexOf(envDesc);
        if (envIdx !== -1 && envIdx + 1 < bLines.length) {
          const possibleBoxes = parseInt(bLines[envIdx + 1], 10);
          if (!isNaN(possibleBoxes) && possibleBoxes > 0) {
            cajas = possibleBoxes;
          }
        }

        if (cajas !== null) {
          // Extraer código de envase simple (ej. "EPS106 9x500" -> codigoEnvase: "EPS106", desc: "EPS106 9x500")
          const envCodeMatch = envDesc.match(/^([A-Z0-9\-_]+)/i);
          const envCode = envCodeMatch ? envCodeMatch[1] : envDesc;

          parsedLines.push(createNormalizedLine({
            lineIndex: lineIdx++,
            articleCode: '', // Se resolverá con MAESTRO por nombre
            articleName: artName,
            envaseCode: envCode,
            envaseName: envDesc,
            boxes: cajas,
            sourceReference: block.replace(/\r?\n/g, ' ')
          }));
        }
      }
    }

    return createNormalizedDocument({
      documentType: 'SALIDA',
      series,
      number,
      date,
      entityCode,
      entityName,
      sourceFileName: fileMeta.fileName || '',
      sourceFileId: fileMeta.fileId || '',
      sha256Hash: fileMeta.sha256Hash || '',
      lines: parsedLines,
      rawMetadata: {
        totalEnvasesSuma,
        coincideConSuma: totalEnvasesSuma ? (parsedLines.reduce((acc, l) => acc + l.boxes, 0) === totalEnvasesSuma) : true
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SalidaParser
  };
}
