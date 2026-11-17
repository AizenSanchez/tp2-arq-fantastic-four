// Funciones que Artillery llama antes y despues de cada pedido (ver los YAML de esta carpeta).
// Hacen tres cosas: armar el pedido (DNI al azar, clave de idempotencia), elegir el nodo cuando se ensaya
// con dos nodos en local, y anotar la respuesta de cada pedido en un archivo para verificarla despues.
const fs = require("fs");
const crypto = require("crypto");

// donde se anota cada respuesta (lo define correr.mjs) y, solo en local con dos nodos, la lista de nodos
const ARCHIVO = process.env.PEDIDOS_JSONL;
const NODOS = (process.env.TARGETS || "").split(",").map((s) => s.trim()).filter(Boolean);

// DNI valido para el servicio: texto con un numero de 1000000 a 99999999
const dniAlAzar = () => String(1000000 + Math.floor(Math.random() * (99999999 - 1000000 + 1)));

// En Azure hay un solo target (el balanceador) y no se toca nada. En local con dos nodos no hay balanceador:
// se elige un nodo al azar en cada pedido, que es lo que haria el balanceador con conexiones nuevas.
function elegirNodo(requestParams) {
  if (NODOS.length > 1) {
    const url = new URL(requestParams.url, NODOS[0]);
    requestParams.url = NODOS[Math.floor(Math.random() * NODOS.length)] + url.pathname + url.search;
  }
}

// --- escenario saldo: cada pedido es un cambio de 5.000 ARS con un DNI distinto

function prepararSaldo(requestParams, context, ee, next) {
  requestParams.json = { ...requestParams.json, dni: dniAlAzar() };
  elegirNodo(requestParams);
  context.vars.intento = 1;
  context.vars.t0 = Date.now();
  return next();
}

// --- escenario reintentos: cada usuario virtual manda el mismo pedido dos veces con la misma clave

// se ejecuta una vez por usuario virtual, antes de sus pedidos
function iniciarUsuario(context, ee, next) {
  context.vars.key = crypto.randomUUID();
  context.vars.dni = dniAlAzar();
  return next();
}

function prepararReintento(intento) {
  return (requestParams, context, ee, next) => {
    requestParams.json = { ...requestParams.json, dni: context.vars.dni };
    requestParams.headers = { ...requestParams.headers, "Idempotency-Key": context.vars.key };
    // el primer pedido cierra la conexion: el segundo abre una nueva, y con el balanceador de Azure
    // (reparte por conexion) puede caer en otro nodo, que es lo que se quiere probar
    if (intento === 1) requestParams.headers.Connection = "close";
    elegirNodo(requestParams);
    context.vars.intento = intento;
    context.vars.t0 = Date.now();
    return next();
  };
}

// --- comun: anota la respuesta de cada pedido (una linea JSON por pedido)

function registrar(requestParams, response, context, ee, next) {
  let body = {};
  try {
    body = JSON.parse(response.body);
  } catch {
    // respuesta que no es JSON: queda con id nulo
  }
  if (ARCHIVO) {
    fs.appendFileSync(
      ARCHIVO,
      JSON.stringify({
        t: Date.now(),
        key: context.vars.key ?? null,
        intento: context.vars.intento ?? null,
        status: response.statusCode,
        id: body.id ?? null,
        node: response.headers["x-node"] ?? null,
        ms: Date.now() - context.vars.t0,
      }) + "\n"
    );
  }
  return next();
}

module.exports = {
  prepararSaldo,
  iniciarUsuario,
  prepararPrimero: prepararReintento(1),
  prepararSegundo: prepararReintento(2),
  registrar,
};
