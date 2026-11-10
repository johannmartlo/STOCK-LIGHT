/** Clasificación y agrupación pura de líneas canónicas de importación. */
const CLASIFICADOR_CONFIG_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Config')
  : null;

function clasificadorPrefijosPredeterminados() {
  if (CLASIFICADOR_CONFIG_NODE) return CLASIFICADOR_CONFIG_NODE.PREFIJOS_SERIES_IMPORTACION;
  return PREFIJOS_SERIES_IMPORTACION;
}

function clasificadorTieneValor(valor) {
  return valor !== null && valor !== undefined && String(valor).trim() !== '';
}

function clasificadorSerieCuenta(serie, prefijos) {
  const serieMayuscula = String(serie).trim().toUpperCase();
  return (Array.isArray(prefijos) ? prefijos : []).some(prefijo =>
    serieMayuscula.startsWith(String(prefijo).trim().toUpperCase())
  );
}

function clasificadorEstado(linea, estado, mensaje) {
  return Object.assign({}, linea, { estado, mensaje: mensaje || null });
}

function clasificar(lineas, config, esCombinacionSeguida) {
  if (!Array.isArray(lineas)) throw new TypeError('lineas debe ser un array');
  if (typeof esCombinacionSeguida !== 'function') {
    throw new TypeError('esCombinacionSeguida debe ser una función');
  }

  const predeterminados = clasificadorPrefijosPredeterminados();
  const opciones = config || {};
  const prefijosEntrada = opciones.prefijosEntrada || predeterminados.prefijosEntrada;
  const prefijosSalida = opciones.prefijosSalida || predeterminados.prefijosSalida;

  return lineas.map(linea => {
    const articuloVacio = !clasificadorTieneValor(linea.articulo);
    const cajasVacias = !clasificadorTieneValor(linea.cajas);
    const cajasNumero = cajasVacias ? null : Number(linea.cajas);
    if (articuloVacio && (cajasVacias || cajasNumero === 0)) {
      return clasificadorEstado(linea, 'VACIA');
    }

    const origen = String(linea.origenDato || '').toUpperCase();
    const esCsvOdf = origen === 'CSV' || origen === 'PDF';
    const seriePresente = clasificadorTieneValor(linea.serie);
    if (esCsvOdf && seriePresente) {
      const prefijos = linea.tipoDoc === 'ENTRADA' ? prefijosEntrada : prefijosSalida;
      if (!clasificadorSerieCuenta(linea.serie, prefijos)) {
        return clasificadorEstado(linea, 'SERIE_IGNORADA');
      }
    }

    const faltan = [];
    if (!clasificadorTieneValor(linea.fecha)) faltan.push('fecha');
    if (!clasificadorTieneValor(linea.articulo)) faltan.push('artículo');
    if (!clasificadorTieneValor(linea.envase)) faltan.push('envase');
    if (esCsvOdf) {
      if (!seriePresente) faltan.push('serie');
      if (!clasificadorTieneValor(linea.numero)) faltan.push('número');
      if (!clasificadorTieneValor(linea.linea)) faltan.push('línea');
    }
    if (faltan.length) {
      return clasificadorEstado(linea, 'ERROR_DATOS', `Faltan datos: ${faltan.join(', ')}`);
    }

    const seguimiento = esCombinacionSeguida(linea.articulo, linea.envase);
    if (seguimiento === 'NO_SEGUIDA') return clasificadorEstado(linea, 'NO_SEGUIDA');

    // D-031: las cajas numéricas menores o iguales que cero son un abono sin mercancía.
    if (!cajasVacias && Number.isFinite(cajasNumero) && cajasNumero <= 0) {
      return clasificadorEstado(linea, 'ABONO');
    }

    const cajas = Number(linea.cajas);
    if (!Number.isFinite(cajas) || !Number.isInteger(cajas) || cajas <= 0) {
      return clasificadorEstado(linea, 'ERROR_DATOS', 'Las cajas deben ser un entero mayor que cero');
    }
    if (seguimiento === 'PENDIENTE') return clasificadorEstado(linea, 'PENDIENTE');
    if (seguimiento === 'SEGUIDA') return clasificadorEstado(linea, 'OK');
    return clasificadorEstado(linea, 'ERROR_DATOS', 'La combinación no devolvió un estado reconocido');
  });
}

function clasificadorCompararNumerosTexto(a, b) {
  const textoA = a === null || a === undefined ? '' : String(a).trim();
  const textoB = b === null || b === undefined ? '' : String(b).trim();
  const esNumeroA = /^[+-]?\d+$/.test(textoA);
  const esNumeroB = /^[+-]?\d+$/.test(textoB);
  if (esNumeroA && esNumeroB) {
    const numeroA = Number(textoA);
    const numeroB = Number(textoB);
    if (numeroA !== numeroB) return numeroA < numeroB ? -1 : 1;
  }
  return textoA.localeCompare(textoB, 'en', { numeric: false, sensitivity: 'base' });
}

function clasificadorCompararLineas(a, b) {
  const lineaA = Number(a.linea);
  const lineaB = Number(b.linea);
  if (Number.isFinite(lineaA) && Number.isFinite(lineaB) && lineaA !== lineaB) {
    return lineaA < lineaB ? -1 : 1;
  }
  return clasificadorCompararNumerosTexto(a.linea, b.linea);
}

function clasificadorClaveDocumento(linea) {
  return JSON.stringify([linea.tipoDoc || null, linea.serie || null, linea.numero || null]);
}

function clasificadorCompararDocumentos(a, b) {
  const fechaA = a.fecha || '';
  const fechaB = b.fecha || '';
  if (fechaA !== fechaB) return fechaA < fechaB ? -1 : 1;
  const tipoA = a.tipoDoc === 'ENTRADA' ? 0 : 1;
  const tipoB = b.tipoDoc === 'ENTRADA' ? 0 : 1;
  if (tipoA !== tipoB) return tipoA - tipoB;
  const serie = clasificadorCompararNumerosTexto(a.serie, b.serie);
  if (serie !== 0) return serie;
  return clasificadorCompararNumerosTexto(a.numero, b.numero);
}

function agruparEnDocumentos(lineasClasificadas) {
  if (!Array.isArray(lineasClasificadas)) throw new TypeError('lineasClasificadas debe ser un array');
  const grupos = new Map();
  const estados = ['VACIA', 'SERIE_IGNORADA', 'ERROR_DATOS', 'NO_SEGUIDA', 'ABONO', 'PENDIENTE', 'OK'];

  lineasClasificadas.forEach(linea => {
    const clave = clasificadorClaveDocumento(linea);
    if (!grupos.has(clave)) {
      const conteoEstados = {};
      estados.forEach(estado => { conteoEstados[estado] = 0; });
      grupos.set(clave, {
        tipoDoc: linea.tipoDoc || null,
        serie: linea.serie || null,
        numero: linea.numero || null,
        fecha: linea.fecha || null,
        lineasOk: [],
        lineasPendiente: [],
        resumen: { totalLineas: 0, porEstado: conteoEstados }
      });
    }
    const documento = grupos.get(clave);
    documento.resumen.totalLineas++;
    const estado = estados.includes(linea.estado) ? linea.estado : 'ERROR_DATOS';
    documento.resumen.porEstado[estado]++;
    if (estado === 'OK') documento.lineasOk.push(linea);
    if (estado === 'PENDIENTE') documento.lineasPendiente.push(linea);
  });

  const documentos = Array.from(grupos.values());
  documentos.forEach(documento => {
    documento.lineasOk.sort(clasificadorCompararLineas);
    documento.lineasPendiente.sort(clasificadorCompararLineas);
  });
  documentos.sort(clasificadorCompararDocumentos);
  return documentos;
}

function resumenImportacion(lineasClasificadas, documentos) {
  if (!Array.isArray(lineasClasificadas)) throw new TypeError('lineasClasificadas debe ser un array');
  const docs = Array.isArray(documentos) ? documentos : agruparEnDocumentos(lineasClasificadas);
  const porEstado = {};
  lineasClasificadas.forEach(linea => {
    const estado = linea.estado || 'ERROR_DATOS';
    porEstado[estado] = (porEstado[estado] || 0) + 1;
  });
  const porDocumento = docs.map(documento => ({
    tipoDoc: documento.tipoDoc,
    serie: documento.serie,
    numero: documento.numero,
    fecha: documento.fecha,
    totalLineas: documento.resumen.totalLineas,
    porEstado: Object.assign({}, documento.resumen.porEstado)
  }));
  return {
    totalLineas: lineasClasificadas.length,
    totalDocumentos: docs.length,
    porEstado,
    porDocumento
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clasificar, agruparEnDocumentos, resumenImportacion };
}
