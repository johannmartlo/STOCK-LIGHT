/**
 * Utilidades puras de normalización compartidas por la importación.
 */
function normalizarNombre(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto).trim().replace(/\s+/g, ' ').toUpperCase();
}

function parsearNumeroEs(texto) {
  if (texto === null || texto === undefined || String(texto).trim() === '') return null;

  const valor = String(texto).trim();
  // Acepta enteros, decimales con coma y miles con punto (formato español).
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(valor)) return NaN;
  const numero = Number(valor.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : NaN;
}

function parsearFechaDdMmYyyy(texto) {
  if (texto === null || texto === undefined) return null;
  const valor = String(texto).trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (!match) return null;

  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizarNombre, parsearNumeroEs, parsearFechaDdMmYyyy };
}
