/**
 * STOCK-LIGHT — CompraParser.js
 * 
 * Parser calibrado para Albaranes de Compra por Partidas de Hispatec (Crystal Reports).
 * Verificado con muestra real: ALBARAN DE COMPRA POR PARTIDAS.pdf
 * 
 * REGLAS CRÍTICAS:
 * - Extrae exclusivamente Bultos (Cajas).
 * - Ignora Kilos Netos (720,00 kg en muestra) e Importes.
 * - Extrae Nº Partida informativa.
 */

// Importación condicional para Node.js
if (typeof createNormalizedDocument === 'undefined' && typeof require !== 'undefined') {
  var { createNormalizedDocument, createNormalizedLine } = require('../NormalizedDocument');
}

class CompraParser {
  canParse(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    const upper = rawText.toUpperCase();
    return (
      (upper.includes('ACT26') || upper.includes('ALBARAN DE COMPRA') ||
       upper.includes('COD. PROVEEDOR') || upper.includes('FECHA ALBARÁN') || upper.includes('FECHA ALBARAN')) &&
      !upper.includes('RECEPCION') && !upper.includes('RECEPCIÓN') &&
      !upper.includes('ALBARAN DE VENTA')
    );
  }

  parse(rawText, fileMeta = {}) {
    if (!rawText) throw new Error('El contenido del albarán de compra está vacío');

    let series = 'ACT26';
    let number = '';
    let date = '';
    let entityCode = '';
    let entityName = '';

    // 1. Extracción de Serie y Número
    // En muestra real: "ACT26 /\n 3.089"
    const snMatch = rawText.match(/(ACT\d{2})\s*\/\s*(?:\r?\n)?\s*([\d\.]+)/i) ||
                    rawText.match(/(?:ALBAR[AÁ]N|SERIE)\s*[:.]?\s*([A-Z0-9]+)\s*[\/\-]\s*([\d\.]+)/i);
    if (snMatch) {
      series = snMatch[1].toUpperCase();
      number = snMatch[2].replace(/\./g, ''); // "3.089" -> "3089"
    }

    // 2. Extracción de Fecha
    // En muestra real: "24/09/2026"
    const dMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
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
    const provNameMatch = rawText.match(/N\.I\.F\.\s*:\s*(?:\r?\n)\s*DESCRIPCI[OÓ]N\s*(?:\r?\n)\s*([A-ZÁÉÍÓÚÑ0-9\s,\.\-]{3,50})/i) ||
                         rawText.match(/(CONSABOR BS SL|[A-ZÁÉÍÓÚÑ\s]{4,35} SL)/i);
    if (provNameMatch) {
      entityName = provNameMatch[1].split(/\r?\n/)[0].trim();
    }

    // 4. Extracción de Líneas de Stock
    // En muestra real de Crystal Reports:
    // " [Importe] \n 1 \n [Kilos: 720,00] \n [Bultos: 240] \n UNID \n [Precio: 1,45] \n [Articulo: TOMATE COCKTAIL I M] \n Nº Partida: 336492 "
    const parsedLines = [];
    let lineIdx = 1;

    // Buscar partidas: ej. "Nº Partida: 336492" o "Partida: 336492"
    const partidaMatches = [...rawText.matchAll(/N[ºo]?\s*Partida:\s*(\d+)/gi)];

    if (partidaMatches.length > 0) {
      for (const pMatch of partidaMatches) {
        const partida = pMatch[1];
        const partidaPos = pMatch.index;

        // Buscar texto hacia atrás para encontrar nombre de artículo y cantidad de bultos
        const precedingText = rawText.substring(Math.max(0, partidaPos - 300), partidaPos);
        const pLines = precedingText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

        // El artículo suele estar justo antes de "Nº Partida:"
        let artName = '';
        for (let i = pLines.length - 1; i >= 0; i--) {
          if (/^(?:TOMATE|CALABACIN|PEPINO|BERENJENA|PIMIENTO|SANDIA|MELON)\b/i.test(pLines[i])) {
            artName = pLines[i];
            break;
          }
        }

        // Buscar los Bultos: un número entero positivo antes de "UNID" o en las líneas anteriores
        let bultos = null;
        const unidIndex = pLines.indexOf('UNID');
        if (unidIndex > 0) {
          const val = parseInt(pLines[unidIndex - 1], 10);
          if (!isNaN(val) && val > 0) bultos = val;
        }

        // Si no se encontró por UNID, buscar en los totales al pie: "240 \n 720,00"
        if (bultos === null) {
          const totMatch = rawText.match(/(\d{1,6})\s*(?:\r?\n)\s*[\d\.,]+\s*(?:\r?\n)\s*[\d\.,]+\s*€/);
          if (totMatch) bultos = parseInt(totMatch[1], 10);
        }

        if (artName && bultos) {
          parsedLines.push(createNormalizedLine({
            lineIndex: lineIdx++,
            articleCode: '', // Se resolverá con MAESTRO por nombre
            articleName: artName,
            envaseCode: 'DEFAULT', // Se resolverá con MAESTRO o revisión
            envaseName: 'UNID',
            boxes: bultos,
            lot: partida,
            sourceReference: `PARTIDA:${partida}`
          }));
        }
      }
    }

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
        totalLineas: parsedLines.length
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CompraParser
  };
}
