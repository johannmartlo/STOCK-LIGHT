/**
 * STOCK-LIGHT — Fechas.js
 * 
 * Módulo puro de fechas y zona horaria (Europe/Madrid).
 * Decisión D-008: Fecha de negocio y zona horaria Europe/Madrid.
 */

/**
 * Devuelve la fecha actual en formato 'YYYY-MM-DD' en la zona horaria Europe/Madrid.
 * Acepta un reloj inyectable para pruebas (función que retorna Date/string/number, o instancia de Date/string/number).
 * 
 * @param {Function|Date|string|number} [reloj]
 * @returns {string} Fecha en formato YYYY-MM-DD
 */
function hoyMadrid(reloj) {
  let dateObj;
  if (reloj !== undefined && reloj !== null) {
    if (typeof reloj === 'function') {
      const val = reloj();
      dateObj = val instanceof Date ? val : new Date(val);
    } else if (reloj instanceof Date) {
      dateObj = reloj;
    } else {
      dateObj = new Date(reloj);
    }
  } else {
    dateObj = new Date();
  }

  if (isNaN(dateObj.getTime())) {
    throw new Error(`Reloj o fecha inválida: ${reloj}`);
  }

  if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(dateObj, 'Europe/Madrid', 'yyyy-MM-dd');
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(dateObj);
}

/**
 * Normaliza una fecha de negocio a formato canónico 'YYYY-MM-DD'.
 * Acepta Date, 'YYYY-MM-DD', ISO completo y 'dd/mm/yyyy' (o d/m/yyyy).
 * Un Date o timestamp se interpreta en Europe/Madrid.
 * Lanza un error si el valor no es válido.
 * 
 * @param {Date|string} valor
 * @returns {string} Fecha canónica YYYY-MM-DD
 */
function normalizarFechaNegocio(valor) {
  if (valor === undefined || valor === null || valor === '') {
    throw new Error('Fecha de negocio requerida');
  }

  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) {
      throw new Error(`Objeto Date inválido: ${valor}`);
    }
    return hoyMadrid(valor);
  }

  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    if (!trimmed) {
      throw new Error('Fecha de negocio no puede estar vacía');
    }

    // Caso 1: YYYY-MM-DD
    const isoDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateMatch) {
      const y = parseInt(isoDateMatch[1], 10);
      const m = parseInt(isoDateMatch[2], 10);
      const d = parseInt(isoDateMatch[3], 10);
      if (m < 1 || m > 12 || d < 1 || d > 31) {
        throw new Error(`Fecha fuera de rango: ${trimmed}`);
      }
      return trimmed;
    }

    // Caso 2: dd/mm/yyyy o d/m/yyyy
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const d = parseInt(slashMatch[1], 10);
      const m = parseInt(slashMatch[2], 10);
      const y = parseInt(slashMatch[3], 10);
      if (m < 1 || m > 12 || d < 1 || d > 31) {
        throw new Error(`Fecha fuera de rango: ${trimmed}`);
      }
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    // Caso 3: ISO completo (ej. 2026-10-19T14:30:00.000Z o similar)
    if (trimmed.includes('T')) {
      const parsedDate = new Date(trimmed);
      if (!isNaN(parsedDate.getTime())) {
        return hoyMadrid(parsedDate);
      }
    }
  }

  throw new Error(`Formato de fecha de negocio no válido: ${valor}`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    hoyMadrid,
    normalizarFechaNegocio
  };
}
