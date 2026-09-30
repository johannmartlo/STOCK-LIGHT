/**
 * STOCK-LIGHT — SalidaParser.js (Calibrado Fase 2.1)
 * 
 * Parser robusto para Albaranes de Salida / Expedición de Hispatec (Crystal Reports).
 * Verificado contra las 7 muestras reales de salida:
 * - AVT26 6227 (584 envases)
 * - AVT26 6198 (20 envases - 200 piezas)
 * - AVT26 6199 (33 envases - 294 piezas)
 * - AVT26 6206 (304 envases)
 * - AVT26 6228 (354 envases)
 * - AVT26 6265 (230 envases)
 * - AVT26 6270 (31 envases - 304 piezas)
 * 
 * REGLAS CRÍTICAS:
 * - Extrae exclusivamente Nº. Envases (Cajas).
 * - Distingue con precisión entre Nº. Envases y Piezas/Bandejas unitarias.
 * - Ignora Kilos Brutos y Kilos Netos.
 */

// Importación condicional para entorno Node.js / Testing (aislada sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  const normMod = require('../NormalizedDocument');
  global.createNormalizedDocument = global.createNormalizedDocument || normMod.createNormalizedDocument;
  global.createNormalizedLine = global.createNormalizedLine || normMod.createNormalizedLine;
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
      !upper.includes('ALBARAN DE COMPRA') && !upper.includes('ALBARÁN DE COMPRA') &&
      !upper.includes('ACT26') && !upper.includes('NT26')
    );
  }

  parse(rawText, fileMeta = {}) {
    if (!rawText) throw new Error('El contenido del albarán de salida está vacío');

    let series = 'AVT26';
    let number = '';
    let date = '';
    let entityCode = '';
    let entityName = '';
    let totalEnvasesSuma = null;

    // 1. Extracción de Serie y Número
    const snMatch = rawText.match(/AVT(\d{2})(\d{1,8})/i) ||
                    rawText.match(/(?:ALBAR[AÁ]N|ALB\.)\s*[:.]?\s*([A-Z0-9]{2,8})[\/\-\s]?(\d{1,10})/i);
    if (snMatch) {
      if (snMatch[0].toUpperCase().startsWith('AVT')) {
        series = `AVT${snMatch[1]}`;
        number = String(parseInt(snMatch[2], 10));
      } else {
        series = snMatch[1].toUpperCase();
        number = String(parseInt(snMatch[2], 10));
      }
    }

    // 2. Extracción de Fecha
    const dMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(?:\r?\n)?\s*FECHA\s*ALB/i) ||
                  rawText.match(/(?:FECHA\s*ALB\.?|FECHA)\s*[:.]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i);
    if (dMatch) {
      const d = dMatch[1].padStart(2, '0');
      const m = dMatch[2].padStart(2, '0');
      const y = dMatch[3];
      date = `${y}-${m}-${d}`;
    }

    // 3. Extracción de Cliente
    const cliCodeMatch = rawText.match(/43\d{7,10}/);
    if (cliCodeMatch) {
      entityCode = cliCodeMatch[0];
    }
    const cliNameMatch = rawText.match(/43\d{7,10}\s*(?:\r?\n)\s*([A-ZÁÉÍÓÚÑ0-9\s,\.\-]{3,60})/i) ||
                         rawText.match(/(?:CULTIVOS ARABA SL|SOCIEDAD DE COMPRAS MODERNAS SA|FRUTAS HERMANOS MONTES SA|[A-ZÁÉÍÓÚÑ\s]{4,35}\s*(?:SA|SL|SLL))/i);
    if (cliNameMatch) {
      entityName = (cliNameMatch[1] || cliNameMatch[0]).split(/\r?\n/)[0].trim();
    }

    // 4. Extracción de Total Envases al pie
    // Estructura A (con piezas): [Kg Netos] \n [Total Envases] \n [Importe €] \n Suma : \n [Piezas]
    // Estructura B (sin piezas): [Kg Netos] \n [Total Envases] \n [Kg Brutos] \n Suma :
    const sumPatternA = /[\d\.]+(?:,\d{2})\s*(?:\r?\n)\s*(\d{1,6})\s*(?:\r?\n)\s*[\d\.]+(?:,\d{2})\s*(?:\r?\n)\s*Suma\s*:/i;
    const matchA = rawText.match(sumPatternA);
    if (matchA) {
      totalEnvasesSuma = parseInt(matchA[1], 10);
    } else {
      const sumPatternB = /(\d{1,6})\s*(?:\r?\n)\s*[\d\.]+(?:,\d{2})\s*(?:\r?\n)\s*Suma\s*:/i;
      const matchB = rawText.match(sumPatternB);
      if (matchB) {
        totalEnvasesSuma = parseInt(matchB[1], 10);
      }
    }

    // 5. Extracción de Líneas de Producto
    const parsedLines = [];
    let lineIdx = 1;

    // Delimitar la tabla
    const headerIndex = rawText.indexOf('Tipo Envase');
    const footerIndex = rawText.indexOf('Suma :');
    const tableText = (headerIndex !== -1 && footerIndex !== -1)
      ? rawText.substring(headerIndex, footerIndex)
      : rawText;

    // Separador de líneas de producto de Crystal Reports: "*"
    const blocks = tableText.split('*').map(b => b.trim()).filter(b => b.length > 0);

    for (const block of blocks) {
      const bLines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (bLines.length < 2) continue;

      let artName = '';
      let envDesc = '';
      let cajas = null;

      // Buscar línea de envase: comienza por EPS, CT, CARTON, MADERA, IFCO, CHEP...
      for (let i = 0; i < bLines.length; i++) {
        const line = bLines[i];
        if (/^(?:EPS|CT|CARTON|MADERA|IFCO|CHEP|PLASTICO)\w*/i.test(line)) {
          envDesc = line;
          // Inmediatamente después del tipo de envase se encuentra el Nº de Envases (cajas)
          if (i + 1 < bLines.length) {
            const val = parseInt(bLines[i + 1].replace(/\./g, ''), 10);
            if (!isNaN(val) && val > 0 && !bLines[i + 1].includes(',')) {
              cajas = val;
            }
          }
          break;
        }
      }

      // Buscar nombre de artículo: línea(s) que comienzan por TOMATE...
      const artLines = [];
      for (const line of bLines) {
        if (/^TOMATE\b/i.test(line)) {
          artLines.push(line);
        } else if (artLines.length > 0 && /^(?:BJ\/|T\/|ENVASE|TARRINA|ORIGEN)\b/i.test(line)) {
          artLines.push(line);
        }
      }
      if (artLines.length > 0) {
        artName = artLines.join(' ').replace(/\s+/g, ' ').trim();
      }

      if (artName && envDesc && cajas !== null) {
        // Normalizar código de envase primario (ej. "CT6412MAD10x500" -> "CT6412MAD", "EPS106 9x500" -> "EPS106")
        const envCodeMatch = envDesc.match(/^([A-Z0-9\-_]+)/i);
        const envCode = envCodeMatch ? envCodeMatch[1] : envDesc;

        parsedLines.push(createNormalizedLine({
          lineIndex: lineIdx++,
          articleCode: '',
          articleName: artName,
          envaseCode: envCode,
          envaseName: envDesc,
          boxes: cajas,
          sourceReference: block.replace(/\r?\n/g, ' ')
        }));
      }
    }

    const calculatedTotal = parsedLines.reduce((acc, l) => acc + (l.boxes || 0), 0);

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
        calculatedTotal,
        coincideConSuma: totalEnvasesSuma !== null ? (calculatedTotal === totalEnvasesSuma) : true
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SalidaParser
  };
}
