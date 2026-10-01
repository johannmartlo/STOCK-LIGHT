/**
 * STOCK-LIGHT — CompraParser.js (Calibrado Fase 2.1)
 * 
 * Parser robusto para Albaranes de Compra de Hispatec (Crystal Reports).
 * Soporta:
 * - Series ACT26, NT26 y afines.
 * - Albaranes con partidas individuales (ej. COMPRA 3024, 3026, 3104).
 * - Albaranes sin partida (ej. COMPRA 3072).
 * - Múltiples líneas de producto por albarán.
 * - Validación cruzada obligatoria contra el Total de Bultos al pie de página.
 * 
 * REGLA CRÍTICA:
 * - Extrae exclusivamente BULTOS (cajas).
 * - Descarta absolutamente KILOS (brutos/netos) e importes monetarios.
 */

// Importación condicional para entorno Node.js / Testing (aislada sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  const normMod = require('../NormalizedDocument');
  global.createNormalizedDocument = global.createNormalizedDocument || normMod.createNormalizedDocument;
  global.createNormalizedLine = global.createNormalizedLine || normMod.createNormalizedLine;
}

class CompraParser {
  canParse(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    const upper = rawText.toUpperCase();
    return (
      (upper.includes('ACT26') || upper.includes('NT26') || upper.includes('ALBARAN DE COMPRA') ||
       upper.includes('COD. PROVEEDOR') || upper.includes('FECHA ALBARÁN') || upper.includes('FECHA ALBARAN')) &&
      !upper.includes('RECEPCION') && !upper.includes('RECEPCIÓN') &&
      !upper.includes('ALBARAN DE VENTA') && !upper.includes('AVT26')
    );
  }

  parse(rawText, fileMeta = {}) {
    if (!rawText) throw new Error('El contenido del albarán de compra está vacío');

    const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    let series = 'ACT26';
    let number = '';
    let date = '';
    let entityCode = '';
    let entityName = '';
    let totalBultosPie = null;

    // 1. Extracción de Serie y Número
    // En muestras: "ACT26 /\n 3.024" o "NT26 /\n 1.778"
    const snMatch = rawText.match(/([A-Z]{2,4}\d{2})\s*\/\s*(?:\r?\n)?\s*([\d\.]+)/i) ||
                    rawText.match(/(?:ALBAR[AÁ]N|SERIE)\s*[:.]?\s*([A-Z0-9]+)\s*[\/\-]\s*([\d\.]+)/i);
    if (snMatch) {
      series = snMatch[1].toUpperCase();
      number = snMatch[2].replace(/\./g, '');
    }

    // 2. Extracción de Fecha
    // En muestras: "Fecha Albarán" o fecha en cabecera "16/09/2026"
    const dMatch = rawText.match(/(?:Fecha\s*Albar[aá]n\s*[:.]?\s*)?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i);
    if (dMatch) {
      const d = dMatch[1].padStart(2, '0');
      const m = dMatch[2].padStart(2, '0');
      const y = dMatch[3];
      date = `${y}-${m}-${d}`;
    }

    // 3. Extracción de Proveedor
    const provCodeMatch = rawText.match(/40\d{7,10}/);
    if (provCodeMatch) {
      entityCode = provCodeMatch[0];
    }
    const provNameMatch = rawText.match(/DESCRIPCI[OÓ]N\s*(?:\r?\n)\s*([A-ZÁÉÍÓÚÑ0-9\s,\.\-]{3,60})/i) ||
                         rawText.match(/(?:CONSABOR BS SL|HORTIPOR EXPORT LDA|PEREZ RAMON, JAVIER|[A-ZÁÉÍÓÚÑ\s]{4,35}\s*(?:SL|SA|LDA))/i);
    if (provNameMatch) {
      entityName = provNameMatch[1] ? provNameMatch[1].split(/\r?\n/)[0].trim() : provNameMatch[0].trim();
    }

    // 4. Extracción de Total de Bultos al pie de página (ej. "1.160 \n 4.716,00" o "492 \n 1.546,00")
    // Estructura universal Crystal Reports al pie: [Total Bultos] \n [Total Kilos (con coma)]
    const totMatch = rawText.match(/[\r\n]\s*(\d{1,3}(?:\.\d{3})?)\s*[\r\n]\s*[\d\.]+(?:,\d{2})\s*[\r\n]\s*[\d\.]+(?:,\d{2})\s*(?:€|\x80)/i) ||
                     rawText.match(/[\r\n]\s*(\d{1,3}(?:\.\d{3})?)\s*[\r\n]\s*[\d\.]+(?:,\d{2})\s*[\r\n]\s*(?:12,00|4,00|BASE|TOTAL|CUOTA)/i) ||
                     rawText.match(/(?:TOTAL|TOTALES)\s*[:.]?\s*(\d{1,3}(?:\.\d{3})?)\s*(?:\r?\n)\s*[\d\.]+(?:,\d{2})/i);
    if (totMatch) {
      totalBultosPie = parseInt(totMatch[1].replace(/\./g, ''), 10);
    }

    // 5. Extracción de Líneas de Producto
    const parsedLines = [];
    let lineIdx = 1;

    // Segmentar el texto del cuerpo de la tabla (después de "Falso" o "Referencia cliente:" y antes de los totales)
    const refIndex = rawText.indexOf('Referencia cliente:');
    let tableText = refIndex !== -1 ? rawText.substring(refIndex) : rawText;

    // A. Variante 1: Documentos con bloque "Nº Partida:"
    const partidaRegex = /N[ºo]?\s*Partida:\s*(\d+)/gi;
    const hasPartidas = /N[ºo]?\s*Partida:/i.test(tableText);

    if (hasPartidas) {
      // Dividir por cada bloque de partida
      const chunks = tableText.split(/N[ºo]?\s*Partida:\s*(\d+)/i);
      // chunks viene como: [previo, partida1, previo2, partida2, ...]
      for (let i = 1; i < chunks.length; i += 2) {
        const partida = chunks[i].trim();
        const content = chunks[i - 1]; // Texto que precede a esta partida
        const cLines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        // Buscar el artículo: la línea antes de la partida
        let artName = '';
        for (let j = cLines.length - 1; j >= 0; j--) {
          if (/^TOMATE\b/i.test(cLines[j])) {
            artName = cLines[j];
            break;
          }
        }

        // Buscar Bultos: un número entero (ej. 32, 528, 600, 78, 131, 16, 6...)
        // En la estructura: [Kilos (decimal)] \n [Bultos (entero)] \n [KG o UNID]
        let bultos = null;
        let detectedUnit = '';
        for (let j = 0; j < cLines.length; j++) {
          if (cLines[j] === 'KG' || cLines[j] === 'UNID') {
            detectedUnit = cLines[j];
            if (j > 0) {
              const val = parseInt(cLines[j - 1].replace(/\./g, ''), 10);
              if (!isNaN(val) && val > 0 && !cLines[j - 1].includes(',')) {
                bultos = val;
                break;
              }
            }
          }
        }

        // Si no se encontró por KG/UNID, buscar cualquier entero positivo entre líneas de números
        if (bultos === null) {
          for (let j = cLines.length - 1; j >= 0; j--) {
            const val = parseInt(cLines[j].replace(/\./g, ''), 10);
            if (!isNaN(val) && val > 0 && !cLines[j].includes(',') && !cLines[j].includes('€') && val < 50000) {
              bultos = val;
              break;
            }
          }
        }

        if (!detectedUnit) {
          for (let j = 0; j < cLines.length; j++) {
            if (cLines[j] === 'KG' || cLines[j] === 'UNID') {
              detectedUnit = cLines[j];
              break;
            }
          }
        }

        if (artName && bultos) {
          parsedLines.push(createNormalizedLine({
            lineIndex: lineIdx++,
            articleCode: '',
            articleName: artName,
            envaseCode: '',
            envaseName: '',
            boxes: bultos,
            unit: detectedUnit,
            lot: partida,
            sourceReference: `PARTIDA:${partida}`
          }));
        }
      }
    } else {
      // B. Variante 2: Documentos SIN PARTIDA (ej. COMPRA 3072)
      // Estructura repetitiva observada:
      // [Nº Línea (1, 2, 3...)] \n [Kilos (110,00)] \n [Bultos (42)] \n [Articulo (TOMATE MORESCO I M)]
      const lines = tableText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      for (let i = 0; i < lines.length - 3; i++) {
        const lineNum = parseInt(lines[i], 10);
        if (!isNaN(lineNum) && lineNum === lineIdx) {
          const kilos = lines[i + 1];
          const bultosStr = lines[i + 2];
          const artName = lines[i + 3];

          if (kilos.includes(',') && !bultosStr.includes(',') && /^TOMATE\b/i.test(artName)) {
            const bultos = parseInt(bultosStr.replace(/\./g, ''), 10);
            if (!isNaN(bultos) && bultos > 0) {
              parsedLines.push(createNormalizedLine({
                lineIndex: lineIdx++,
                articleCode: '',
                articleName: artName,
                envaseCode: '',
                envaseName: '',
                boxes: bultos,
                unit: 'KG',
                lot: '',
                sourceReference: `LINEA:${lineNum}`
              }));
            }
          }
        }
      }
    }

    const calculatedTotal = parsedLines.reduce((acc, l) => acc + (l.boxes || 0), 0);

    return createNormalizedDocument({
      documentType: 'COMPRA',
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
        totalBultosPie,
        calculatedTotal,
        cuadraConPie: totalBultosPie !== null ? (calculatedTotal === totalBultosPie) : null
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CompraParser
  };
}
