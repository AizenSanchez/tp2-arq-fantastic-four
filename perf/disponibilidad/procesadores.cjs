// Cada pedido se anota al salir y al volver: Artillery no llama a afterResponse ante un error de conexion
// o un timeout, asi que un pedido sin linea de respuesta es un pedido perdido.
const fs = require("fs");
const crypto = require("crypto");

const ARCHIVO = process.env.PEDIDOS_JSONL;
// lo fija correr.mjs para que todos los workers de Artillery compartan el mismo instante 0
const INICIO = Number(process.env.INICIO_MS || Date.now());
const INVALIDOS_DESDE = Number(process.env.INVALIDOS_DESDE_S ?? 30);
const INVALIDOS_HASTA = Number(process.env.INVALIDOS_HASTA_S ?? 40);
const INVALIDOS_PROB = Number(process.env.INVALIDOS_PROB ?? 0.125);

const dniAlAzar = () => String(1000000 + Math.floor(Math.random() * (99999999 - 1000000 + 1)));

function anotar(linea) {
  if (ARCHIVO) fs.appendFileSync(ARCHIVO, JSON.stringify(linea) + "\n");
}

function preparar(requestParams, context, ee, next) {
  const t0 = Date.now();
  const segundo = (t0 - INICIO) / 1000;
  const json = { ...requestParams.json, dni: dniAlAzar() };
  let invalido = null;

  if (segundo >= INVALIDOS_DESDE && segundo < INVALIDOS_HASTA && Math.random() < INVALIDOS_PROB) {
    if (Math.random() < 0.5) {
      json.dni = "123";
      invalido = "dni";
    } else {
      json.baseCurrency = "XYZ";
      invalido = "moneda";
    }
    ee.emit("counter", "pedidos_invalidos_enviados", 1);
  }

  requestParams.json = json;
  context.vars.pid = crypto.randomUUID();
  context.vars.t0 = t0;
  context.vars.invalido = invalido;
  anotar({ tipo: "enviado", id: context.vars.pid, t: t0, invalido });
  return next();
}

function registrar(requestParams, response, context, ee, next) {
  let body = {};
  try {
    body = JSON.parse(response.body);
  } catch {}
  const status = response.statusCode;
  // un 503 de ARCA es la dependencia externa, no una falla nuestra
  let clase;
  if (status >= 200 && status < 500) clase = "atendido";
  else if (status === 503 && body.error === "ARCA no disponible") clase = "arca_503";
  else clase = "error_5xx";

  anotar({
    tipo: "respuesta",
    id: context.vars.pid,
    t0: context.vars.t0,
    t1: Date.now(),
    status,
    clase,
    invalido: context.vars.invalido,
    motivo: body.motivo ?? null,
    nodo: response.headers["x-node"] ?? null,
  });
  return next();
}

module.exports = { preparar, registrar };
