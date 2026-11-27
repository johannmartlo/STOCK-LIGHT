/**
 * STOCK-LIGHT — ParteService.js
 *
 * Parte de stock de la noche (T-029), de solo lectura.
 * Usa InicioService.obtenerInicio() como única fuente de datos para que el parte diga
 * exactamente lo mismo que la pantalla.
 */

if (typeof require !== 'undefined') {
  try {
    const inicioMod = require('./InicioService');
    global.InicioService = global.InicioService || inicioMod.InicioService;
  } catch (e) {}
  try {
    const nombresMod = require('./NombresLegibles');
    global.nombreLegible_ = global.nombreLegible_ || nombresMod.nombreLegible_;
    global.etiquetaArticuloEnVariedad_ = global.etiquetaArticuloEnVariedad_ || nombresMod.etiquetaArticuloEnVariedad_;
  } catch (e) {}
  try {
    const idsMod = require('./Ids');
    global.nuevoId = global.nuevoId || idsMod.nuevoId;
  } catch (e) {}
  try {
    const segMod = require('./Seguridad');
    global.usuarioActual_ = global.usuarioActual_ || segMod.usuarioActual_;
  } catch (e) {}
}

const PARTE_DESTINATARIOS_KEY = 'PARTE_DESTINATARIOS';
const PARTE_HORA_KEY = 'PARTE_HORA';
const PARTE_HORA_DEFECTO = 21;
const PARTE_HANDLER = 'enviarParteDiario_';

/**
 * Formatea un número con miles separados por punto.
 * @param {*} valor
 * @returns {string}
 */
function _fmtNumeroParte_(valor) {
  return String(Math.round(Number(valor) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formatea una fecha canónica YYYY-MM-DD como DD/MM.
 * @param {*} valor
 * @returns {string}
 */
function _fmtFechaDdMmParte_(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      day: '2-digit',
      month: '2-digit'
    }).formatToParts(valor);
    const dia = (partes.find(p => p.type === 'day') || {}).value || '';
    const mes = (partes.find(p => p.type === 'month') || {}).value || '';
    return dia && mes ? `${dia}/${mes}` : '';
  }
  const texto = String(valor).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[3]}/${iso[2]}`;
  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (barras) return `${String(Number(barras[1])).padStart(2, '0')}/${String(Number(barras[2])).padStart(2, '0')}`;
  return texto;
}

/**
 * Formatea una antigüedad en días como en la interfaz.
 * @param {*} valor
 * @returns {string}
 */
function _fmtDiasParte_(valor) {
  const dias = Math.max(0, Math.round(Number(valor) || 0));
  if (dias === 0) return 'hoy';
  if (dias === 1) return '1 día';
  return `${_fmtNumeroParte_(dias)} días`;
}

/**
 * Hora actual en Europe/Madrid, formato HH:mm.
 * @param {Function|Date|string|number} [reloj]
 * @returns {string}
 */
function _horaMadridParte_(reloj) {
  let fecha;
  if (typeof reloj === 'function') {
    const valor = reloj();
    fecha = valor instanceof Date ? valor : new Date(valor);
  } else if (reloj instanceof Date) {
    fecha = reloj;
  } else if (reloj !== undefined && reloj !== null) {
    fecha = new Date(reloj);
  } else {
    fecha = new Date();
  }
  if (isNaN(fecha.getTime())) fecha = new Date();

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(fecha, 'Europe/Madrid', 'HH:mm');
  }

  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(fecha);
  const hora = (partes.find(p => p.type === 'hour') || {}).value || '';
  const minuto = (partes.find(p => p.type === 'minute') || {}).value || '';
  return `${hora}:${minuto}`;
}

/**
 * Fecha de hoy en Europe/Madrid (YYYY-MM-DD), solo como respaldo.
 * @param {Function|Date|string|number} [reloj]
 * @returns {string}
 */
function _hoyMadridParte_(reloj) {
  let fecha;
  if (typeof reloj === 'function') {
    const valor = reloj();
    fecha = valor instanceof Date ? valor : new Date(valor);
  } else if (reloj instanceof Date) {
    fecha = reloj;
  } else if (reloj !== undefined && reloj !== null) {
    fecha = new Date(reloj);
  } else {
    fecha = new Date();
  }
  if (isNaN(fecha.getTime())) fecha = new Date();

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(fecha, 'Europe/Madrid', 'yyyy-MM-dd');
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(fecha);
}

/**
 * Escapa texto para insertarlo en HTML.
 * @param {*} valor
 * @returns {string}
 */
function _escHtmlParte_(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Agrupa las partidas de una variedad por artículo + envase y las ordena por cajas.
 * @param {Object} variedad
 * @returns {Array<{articulo:string, envase:string, etiqueta:string, cajas:number}>}
 */
function _desgloseVariedadParte_(variedad) {
  const partidas = variedad && Array.isArray(variedad.partidas) ? variedad.partidas : [];
  const mapa = new Map();

  for (const partida of partidas) {
    if (!partida) continue;
    const articulo = String(partida.articulo || '').trim();
    const envase = String(partida.envase || '').trim();
    const clave = `${articulo}|${envase}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, { articulo, envase, cajas: 0 });
    }
    mapa.get(clave).cajas += Number(partida.cajas || 0);
  }

  const desglose = Array.from(mapa.values()).map((item) => ({
    articulo: item.articulo,
    envase: item.envase,
    etiqueta: [
      etiquetaArticuloEnVariedad_(item.articulo, variedad && variedad.grupo),
      nombreLegible_(item.envase)
    ].filter(Boolean).join(' '),
    cajas: item.cajas
  }));

  desglose.sort((a, b) => {
    if (b.cajas !== a.cajas) return b.cajas - a.cajas;
    const cmpArticulo = a.articulo.localeCompare(b.articulo);
    if (cmpArticulo !== 0) return cmpArticulo;
    return a.envase.localeCompare(b.envase);
  });

  return desglose;
}

/**
 * Texto del bloque de pendientes. Vacío si no hay pendientes.
 * @param {Object} pendientes
 * @returns {string}
 */
function _textoPendientesParte_(pendientes) {
  if (!pendientes) return '';
  const total = Number(pendientes.totalDocumentos !== undefined ? pendientes.totalDocumentos : pendientes.total) || 0;
  if (total <= 0) return '';

  const porMotivo = pendientes.porMotivo || {};
  const partes = [];
  const stock = Number(porMotivo.STOCK_INSUFICIENTE || 0);
  const desconocido = Number(porMotivo.SEGUIMIENTO_DESCONOCIDO || 0);
  const modificado = Number(porMotivo.MODIFICADO_EN_ERP || 0);

  if (stock > 0) {
    partes.push(`${stock} ${stock === 1 ? 'venta' : 'ventas'} sin stock`);
  }
  if (desconocido > 0) {
    partes.push(`${desconocido} ${desconocido === 1 ? 'documento' : 'documentos'} con seguimiento desconocido`);
  }
  if (modificado > 0) {
    partes.push(`${modificado} ${modificado === 1 ? 'documento' : 'documentos'} modificado${modificado === 1 ? '' : 's'} en ERP`);
  }
  if (partes.length === 0) {
    partes.push(`${total} ${total === 1 ? 'documento' : 'documentos'} pendiente${total === 1 ? '' : 's'}`);
  }

  return `Pendientes: ${partes.join(' · ')}`;
}

/**
 * Texto de «Importado hasta»; siempre devuelve algo.
 * @param {Object} importadoHasta
 * @returns {string}
 */
function _textoImportadoParte_(importadoHasta) {
  const importado = importadoHasta || {};
  const compras = _fmtFechaDdMmParte_(importado.compras) || '—';
  const ventas = _fmtFechaDdMmParte_(importado.ventas) || '—';
  return `Importado hasta: C ${compras} · V ${ventas}`;
}

/**
 * Línea de cierre incompleto para el parte (T-043). No cuenta el paso 6 (enviar el
 * parte), porque es el propio envío el que se está haciendo.
 * @param {Object} cierre
 * @returns {string}
 */
function _textoCierreIncompletoParte_(cierre) {
  if (!cierre || !Array.isArray(cierre.pasos)) return '';
  const pendientes = cierre.pasos.filter(paso => (
    paso
    && Number(paso.n) !== 6
    && String(paso.estado || '').trim().toUpperCase() === 'PENDIENTE'
  ));
  if (pendientes.length === 0) return '';
  const numeros = pendientes.map(paso => Number(paso.n)).filter(n => Number.isFinite(n));
  if (numeros.length === 0) return 'Cierre incompleto.';
  if (numeros.length === 1) return `Cierre incompleto: falta el paso ${numeros[0]}.`;
  const lista = `${numeros.slice(0, -1).join(', ')} y ${numeros[numeros.length - 1]}`;
  return `Cierre incompleto: faltan los pasos ${lista}.`;
}

/**
 * Construye la estructura de variedades del parte a partir de obtenerInicio().
 * @param {Object} inicio
 * @returns {Array<Object>}
 */
function _variedadesParte_(inicio) {
  const variedades = inicio && Array.isArray(inicio.variedades) ? inicio.variedades : [];
  return variedades
    .filter(variedad => variedad && Number(variedad.cajas || 0) > 0)
    .map((variedad) => {
      const desglose = _desgloseVariedadParte_(variedad);
      return {
        grupo: String(variedad.grupo || '').trim(),
        grupoLegible: nombreLegible_(variedad.grupo).toUpperCase(),
        cajas: Number(variedad.cajas || 0),
        sale_primero: variedad.sale_primero || '',
        dias: variedad.dias,
        desglose,
        textoDesglose: desglose.map(item => `${item.etiqueta} ${_fmtNumeroParte_(item.cajas)}`.trim()).join(' · '),
        textoVentaPrimero: variedad.sale_primero
          ? `Sale primero: ${_fmtFechaDdMmParte_(variedad.sale_primero)} (${_fmtDiasParte_(variedad.dias)})`
          : ''
      };
    });
}

class ParteService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.inicioService]
   * @param {Object} [options.repository]
   * @param {Object} [options.catalogoService]
   * @param {Object} [options.pendientesService]
   * @param {Function|Date|string} [options.clock] - Reloj inyectable para la hora.
   * @param {Function|Date|string} [options.reloj] - Alias de clock.
   */
  constructor(options = {}) {
    const InicioClass = (typeof InicioService !== 'undefined')
      ? InicioService
      : (typeof require !== 'undefined' ? require('./InicioService').InicioService : null);

    this.inicioService = options.inicioService || (InicioClass
      ? new InicioClass({
        repository: options.repository,
        catalogoService: options.catalogoService,
        pendientesService: options.pendientesService,
        configCatalogo: options.configCatalogo,
        reloj: options.reloj !== undefined ? options.reloj : options.clock
      })
      : null);
    if (!this.inicioService) throw new Error('InicioService no está disponible en ParteService.');

    this.repo = options.repository || this.inicioService.repo || null;
    this.clock = options.clock !== undefined ? options.clock : options.reloj;
  }

  /**
   * Genera el parte a partir de InicioService.obtenerInicio().
   * @param {Object} [options]
   * @param {string} [options.hoy] - Fecha de referencia YYYY-MM-DD.
   * @returns {{ fecha: string, hora: string, texto: string, html: string, datos: Object }}
   */
  generarParte(options = {}) {
    const opcionesInicio = {};
    if (options && options.hoy !== undefined && options.hoy !== null && String(options.hoy).trim() !== '') {
      opcionesInicio.hoy = options.hoy;
    }
    if (options && options.incluirCierre !== undefined) {
      opcionesInicio.incluirCierre = options.incluirCierre;
    }
    const inicio = this.inicioService.obtenerInicio(opcionesInicio);

    const reloj = options && (options.clock !== undefined ? options.clock : options.reloj);
    const fechaIso = (inicio && inicio.fecha_referencia)
      ? String(inicio.fecha_referencia).trim()
      : _hoyMadridParte_(reloj !== undefined ? reloj : this.clock);
    const fecha = _fmtFechaDdMmParte_(fechaIso);
    const hora = _horaMadridParte_(reloj !== undefined ? reloj : this.clock);
    const variedades = _variedadesParte_(inicio);
    const total = Number(inicio && inicio.total || 0);
    const pendientesTexto = _textoPendientesParte_(inicio && inicio.pendientes);
    const importadoTexto = _textoImportadoParte_(inicio && inicio.importado_hasta);
    const cierreTexto = _textoCierreIncompletoParte_(inicio && inicio.cierre);

    const lineas = [
      `STOCK · ${fecha} · ${hora}`,
      `Total: ${_fmtNumeroParte_(total)} cajas`
    ];

    for (const variedad of variedades) {
      lineas.push('');
      lineas.push(`${variedad.grupoLegible} · ${_fmtNumeroParte_(variedad.cajas)}`);
      if (variedad.textoDesglose) lineas.push(variedad.textoDesglose);
      if (variedad.textoVentaPrimero) lineas.push(variedad.textoVentaPrimero);
    }

    lineas.push('');
    lineas.push(pendientesTexto ? `${pendientesTexto} · ${importadoTexto}` : importadoTexto);
    if (cierreTexto) lineas.push(cierreTexto);

    const texto = lineas.join('\n');
    const html = this._htmlParte_(fecha, hora, total, variedades, pendientesTexto, importadoTexto, cierreTexto);

    return {
      fecha,
      hora,
      texto,
      html,
      datos: inicio
    };
  }

  _htmlParte_(fecha, hora, total, variedades, pendientesTexto, importadoTexto, cierreTexto = '') {
    const filas = variedades.map((variedad) => {
      const detalle = variedad.textoDesglose
        ? `<div style="margin-top:4px;font-size:13px;color:#444444;line-height:1.35;">${_escHtmlParte_(variedad.textoDesglose)}</div>`
        : '';
      const venta = variedad.textoVentaPrimero
        ? `<div style="margin-top:4px;font-size:12px;color:#666666;">${_escHtmlParte_(variedad.textoVentaPrimero)}</div>`
        : '';
      return `
        <tr>
          <td style="padding:10px 8px;border-top:1px solid #dddddd;vertical-align:top;">
            <div style="font-size:14px;font-weight:bold;color:#1f1f1f;">${_escHtmlParte_(variedad.grupoLegible)}</div>
            ${detalle}
            ${venta}
          </td>
          <td align="right" style="padding:10px 8px;border-top:1px solid #dddddd;vertical-align:top;font-size:15px;font-weight:bold;color:#1f1f1f;white-space:nowrap;">${_fmtNumeroParte_(variedad.cajas)}</td>
        </tr>`;
    }).join('');

    const cuerpoTabla = filas || `
      <tr>
        <td colspan="2" style="padding:12px 8px;border-top:1px solid #dddddd;color:#666666;">Sin stock.</td>
      </tr>`;

    const pendientes = pendientesTexto
      ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.4;color:#3f3f3f;">${_escHtmlParte_(pendientesTexto)}</p>`
      : '';
    const importado = `<p style="margin:6px 0 0;font-size:13px;line-height:1.4;color:#3f3f3f;">${_escHtmlParte_(importadoTexto)}</p>`;
    const cierre = cierreTexto
      ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.4;color:#7a4a00;font-weight:bold;">${_escHtmlParte_(cierreTexto)}</p>`
      : '';

    return `
      <div style="margin:0;padding:0;background:#f4f4f2;">
        <div style="max-width:640px;margin:0 auto;padding:16px;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
          <h1 style="margin:0 0 4px;font-size:18px;line-height:1.3;color:#1f1f1f;">STOCK · ${_escHtmlParte_(fecha)} · ${_escHtmlParte_(hora)}</h1>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.4;">Total: <strong>${_fmtNumeroParte_(total)} cajas</strong></p>
          <table role="presentation" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #dddddd;">
            <thead>
              <tr style="background:#e9e9e4;">
                <th align="left" style="padding:8px;font-size:12px;color:#555555;text-transform:uppercase;">Variedad</th>
                <th align="right" style="padding:8px;font-size:12px;color:#555555;text-transform:uppercase;">Cajas</th>
              </tr>
            </thead>
            <tbody>${cuerpoTabla}
            </tbody>
          </table>
          ${pendientes}
          ${importado}
          ${cierre}
        </div>
      </div>`;
  }
}

/**
 * Lee los destinatarios configurados en ScriptProperties.
 * @param {Object} [options]
 * @returns {Array<string>}
 */
function leerDestinatariosParte_(options = {}) {
  const propService = options.propertiesService
    || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.getProperty !== 'function') return [];
  const raw = propService.getProperty(PARTE_DESTINATARIOS_KEY);
  if (!raw) return [];
  return String(raw).split(',').map(texto => texto.trim()).filter(Boolean);
}

/**
 * Lee la hora configurada (0-23); 21 si no hay valor válido.
 * @param {Object} [options]
 * @returns {number}
 */
function leerHoraParte_(options = {}) {
  const propService = options.propertiesService
    || (typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null);
  if (!propService || typeof propService.getProperty !== 'function') return PARTE_HORA_DEFECTO;
  const raw = propService.getProperty(PARTE_HORA_KEY);
  if (raw === null || raw === undefined || String(raw).trim() === '') return PARTE_HORA_DEFECTO;
  const hora = Number(raw);
  return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : PARTE_HORA_DEFECTO;
}

/**
 * Normaliza una lista de destinatarios a un array sin vacíos.
 * @param {string|Array<string>} destinatarios
 * @returns {Array<string>}
 */
function normalizarDestinatariosParte_(destinatarios) {
  const lista = Array.isArray(destinatarios) ? destinatarios : String(destinatarios || '').split(',');
  return lista.map(texto => String(texto === null || texto === undefined ? '' : texto).trim()).filter(Boolean);
}

/**
 * Registra una línea en LOG_OPERACIONES sin lanzar.
 * @param {Object} repo
 * @param {Object} options
 * @param {Object} datos
 * @returns {boolean}
 */
function _registrarLogParte_(repo, options, datos) {
  try {
    if (!repo) return false;
    const nuevoIdFn = typeof nuevoId === 'function'
      ? nuevoId
      : (typeof require !== 'undefined' ? require('./Ids').nuevoId : null);
    if (typeof nuevoIdFn !== 'function') return false;
    const idLog = nuevoIdFn('LOG');
    const usuario = options.usuario
      || (typeof usuarioActual_ === 'function' ? usuarioActual_() : 'SISTEMA');
    const registro = {
      id_log: idLog,
      fecha_hora: new Date().toISOString(),
      usuario: usuario || 'SISTEMA',
      operacion: 'PARTE_DIARIO',
      codigo_articulo: '',
      nombre_articulo: '',
      codigo_envase: '',
      descripcion_envase: '',
      cantidad_cajas: Number(datos && datos.cajas || 0),
      origen: 'PARTE',
      destino: '',
      motivo: datos && datos.motivo || '',
      referencia: datos && datos.referencia || '',
      estado: datos && datos.estado || 'ERROR',
      observaciones: datos && datos.observaciones || ''
    };
    if (typeof repo.appendLogOperaciones === 'function') {
      repo.appendLogOperaciones([registro]);
      return true;
    }
    if (typeof repo.appendLogOperacion === 'function') {
      repo.appendLogOperacion(registro);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Marca el paso 6 del cierre cuando el parte sale por correo (T-043).
 * No rompe el envío si la hoja CIERRE_DIA no está disponible.
 *
 * @param {Object} repo
 * @param {Object} options
 * @returns {boolean}
 */
function _marcarParteEnviadoParte_(repo, options) {
  try {
    if (!repo || typeof repo.appendCierreDia !== 'function') return false;
    const reloj = options.reloj !== undefined ? options.reloj : options.clock;
    const usuario = options.usuario
      || (typeof usuarioActual_ === 'function' ? usuarioActual_() : 'SISTEMA');
    repo.appendCierreDia({
      fecha: _hoyMadridParte_(reloj),
      paso: 'parte',
      estado: 'HECHO',
      usuario: usuario || 'SISTEMA',
      hora: _horaMadridParte_(reloj),
      nota: 'Correo del parte'
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Envía el parte diario por correo a los destinatarios configurados.
 * Nunca lanza por un fallo de MailApp o de destinatarios; lo registra en LOG_OPERACIONES.
 *
 * @param {Object} [options]
 * @returns {Object}
 */
function enviarParteDiario_(options = {}) {
  const servicio = options.parteService || new ParteService({
    repository: options.repository,
    inicioService: options.inicioService,
    catalogoService: options.catalogoService,
    pendientesService: options.pendientesService,
    reloj: options.reloj !== undefined ? options.reloj : options.clock,
    clock: options.clock
  });

  const parte = servicio.generarParte(options);
  const destinatarios = leerDestinatariosParte_(options);
  const repo = options.repository || servicio.repo || null;
  const asunto = `Stock ${parte.fecha} · ${_fmtNumeroParte_(parte.datos && parte.datos.total)} cajas`;
  const cajas = Number(parte.datos && parte.datos.total || 0);

  if (destinatarios.length === 0) {
    const logRegistrado = _registrarLogParte_(repo, options, {
      motivo: 'SIN_DESTINATARIOS',
      estado: 'OMITIDO',
      referencia: asunto,
      cajas,
      observaciones: 'No hay destinatarios configurados en PARTE_DESTINATARIOS; no se envía el parte.'
    });
    return {
      ok: false,
      motivo: 'SIN_DESTINATARIOS',
      asunto,
      destinatarios: [],
      logRegistrado
    };
  }

  const mailApp = options.mailApp || (typeof MailApp !== 'undefined' ? MailApp : null);
  if (!mailApp || typeof mailApp.sendEmail !== 'function') {
    const mensaje = 'MailApp no está disponible para enviar el parte.';
    const logRegistrado = _registrarLogParte_(repo, options, {
      motivo: 'ERROR_ENVIO',
      estado: 'ERROR',
      referencia: asunto,
      cajas,
      observaciones: mensaje
    });
    return { ok: false, motivo: 'ERROR_ENVIO', error: mensaje, asunto, destinatarios, logRegistrado };
  }

  try {
    mailApp.sendEmail({
      to: destinatarios.join(','),
      subject: asunto,
      body: parte.texto,
      htmlBody: parte.html
    });
    const cierreMarcado = _marcarParteEnviadoParte_(repo, options);
    return { ok: true, asunto, destinatarios, parte, cierreMarcado };
  } catch (err) {
    const mensaje = err && err.message ? err.message : String(err);
    const logRegistrado = _registrarLogParte_(repo, options, {
      motivo: 'ERROR_ENVIO',
      estado: 'ERROR',
      referencia: asunto,
      cajas,
      observaciones: mensaje
    });
    return { ok: false, motivo: 'ERROR_ENVIO', error: mensaje, asunto, destinatarios, logRegistrado };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ParteService,
    enviarParteDiario_,
    leerDestinatariosParte_,
    leerHoraParte_,
    normalizarDestinatariosParte_,
    PARTE_DESTINATARIOS_KEY,
    PARTE_HORA_KEY,
    PARTE_HORA_DEFECTO,
    PARTE_HANDLER
  };
}
