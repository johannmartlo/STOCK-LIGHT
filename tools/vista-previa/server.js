/**
 * Servidor local de vista previa para T-024 (sin dependencias externas).
 * - Sirve `src/Index.html` montando todos los `<?!= include_('ui/...') ?>`
 * - Simula `google.script.run` conectado al `InicioService` real sobre datos ficticios
 * - Incluye selector interactivo de estados (normal, cargando, vacío, sin conexión, error, PIN)
 *
 * Uso: node tools/vista-previa/server.js [puerto]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearEntornoVistaPrevia } = require('./datosFicticios');

const PORT = Number(process.argv[2] || process.env.PORT || 3099);
const SRC_DIR = path.resolve(__dirname, '../../src');
const FIXTURES_CSV_DIR = path.resolve(__dirname, '../../test/fixtures/csv');

let ctx = crearEntornoVistaPrevia();

function incluirParcial(nombre) {
  const limpio = String(nombre || '').trim().replace(/^\/+/, '');
  const archivo = path.join(SRC_DIR, `${limpio}.html`);
  return fs.readFileSync(archivo, 'utf8');
}

function renderIndexHtml(query) {
  const estado = query.get('estado') || 'normal';
  const vista = query.get('vista') || '';
  const accion = query.get('accion') || '';
  const mostrarToolbar = query.get('toolbar') !== '0';
  const rolQuery = String(query.get('rol') || '').trim().toUpperCase();
  const rolEfectivo = ['CONSULTA', 'ENCARGADO', 'ADMIN'].includes(rolQuery)
    ? rolQuery
    : ctx.sesionInicial.rol;
  const nombreEfectivo = rolEfectivo === 'CONSULTA' ? 'Lucía Consulta' : ctx.sesionInicial.nombre;
  const esPin = estado === 'pin';

  let html = fs.readFileSync(path.join(SRC_DIR, 'Index.html'), 'utf8');
  html = html.replace(/<\?!?=\s*include_\(['"]([^'"]+)['"]\)\s*\?>/g, (_, nombre) => incluirParcial(nombre));
  html = html.replace(/<\?!?=\s*k\s*\?>/g, esPin ? ctx.tokenPreview : '');
  html = html.replace(/<\?!?=\s*tienePin\s*\?\s*'1'\s*:\s*'0'\s*\?>/g, esPin ? '1' : '0');

  const autoLoginScript = esPin
    ? ''
    : `window.__SL_PREVIEW_AUTO_LOGIN__ = ${JSON.stringify({
        sesion: ctx.sesionInicial.sesion,
        nombre: nombreEfectivo,
        rol: rolEfectivo
      })};`;

  const puenteSimulado = `
<script>
(function () {
  ${autoLoginScript}
  var previewEstado = ${JSON.stringify(estado)};
  var previewVista = ${JSON.stringify(vista)};
  var previewAccion = ${JSON.stringify(accion)};

  function makeRunner(okCb, errCb) {
    function callBackend(fnName, args) {
      fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fnName: fnName, args: args })
      })
      .then(function (r) { return r.json(); })
      .then(function (payload) {
        if (payload && payload.ok) {
          if (typeof okCb === 'function') okCb(payload.result);
        } else {
          var err = new Error((payload && payload.error) || 'Error simulado');
          if (typeof errCb === 'function') errCb(err);
        }
      })
      .catch(function (e) {
        if (typeof errCb === 'function') errCb(e);
      });
    }

    var runner = {
      withSuccessHandler: function (fn) { return makeRunner(fn, errCb); },
      withFailureHandler: function (fn) { return makeRunner(okCb, fn); },
      apiLlamar: function (sesion, fnName, args) { callBackend('apiLlamar', [sesion, fnName, args]); },
      apiEntrar: function (token, pin) { callBackend('apiEntrar', [token, pin]); },
      apiEstablecerPin: function (token, pin) { callBackend('apiEstablecerPin', [token, pin]); }
    };
    return runner;
  }

  window.google = {
    script: {
      run: makeRunner(null, null),
      history: { replace: function () {} }
    }
  };

  window.addEventListener('DOMContentLoaded', function () {
    if (previewEstado !== 'normal' && previewEstado !== 'pin' && window.SLApp) {
      setTimeout(function () {
        window.SLApp.aplicarEstadoPreview(previewEstado);
      }, 80);
    } else if (previewVista && window.SLApp) {
      setTimeout(function () {
        if (previewVista === 'importar') window.SLApp.abrirImportar('csv');
        else if (previewVista === 'stock_inicial') window.SLApp.abrirImportar('stock_inicial');
        else if (previewVista === 'pendientes') {
          window.SLApp.abrirPendientes();
          if (previewAccion === 'version' && window.SLPendientes) {
            setTimeout(function () { window.SLPendientes.abrirVersion('PEND-PREV-4'); }, 450);
          }
        } else if (previewVista === 'movimientos') {
          window.SLApp.abrirMovimientos();
          if (previewAccion === 'detalle' || previewAccion === 'imposible') {
            setTimeout(function () {
              window.SLBridge.call('apiListarMovimientos', { limite: 500 }).then(function (res) {
                var elementos = [];
                ((res && res.grupos) || []).forEach(function (g) {
                  elementos = elementos.concat(g.elementos || []);
                });
                var tx = null;
                if (previewAccion === 'imposible') {
                  tx = elementos.filter(function (t) { return t.tipo === 'cambio' && t.anulable === false; })[0];
                } else {
                  tx = elementos.filter(function (t) {
                    return ['salida', 'entrada', 'ajuste', 'destrio'].indexOf(t.tipo) >= 0 && t.anulable === true;
                  })[0];
                }
                if (tx && window.SLMov) window.SLMov.abrirDetalle(tx.tipo + '|' + tx.id);
              });
            }, 400);
          }
        } else if (previewVista === 'parte') window.SLApp.abrirParte();
        else if (previewVista === 'buscar') {
          window.SLApp.abrirBuscar('rosa');
        }
      }, 150);
    }

    if (${mostrarToolbar ? 'true' : 'false'}) {
      var bar = document.createElement('div');
      bar.id = 'slPreviewToolbar';
      bar.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:9999;background:#18181B;border:1px solid #27272A;border-radius:10px;padding:6px 8px;display:flex;gap:4px;flex-wrap:wrap;font-family:Geist,sans-serif;font-size:11px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
      var opciones = [
        ['normal', 'Datos'],
        ['cargando', 'Cargando'],
        ['vacio', 'Vacío'],
        ['sin_conexion', 'Sin conexión'],
        ['error', 'Error'],
        ['pin', 'PIN']
      ];
      opciones.forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt[1];
        b.style.cssText = 'height:24px;padding:0 8px;border-radius:6px;border:1px solid #27272A;background:' + (previewEstado === opt[0] ? '#EDEDEF' : 'transparent') + ';color:' + (previewEstado === opt[0] ? '#0A0A0B' : '#EDEDEF') + ';cursor:pointer;font-size:11px;font-weight:500';
        b.addEventListener('click', function () {
          if (opt[0] === 'pin' || previewEstado === 'pin') {
            window.location.href = '/?estado=' + opt[0];
          } else if (window.SLApp) {
            previewEstado = opt[0];
            window.SLApp.aplicarEstadoPreview(opt[0]);
            bar.querySelectorAll('button').forEach(function (x, idx) {
              var act = opciones[idx][0] === opt[0];
              x.style.background = act ? '#EDEDEF' : 'transparent';
              x.style.color = act ? '#0A0A0B' : '#EDEDEF';
            });
          }
        });
        bar.appendChild(b);
      });
      document.body.appendChild(bar);
    }
  });
})();
</script>
`;

  return html.replace('</head>', `${puenteSimulado}\n</head>`);
}

function despacharApi(fnName, args) {
  if (fnName === 'apiEntrar') {
    return ctx.accesoSvc.entrar(args[0], args[1]);
  }
  if (fnName === 'apiEstablecerPin') {
    return ctx.accesoSvc.establecerPin(args[0], args[1]);
  }
  if (fnName === 'apiLlamar') {
    const targetFn = args[1];
    const targetArgs = Array.isArray(args[2]) ? args[2] : [];
    const usuario = ctx.sesionInicial.nombre || 'Juan Alberto';
    if (targetFn === 'apiObtenerInicio') {
      return ctx.inicioSvc.obtenerInicio();
    }
    if (targetFn === 'apiObtenerPartida') {
      return ctx.inicioSvc.obtenerPartida(targetArgs[0]);
    }
    if (targetFn === 'apiListarMovimientos') {
      return ctx.operacionesSvc.listarMovimientos(targetArgs[0] || {});
    }
    if (targetFn === 'apiBuscar') {
      return ctx.operacionesSvc.buscar(targetArgs[0]);
    }
    if (targetFn === 'apiPrevisualizarAnulacion') {
      return ctx.operacionesSvc.previsualizarAnulacion(targetArgs[0], targetArgs[1]);
    }
    if (targetFn === 'apiObtenerParte') {
      return ctx.parteSvc.generarParte(targetArgs[0] || {});
    }
    if (targetFn === 'apiListarVersionesPendientes') {
      return ctx.correccionSvc.listarVersionesPendientes();
    }
    if (targetFn === 'apiPrevisualizarVersion') {
      return ctx.correccionSvc.previsualizarVersion(targetArgs[0]);
    }
    if (targetFn === 'apiAplicarVersion') {
      return ctx.correccionSvc.aplicarVersion(targetArgs[0], targetArgs[1], usuario);
    }
    if (targetFn === 'apiPrevisualizarAnularAjuste') {
      return ctx.correccionSvc.previsualizarAnularAjuste(targetArgs[0]);
    }
    if (targetFn === 'apiAnularAjuste') {
      return ctx.correccionSvc.anularAjuste(targetArgs[0], targetArgs[1], usuario);
    }
    if (targetFn === 'apiAnularEntrada') {
      return ctx.safetySvc.anularEntrada(targetArgs[0] || {}, usuario);
    }
    if (targetFn === 'apiAnularSalida') {
      return ctx.safetySvc.anularSalida(targetArgs[0] || {}, usuario);
    }
    if (targetFn === 'apiAnularReproceso') {
      return ctx.env.movService.anularReproceso(targetArgs[0], usuario);
    }
    if (targetFn === 'apiPrevisualizarImportacionCsv') {
      return ctx.importacionSvc.previsualizar(targetArgs[0]);
    }
    if (targetFn === 'apiConfirmarImportacionCsv') {
      return ctx.importacionSvc.confirmar(targetArgs[0], targetArgs[1], usuario);
    }
    if (targetFn === 'apiListarPendientes') {
      return ctx.pendientesSvc.listarPendientes(targetArgs[0] || {});
    }
    if (targetFn === 'apiReintentarPendientes') {
      return ctx.pendientesSvc.reintentarPendientes(usuario, targetArgs[0] || {});
    }
    if (targetFn === 'apiMarcarPendienteResuelto') {
      return ctx.pendientesSvc.marcarPendienteResuelto(targetArgs[0], targetArgs[1] || '', usuario);
    }
    if (targetFn === 'apiDecidirSeguimiento') {
      return ctx.seguimientoSvc.decidirSeguimiento(targetArgs[0], targetArgs[1], targetArgs[2], targetArgs[3] || '', usuario);
    }
    if (targetFn === 'apiGetConfiguracionCatalogo') {
      return ctx.catalogoSvc.obtenerConfiguracion();
    }
    if (targetFn === 'apiPrevisualizarStockInicial') {
      return ctx.stockInicialSvc.previsualizar(targetArgs[0]);
    }
    if (targetFn === 'apiConfirmarStockInicial') {
      return ctx.stockInicialSvc.confirmar(targetArgs[0], targetArgs[1], usuario, { anadir: targetArgs[2] === true });
    }
    if (targetFn === 'apiSalir') {
      return { success: true };
    }
    throw new Error(`API '${targetFn}' no simulada en vista previa.`);
  }
  throw new Error(`Función '${fnName}' no reconocida.`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const html = renderIndexHtml(url.searchParams);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.stack || err.message);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const result = despacharApi(parsed.fnName, parsed.args || []);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/reset') {
    ctx = crearEntornoVistaPrevia();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/fixtures/')) {
    const nombre = path.basename(url.pathname);
    const archivo = path.join(FIXTURES_CSV_DIR, nombre);
    if (fs.existsSync(archivo) && nombre.endsWith('.csv')) {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
      res.end(fs.readFileSync(archivo));
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vista previa STOCK-LIGHT lista en http://127.0.0.1:${PORT}/`);
});
