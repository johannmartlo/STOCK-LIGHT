/**
 * STOCK-LIGHT — FechaCorte.js
 *
 * Fecha de corte de la importación (T-037): los documentos con fecha de negocio
 * igual o anterior al corte no entran en el stock porque ya están en el stock
 * inicial. Solo afecta a la importación de CSV.
 */

if (typeof require !== 'undefined') {
  const segMod = require('./Seguridad');
  const confMod = require('./Config');
  global.exigirPropietario_ = global.exigirPropietario_ || segMod.exigirPropietario_;
  global.getFechaCorteImportacionConfig = global.getFechaCorteImportacionConfig || confMod.getFechaCorteImportacionConfig;
  global.setFechaCorteImportacionConfig = global.setFechaCorteImportacionConfig || confMod.setFechaCorteImportacionConfig;
}

/**
 * Fija o quita la fecha de corte. Reservada al propietario del script.
 * @param {string} fecha - yyyy-MM-dd, o '' para quitar el corte.
 * @param {Object} [options]
 * @returns {{ anterior: string, nuevo: string, nueva: string, fechaAnterior: string, fechaNueva: string }}
 */
function adminConfigurarFechaCorte(fecha, options = {}) {
  exigirPropietario_(options && options.session);
  const anterior = getFechaCorteImportacionConfig(options);
  const nuevo = setFechaCorteImportacionConfig(fecha, options);
  return {
    anterior,
    nuevo,
    nueva: nuevo,
    fechaAnterior: anterior,
    fechaNueva: nuevo
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    adminConfigurarFechaCorte
  };
}
