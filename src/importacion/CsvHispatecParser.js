/** Parser puro de los informes CSV de compras y ventas de Hispatec. */
const CSV_HISPATEC_COLUMNAS = {
  COMPRAS: {
    obligatorias: [
      'FechaAlbaran',
      'NombreEmisor',
      'SerieAlbaran',
      'NumeroAlbaran',
      'OrdenLinea',
      'NombreArticulo',
      'NombreEnvaseAC',
      'CantidadEnvasesAC'
    ]
  },
  VENTAS: {
    obligatorias: [
      'Fecha',
      'Albarán',
      'NombreCliente',
      'NombreArticulo',
      'NroEnvases',
      'NombreEnvase'
    ]
  },
  RECEPCIONES: {
    obligatorias: [
      'Almacen',
      'FechaRecepcion',
      'Recepción',
      'DescripcionArticulo',
      'Envase',
      'NroEnvases'
    ]
  }
};
// En Node cada archivo es un módulo; Apps Script comparte las funciones globales.
const CSV_NORMALIZACION_NODE = typeof module !== 'undefined' && module.exports
  ? require('../Normalizacion')
  : null;

function csvNormalizarNombre(texto) {
  return CSV_NORMALIZACION_NODE
    ? CSV_NORMALIZACION_NODE.normalizarNombre(texto)
    : normalizarNombre(texto);
}
function csvParsearNumeroEs(texto) {
  return CSV_NORMALIZACION_NODE
    ? CSV_NORMALIZACION_NODE.parsearNumeroEs(texto)
    : parsearNumeroEs(texto);
}
function csvParsearFecha(texto) {
  return CSV_NORMALIZACION_NODE
    ? CSV_NORMALIZACION_NODE.parsearFechaDdMmYyyy(texto)
    : parsearFechaDdMmYyyy(texto);
}

function csvSinBom(texto) {
  return String(texto === null || texto === undefined ? '' : texto).replace(/^\uFEFF/, '');
}

function filaCabecera(textoCsv) {
  const texto = csvSinBom(textoCsv);
  const fin = texto.search(/[\r\n]/);
  return (fin < 0 ? texto : texto.slice(0, fin)).replace(/\s+$/, '');
}

/**
 * Normaliza el nombre de una columna: sin BOM, espacios sobrantes, mayúsculas
 * ni tildes. Así `Albarán` y `ALBARAN` son la misma columna.
 * @param {*} nombre
 * @returns {string}
 */
function normalizarColumnaCsv_(nombre) {
  return String(nombre === null || nombre === undefined ? '' : nombre)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function columnasDeCabecera_(textoCsv) {
  const cabecera = filaCabecera(textoCsv);
  return cabecera.split(';').map(normalizarColumnaCsv_).filter(Boolean);
}

function faltanColumnas_(columnas, obligatorias) {
  const presentes = new Set(columnas);
  return obligatorias.filter((nombre) => !presentes.has(normalizarColumnaCsv_(nombre)));
}

/**
 * Detecta COMPRAS o VENTAS por la presencia de sus columnas obligatorias,
 * sin exigir un orden ni una cabecera exacta.
 * @param {string} textoCsv
 * @returns {'COMPRAS'|'VENTAS'}
 */
function detectarTipo(textoCsv) {
  const columnas = columnasDeCabecera_(textoCsv);
  const faltanCompras = faltanColumnas_(columnas, CSV_HISPATEC_COLUMNAS.COMPRAS.obligatorias);
  let faltanVentas = faltanColumnas_(columnas, CSV_HISPATEC_COLUMNAS.VENTAS.obligatorias);
  const faltanRecepciones = faltanColumnas_(columnas, CSV_HISPATEC_COLUMNAS.RECEPCIONES.obligatorias);

  // Los informes antiguos traen NroPalets y Palet juntos. Si falta Palet pero
  // sigue NroPalets en el formato antiguo (con columna Numero), el fichero está
  // incompleto (compatibilidad T-006). En el formato real Palet es opcional.
  const presentes = new Set(columnas);
  const formatoVentasAntiguo = presentes.has(normalizarColumnaCsv_('Numero'));
  if (
    formatoVentasAntiguo
    && presentes.has(normalizarColumnaCsv_('NroPalets'))
    && !presentes.has(normalizarColumnaCsv_('Palet'))
  ) {
    faltanVentas = faltanVentas.filter((nombre) => normalizarColumnaCsv_(nombre) !== normalizarColumnaCsv_('Palet'));
    faltanVentas.push('Palet');
  }

  if (faltanRecepciones.length === 0) return 'RECEPCIONES';
  if (faltanCompras.length === 0) return 'COMPRAS';
  if (faltanVentas.length === 0) return 'VENTAS';

  const candidatos = [
    { tipo: 'RECEPCIONES', faltan: faltanRecepciones },
    { tipo: 'COMPRAS', faltan: faltanCompras },
    { tipo: 'VENTAS', faltan: faltanVentas }
  ].sort((a, b) => a.faltan.length - b.faltan.length);
  const candidato = candidatos[0].tipo;
  const faltan = candidatos[0].faltan;
  if (candidato === 'VENTAS' && faltan.length === 1 && normalizarColumnaCsv_(faltan[0]) === normalizarColumnaCsv_('Palet')) {
    // Compatibilidad con el formato antiguo incompleto (T-006).
    throw new Error('Cabecera CSV de Hispatec no reconocida: falta la columna Palet.');
  }
  throw new Error(
    `Cabecera CSV de Hispatec incompleta: faltan columnas obligatorias de ${candidato}: ${faltan.join(', ')}.`
  );
}

// Lector CSV con soporte para separadores, comillas escapadas y saltos de línea entrecomillados.
function leerRegistrosCsv(textoCsv) {
  const texto = csvSinBom(textoCsv);
  const registros = [];
  let registro = [];
  let campo = '';
  let entreComillas = false;
  let registroInicio = true;

  for (let i = 0; i < texto.length; i++) {
    const caracter = texto[i];
    if (entreComillas) {
      if (caracter === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (caracter === '"') {
        entreComillas = false;
      } else {
        campo += caracter;
      }
    } else if (caracter === '"' && (registroInicio || campo === '')) {
      entreComillas = true;
      registroInicio = false;
    } else if (caracter === ';') {
      registro.push(campo);
      campo = '';
      registroInicio = true;
    } else if (caracter === '\n' || caracter === '\r') {
      if (caracter === '\r' && texto[i + 1] === '\n') i++;
      registro.push(campo);
      if (registro.some(valor => valor !== '')) registros.push(registro);
      registro = [];
      campo = '';
      registroInicio = true;
    } else {
      campo += caracter;
      registroInicio = false;
    }
  }
  registro.push(campo);
  if (registro.some(valor => valor !== '')) registros.push(registro);
  return registros;
}

function parsear(textoCsv) {
  const tipo = detectarTipo(textoCsv);
  const registros = leerRegistrosCsv(textoCsv);
  const cabeceras = (registros[0] || []).map(normalizarColumnaCsv_);
  const indices = Object.create(null);
  cabeceras.forEach((nombre, indice) => {
    if (nombre && indices[nombre] === undefined) indices[nombre] = indice;
  });
  const errores = [];
  const lineas = [];
  let proveedorActual = null;

  function tieneColumna(columna) {
    return indices[normalizarColumnaCsv_(columna)] !== undefined;
  }
  function valorDe(fila, columna) {
    const indice = indices[normalizarColumnaCsv_(columna)];
    return indice === undefined || indice >= fila.length ? '' : fila[indice];
  }
  function aviso(filaCsv, campo, valor) {
    errores.push({ filaCsv, campo, valor });
  }
  function numeroDe(fila, columna, filaCsv, campo) {
    const bruto = valorDe(fila, columna);
    const valor = csvParsearNumeroEs(bruto);
    if (valor === null || Number.isNaN(valor)) {
      aviso(filaCsv, campo, bruto);
      return null;
    }
    return valor;
  }
  function numeroOpcionalDe(fila, columna, filaCsv, campo) {
    if (!tieneColumna(columna)) return null;
    const bruto = valorDe(fila, columna);
    if (String(bruto).trim() === '') return null;
    return numeroDe(fila, columna, filaCsv, campo);
  }
  function fechaDe(fila, columna, filaCsv) {
    const bruto = valorDe(fila, columna);
    const valor = csvParsearFecha(bruto);
    if (valor === null) aviso(filaCsv, 'fecha', bruto);
    return valor;
  }

  for (let i = 1; i < registros.length; i++) {
    const fila = registros[i];
    const filaCsv = i + 1;
    if (!fila || fila.every(valor => String(valor).trim() === '')) continue;

    if (tipo === 'RECEPCIONES') {
      // El proveedor viene en una fila de grupo anterior a sus líneas.
      let proveedorFila = null;
      for (const celda of fila) {
        const texto = String(celda === null || celda === undefined ? '' : celda).trim();
        const matchProveedor = /^NombreProveedor\s*:\s*(.*)$/i.exec(texto);
        if (matchProveedor) {
          proveedorFila = matchProveedor[1];
          break;
        }
      }
      if (proveedorFila !== null) {
        proveedorActual = csvNormalizarNombre(proveedorFila) || null;
        continue;
      }

      const fechaBruta = valorDe(fila, 'FechaRecepcion');
      const recepcionBruta = valorDe(fila, 'Recepción');
      const articuloBruto = valorDe(fila, 'DescripcionArticulo');
      // Solo son datos las filas con fecha, recepción y artículo. Empresa,
      // separadores, totales y filas finales se saltan.
      if (!String(fechaBruta).trim() || !String(recepcionBruta).trim() || !String(articuloBruto).trim()) {
        continue;
      }

      // T-035: el proveedor puede venir en la columna NombreProveedor. Si la
      // celda está vacía (o la columna no existe), se usa el último grupo.
      const proveedorColumna = String(valorDe(fila, 'NombreProveedor') || '').trim();
      const proveedorLinea = proveedorColumna
        ? (csvNormalizarNombre(proveedorColumna) || null)
        : proveedorActual;

      const matchRecepcion = /^\s*([^/\s]*)\s*\/\s*([^\s(]+)\s*\(\s*(\d+)\s*\)\s*$/.exec(recepcionBruta);
      let serie = 'REC';
      let numero = null;
      let linea = null;
      if (matchRecepcion) {
        serie = String(matchRecepcion[1] || '').trim() || 'REC';
        numero = matchRecepcion[2];
        linea = Number(matchRecepcion[3]);
      } else {
        aviso(filaCsv, 'recepcion', recepcionBruta);
      }

      const entidad = proveedorLinea ? csvNormalizarNombre(proveedorLinea) : null;
      const articulo = csvNormalizarNombre(articuloBruto) || null;
      const envaseBruto = valorDe(fila, 'Envase');
      const envase = csvNormalizarNombre(envaseBruto) || null;
      const partida = String(valorDe(fila, 'Partida') || '').trim() || null;
      if (!entidad) aviso(filaCsv, 'entidad', '');
      if (!articulo) aviso(filaCsv, 'articulo', articuloBruto);
      if (!envase) aviso(filaCsv, 'envase', envaseBruto);

      const lineaRecepcion = {
        tipoDoc: 'ENTRADA',
        serie: serie || null,
        numero: numero || null,
        linea,
        fecha: fechaDe(fila, 'FechaRecepcion', filaCsv),
        entidad,
        articulo,
        envase,
        cajas: numeroDe(fila, 'NroEnvases', filaCsv, 'cajas'),
        unidades: null,
        kg: numeroOpcionalDe(fila, 'Cantidad', filaCsv, 'kg'),
        codigoEnvaseHispatec: null,
        partida,
        origenDato: 'CSV',
        filaCsv
      };
      if (!entidad) lineaRecepcion.errorDatos = 'Proveedor no encontrado';
      lineas.push(lineaRecepcion);
      continue;
    }

    let serie;
    let numero;
    let linea;
    let columnas;
    if (tipo === 'COMPRAS') {
      serie = valorDe(fila, 'SerieAlbaran').trim() || null;
      numero = valorDe(fila, 'NumeroAlbaran').trim() || null;
      linea = numeroDe(fila, 'OrdenLinea', filaCsv, 'linea');
      columnas = {
        fecha: 'FechaAlbaran', entidad: 'NombreEmisor', articulo: 'NombreArticulo',
        envase: 'NombreEnvaseAC', cajas: 'CantidadEnvasesAC', unidades: 'CantidadLineaAlbaran',
        kg: 'PesoNetoLACCA'
      };
      if (!serie) aviso(filaCsv, 'serie', valorDe(fila, 'SerieAlbaran'));
      if (!numero) aviso(filaCsv, 'numero', valorDe(fila, 'NumeroAlbaran'));
    } else {
      const albaran = valorDe(fila, 'Albarán');
      const match = /^\s*([A-Z]+\d*)\s*\/\s*(\d+)\s*\(\s*(\d+)\s*\)\s*$/.exec(albaran);
      if (match) {
        serie = match[1];
        numero = match[2];
        linea = Number(match[3]);
      } else {
        serie = numero = linea = null;
        aviso(filaCsv, 'albaran', albaran);
      }

      // Si el formato trae Numero, debe coincidir con el número de Albarán.
      if (match && tieneColumna('Numero')) {
        const numeroColumna = String(valorDe(fila, 'Numero')).trim();
        if (numeroColumna !== String(numero)) {
          aviso(filaCsv, 'numero', numeroColumna);
          numero = null;
        }
      }

      columnas = {
        fecha: 'Fecha', entidad: 'NombreCliente', articulo: 'NombreArticulo',
        envase: 'NombreEnvase', cajas: 'NroEnvases', unidades: 'Piezas', kg: 'PesoNetoEnviado'
      };
    }

    const entidadBruta = valorDe(fila, columnas.entidad);
    const articuloBruto = valorDe(fila, columnas.articulo);
    const envaseBruto = valorDe(fila, columnas.envase);
    const entidad = csvNormalizarNombre(entidadBruta);
    const articulo = csvNormalizarNombre(articuloBruto);
    const envase = csvNormalizarNombre(envaseBruto);
    if (!entidad) aviso(filaCsv, 'entidad', entidadBruta);
    if (!articulo) aviso(filaCsv, 'articulo', articuloBruto);
    if (!envase) aviso(filaCsv, 'envase', envaseBruto);

    lineas.push({
      tipoDoc: tipo === 'COMPRAS' ? 'ENTRADA' : 'SALIDA',
      serie: serie || null,
      numero: numero || null,
      linea: linea === null || linea === undefined ? null : linea,
      fecha: fechaDe(fila, columnas.fecha, filaCsv),
      entidad: entidad || null,
      articulo: articulo || null,
      envase: envase || null,
      cajas: numeroDe(fila, columnas.cajas, filaCsv, 'cajas'),
      unidades: numeroOpcionalDe(fila, columnas.unidades, filaCsv, 'unidades'),
      kg: numeroOpcionalDe(fila, columnas.kg, filaCsv, 'kg'),
      codigoEnvaseHispatec: tipo === 'COMPRAS' && tieneColumna('CodigoEnvaseAC')
        ? (valorDe(fila, 'CodigoEnvaseAC').trim() || null)
        : null,
      origenDato: 'CSV',
      filaCsv
    });
  }
  return { tipo, lineas, errores };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CSV_HISPATEC_COLUMNAS,
    normalizarColumnaCsv: normalizarColumnaCsv_,
    normalizarColumnaCsv_,
    detectarTipo,
    parsear
  };
}
