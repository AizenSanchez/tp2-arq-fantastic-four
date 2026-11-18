// Una linea por pedido en PEDIDOS_JSONL, cuando vuelve la respuesta o cuando falla (timeout, conexion).
// afterResponse no corre ante un error de red: para eso esta registrarError, el onError del escenario.
const fs = require("fs");

const ARCHIVO = process.env.PEDIDOS_JSONL;

const dniAlAzar = () => String(10000000 + Math.floor(Math.random() * 90000000));

function anotar(linea) {
  if (ARCHIVO) fs.appendFileSync(ARCHIVO, JSON.stringify(linea) + "\n");
}

const escenario = (json) => `${json.baseCurrency}-${json.counterCurrency}`;

function preparar(requestParams, context, ee, next) {
  requestParams.json = { ...requestParams.json, dni: dniAlAzar() };
  context.vars.t0 = Date.now();
  context.vars.escenario = escenario(requestParams.json);
  return next();
}

function registrar(requestParams, response, context, ee, next) {
  const t1 = Date.now();
  // X-Node: el nodo que atendio (con varios nodos detras del balanceador es la unica forma de verlo desde afuera)
  const linea = { t0: context.vars.t0, t1, status: response.statusCode, ms: t1 - context.vars.t0, escenario: context.vars.escenario, nodo: response.headers["x-node"] ?? null };
  // un 503 de ARCA es la dependencia externa; cualquier otro 503 seria nuestro
  if (response.statusCode === 503) {
    let body = {};
    try {
      body = JSON.parse(response.body);
    } catch {}
    linea.arca = body.error === "ARCA no disponible";
    linea.motivo = body.motivo ?? null;
  }
  anotar(linea);
  return next();
}

function registrarError(err, requestParams, context, ee, next) {
  const t1 = Date.now();
  anotar({ t0: context.vars.t0, t1, status: err.code || err.name || "error", ms: t1 - context.vars.t0, escenario: context.vars.escenario });
  return next();
}

module.exports = { preparar, registrar, registrarError };
