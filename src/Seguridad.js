/**
 * STOCK-LIGHT — Seguridad.js
 *
 * Guardia de superficie del servidor (T-023).
 *
 * Apps Script expone con google.script.run TODA función global cuyo nombre no
 * termine en "_". Las funciones de administración se protegen comprobando que
 * quien ejecuta es el propietario del script:
 * - desde el editor de Apps Script, el usuario activo y el efectivo coinciden;
 * - desde la web app ejecutada como propietario, un visitante sin identificar
 *   devuelve email vacío y un usuario de otro dominio devuelve otro email;
 *   en ambos casos la llamada se rechaza.
 *
 * Las dos funciones aceptan un objeto Session inyectable para poder probarlas
 * en Node sin depender del entorno de Google Apps Script.
 */

/**
 * Lee el email de un usuario de Session de forma defensiva.
 * Devuelve '' si Session, el método o el email no están disponibles.
 *
 * @param {Object|null} session
 * @param {string} metodo - 'getActiveUser' | 'getEffectiveUser'
 * @returns {string}
 */
function _emailSesion_(session, metodo) {
  try {
    if (!session || typeof session[metodo] !== 'function') return '';
    const usuario = session[metodo]();
    if (!usuario || typeof usuario.getEmail !== 'function') return '';
    return String(usuario.getEmail() || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Exige que quien ejecuta sea el propietario del script.
 * Lanza exactamente 'Operación reservada al administrador' en cualquier otro caso.
 *
 * @param {Object} [session] - Session inyectable (por defecto, Session global)
 */
function exigirPropietario_(session) {
  const ses = session || (typeof Session !== 'undefined' ? Session : null);
  const activo = _emailSesion_(ses, 'getActiveUser');
  const efectivo = _emailSesion_(ses, 'getEffectiveUser');
  if (!activo || !efectivo || activo.toLowerCase() !== efectivo.toLowerCase()) {
    throw new Error('Operación reservada al administrador');
  }
}

/**
 * Devuelve el email del usuario activo o 'SIN_IDENTIFICAR' si no se identifica.
 * El servidor usa SIEMPRE este valor para la auditoría; nunca el que envía el navegador.
 *
 * @param {Object} [session] - Session inyectable (por defecto, Session global)
 * @returns {string}
 */
function usuarioActual_(session) {
  const ses = session || (typeof Session !== 'undefined' ? Session : null);
  return _emailSesion_(ses, 'getActiveUser') || 'SIN_IDENTIFICAR';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    exigirPropietario_,
    usuarioActual_
  };
}
