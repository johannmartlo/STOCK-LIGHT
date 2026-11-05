/** Parser puro de los informes CSV de compras y ventas de Hispatec. */
const CSV_HISPATEC_HEADERS = {
  COMPRAS: 'FechaAlbaran;NombreEmisor;NumeroAlbaran;SerieAlbaran;OrdenLinea;NumeracionProveedor;ReferenciaAC;NombreArticulo;DescripcionArticulo;UnidadesEnvase;CantidadLineaAlbaran;CantidadTotal;ReferenciaLineaAlbaran;ObservacionesLineaAlbaran;CantidadPrecioPor;Factor;PorCada;PesoBrutoLACCA;PesoNetoLACCA;NroPaletsAC;PaletAC;NombrePaletAC;CodigoEnvaseAC;NombreEnvaseAC;CantidadEnvasesAC',
  VENTAS: 'Fecha;RefAV;Numero;Albarán;NombreCliente;NombreArticulo;NroEnvases;Cantidad;Piezas;PesoNetoEnviado;NombreEnvase;NroPalets;Palet'
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

function detectarTipo(textoCsv) {
  const cabecera = filaCabecera(textoCsv);
  for (const tipo of Object.keys(CSV_HISPATEC_HEADERS)) {
    if (cabecera === CSV_HISPATEC_HEADERS[tipo]) return tipo;
  }
  throw new Error('Cabecera CSV de Hispatec no reconocida');
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
  const cabeceras = registros[0] || [];
  const indices = Object.create(null);
  cabeceras.forEach((nombre, indice) => { indices[nombre] = indice; });
  const errores = [];
  const lineas = [];

  function valorDe(fila, columna) {
    const indice = indices[columna];
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
  function fechaDe(fila, columna, filaCsv) {
    const bruto = valorDe(fila, columna);
    const valor = csvParsearFecha(bruto);
    if (valor === null) aviso(filaCsv, 'fecha', bruto);
    return valor;
  }

  for (let i = 1; i < registros.length; i++) {
    const fila = registros[i];
    const filaCsv = i + 1;
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
      unidades: numeroDe(fila, columnas.unidades, filaCsv, 'unidades'),
      kg: numeroDe(fila, columnas.kg, filaCsv, 'kg'),
      codigoEnvaseHispatec: tipo === 'COMPRAS' ? (valorDe(fila, 'CodigoEnvaseAC').trim() || null) : null,
      origenDato: 'CSV',
      filaCsv
    });
  }
  return { tipo, lineas, errores };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectarTipo, parsear };
}
