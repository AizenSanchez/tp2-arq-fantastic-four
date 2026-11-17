#!/usr/bin/env node
// Corre un escenario de integridad de punta a punta y verifica sus invariantes.
//
//   node perf/integridad/correr.mjs <saldo|reintentos> <caso> [--env local|azure]
//
// Que hace, en orden:
//   1. reinicia el estado de Redis (los escenarios cambian tasa y saldos, que son compartidos)
//   2. prepara el escenario (tasa y saldo) y saca una foto del estado ANTES
//   3. lanza Artillery y, mientras corre, mira el saldo de USD cada 1 s
//   4. saca una foto DESPUES y compara todo contra lo que respondio el servicio
//
// Solo habla HTTP con el servicio (/accounts, /log, /rates), asi que sirve igual en local y en Azure.
// Las predicciones estan en perf/predicciones/integridad.md.
//
// Variables de entorno: TARGET o TARGETS (nodos, separados por coma), RESET_CMD (como reiniciar el estado),
// RTT_MS (latencia de red base, para comparar latencias), CONEXION (cable o wifi), DATADOG_API_KEY (solo azure).
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AQUI = import.meta.dirname;
const RAIZ = path.resolve(AQUI, "../..");

// ---------------------------------------------------------------- argumentos

const args = process.argv.slice(2);
const flag = (nombre, defecto) => {
  const i = args.indexOf(`--${nombre}`);
  if (i < 0) return defecto;
  const valor = args[i + 1];
  args.splice(i, 2);
  return valor;
};
const ENTORNO = flag("env", "local");
const [escenario, caso] = args;

const ESCENARIOS = {
  saldo: { yaml: "exchange-integridad-saldo.yaml", pedidos: 400 },
  reintentos: { yaml: "exchange-integridad-reintentos.yaml", pedidos: 400 },
};

if (!ESCENARIOS[escenario] || !caso || !["local", "azure"].includes(ENTORNO)) {
  console.error("uso: node perf/integridad/correr.mjs <saldo|reintentos> <caso> [--env local|azure]");
  console.error("ejemplos de caso: local-1-nodo, local-2-nodos, 1-nodo, escalado");
  process.exit(2);
}

const nombreCompleto = `exchange-integridad-${escenario}`;
const salida = path.join(RAIZ, "perf/results", caso);
const extras = path.join(salida, nombreCompleto);
const rawArtillery = path.join(salida, `${nombreCompleto}.json`);
fs.mkdirSync(extras, { recursive: true });
for (const f of ["pedidos.jsonl", "saldos.jsonl"]) fs.rmSync(path.join(extras, f), { force: true });

// nodos a los que se le pega. En Azure es uno solo: el balanceador
function nodos() {
  if (process.env.TARGETS) return process.env.TARGETS.split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.TARGET) return [process.env.TARGET];
  if (ENTORNO === "azure") {
    const dns = fs.readFileSync(path.join(RAIZ, "node/lb_dns"), "utf8").trim();
    return [`http://${dns}`];
  }
  return ["http://localhost:3000"];
}
const NODOS = nodos();
const BASE = NODOS[0];
const RTT_MS = Number(process.env.RTT_MS ?? 0);

// ---------------------------------------------------------------- utilidades

async function http(metodo, url, cuerpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000),
  });
  const texto = await r.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    // no era JSON
  }
  return { status: r.status, json };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const percentil = (valores, p) => {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
};
const leerJsonl = (archivo) =>
  fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const guardar = (nombre, dato) => fs.writeFileSync(path.join(extras, nombre), JSON.stringify(dato, null, 2) + "\n");

async function esperarSalud() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await http("GET", `${BASE}/health`)).status === 200) return;
    } catch {
      // todavia no responde
    }
    await dormir(1000);
  }
  throw new Error(`${BASE}/health no responde 200`);
}

async function leerEstado() {
  const cuentas = (await http("GET", `${BASE}/accounts`)).json;
  const de = (moneda) => cuentas.find((c) => c.currency === moneda);
  return { cuentas, ars: de("ARS").balance, usd: de("USD").balance, usdId: de("USD").id };
}

// ---------------------------------------------------------------- 1 y 2: reinicio y preparacion

const resetCmd =
  process.env.RESET_CMD ??
  (ENTORNO === "local"
    ? "docker compose -f docker-compose.local.yml exec -T app node tools/reset-state.js"
    : "ansible/reset.sh");
console.log(`[1/4] reinicio del estado: ${resetCmd}`);
execSync(resetCmd, { cwd: RAIZ, stdio: "inherit" });
await esperarSalud();

// saldo: tasa 0,001 (5.000 ARS = 5 USD exactos) y 100 USD de saldo = saldo para 20 cambios
const MONTO_ARS = 5000;
const MONTO_USD = 5;
if (escenario === "saldo") {
  const inicial = await leerEstado();
  const r1 = await http("PUT", `${BASE}/rates`, { baseCurrency: "ARS", counterCurrency: "USD", rate: 0.001 });
  const r2 = await http("PUT", `${BASE}/accounts/${inicial.usdId}/balance`, { balance: 100 });
  if (r1.status !== 200 || r2.status !== 200) throw new Error(`no se pudo preparar el saldo (${r1.status}, ${r2.status})`);
}

const antes = await leerEstado();
const logAntes = (await http("GET", `${BASE}/log`)).json.length;
guardar("antes.json", { cuentas: antes.cuentas, entradasDeLog: logAntes, rates: (await http("GET", `${BASE}/rates`)).json });
console.log(`[2/4] estado inicial: USD ${antes.usd}, ARS ${antes.ars}, ${logAntes} entradas en el log`);

// ---------------------------------------------------------------- 3: carga y vigilancia del saldo

if (ENTORNO === "azure" && !process.env.DATADOG_API_KEY) {
  throw new Error("falta DATADOG_API_KEY (la usa el plugin de Datadog de Artillery en el entorno azure)");
}

const saldos = [];
let vigilando = true;
const vigilante = (async () => {
  while (vigilando) {
    try {
      const e = await leerEstado();
      saldos.push({ t: Date.now(), usd: e.usd, ars: e.ars });
    } catch {
      // una lectura perdida no invalida la corrida
    }
    await dormir(1000);
  }
})();

const inicio = new Date();
console.log(`[3/4] Artillery (${ESCENARIOS[escenario].yaml}, entorno ${ENTORNO}) contra ${NODOS.join(", ")}`);
const codigo = await new Promise((resolve) => {
  const p = spawn(
    path.join(RAIZ, "perf/node_modules/.bin/artillery"),
    ["run", ESCENARIOS[escenario].yaml, "-e", ENTORNO, "--output", rawArtillery],
    {
      cwd: AQUI,
      stdio: "inherit",
      env: {
        ...process.env,
        TARGET: NODOS[0],
        TARGETS: NODOS.join(","),
        CASO: caso,
        DATADOG_API_HOST: process.env.DATADOG_API_HOST ?? "app.datadoghq.com",
        PEDIDOS_JSONL: path.join(extras, "pedidos.jsonl"),
      },
    }
  );
  p.on("exit", resolve);
});
const fin = new Date();
await dormir(1500);
vigilando = false;
await vigilante;
if (codigo !== 0) console.error(`AVISO: Artillery termino con codigo ${codigo}`);

// ---------------------------------------------------------------- 4: foto final y verificacion

const despues = await leerEstado();
const logCompleto = (await http("GET", `${BASE}/log`)).json;
const nuevas = logCompleto.slice(logAntes);
fs.writeFileSync(path.join(extras, "saldos.jsonl"), saldos.map((s) => JSON.stringify(s)).join("\n") + "\n");
guardar("despues.json", { cuentas: despues.cuentas, entradasNuevasDeLog: nuevas });

const pedidos = leerJsonl(path.join(extras, "pedidos.jsonl"));
const artillery = JSON.parse(fs.readFileSync(rawArtillery, "utf8"));
const erroresDeCliente = Object.entries(artillery.aggregate?.counters ?? {})
  .filter(([k]) => k.startsWith("errors."))
  .reduce((suma, [, v]) => suma + v, 0);

const comprobaciones = [];
// exacta: si falla, la corrida falla. esperada: solo se informa si cae fuera del rango predicho
const exacta = (nombre, ok, detalle) => comprobaciones.push({ tipo: "exacta", nombre, ok, detalle });
const esperada = (nombre, valor, min, max) =>
  comprobaciones.push({ tipo: "esperada", nombre, ok: valor !== null && valor >= min && valor <= max, detalle: `${valor} (rango ${min} a ${max})` });
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const porEstado = {};
for (const p of pedidos) porEstado[p.status] = (porEstado[p.status] ?? 0) + 1;
const n = (...estados) => estados.reduce((s, e) => s + (porEstado[e] ?? 0), 0);
const lat = (lista) => ({ n: lista.length, mediana: percentil(lista.map((p) => p.ms), 50), p95: percentil(lista.map((p) => p.ms), 95) });
const latenciaPorEstado = Object.fromEntries(
  Object.keys(porEstado).map((e) => [e, lat(pedidos.filter((p) => String(p.status) === e))])
);
const porNodo = {};
for (const p of pedidos) porNodo[p.node ?? "?"] = (porNodo[p.node ?? "?"] ?? 0) + 1;

const okLog = nuevas.filter((e) => e.ok);
const estadosEsperados = [200, 403, 422, 503];
const respondidos = n(200, 403, 422, 502, 503);

// invariantes que valen en los dos escenarios
exacta("todos los pedidos tienen respuesta registrada", pedidos.length === ESCENARIOS[escenario].pedidos, `${pedidos.length} de ${ESCENARIOS[escenario].pedidos}`);
exacta("sin errores propios (otros estados, timeouts, conexiones caidas)", pedidos.length - n(...estadosEsperados) === 0 && erroresDeCliente === 0,
  `otros estados: ${pedidos.length - n(...estadosEsperados)}, errores de Artillery: ${erroresDeCliente}, estados: ${JSON.stringify(porEstado)}`);
exacta("el saldo de USD nunca fue negativo", saldos.length > 0 && saldos.every((s) => s.usd >= 0), `minimo visto: ${Math.min(...saldos.map((s) => s.usd))} en ${saldos.length} lecturas`);

let extra = {};

if (escenario === "saldo") {
  const capacidad = Math.floor(antes.usd / MONTO_USD);
  exacta(`aprobados (200) = ${capacidad}`, n(200) === capacidad, `${n(200)}`);
  exacta("saldo final de USD = saldo inicial - 5 x aprobados", cerca(despues.usd, antes.usd - MONTO_USD * n(200)), `${despues.usd}`);
  exacta("saldo final de ARS = saldo inicial + 5.000 x aprobados", cerca(despues.ars, antes.ars + MONTO_ARS * n(200)), `${despues.ars}`);
  exacta("entradas nuevas del log = pedidos respondidos", nuevas.length === respondidos, `${nuevas.length} contra ${respondidos}`);
  exacta("entradas del log con ok:true = aprobados", okLog.length === n(200), `${okLog.length} contra ${n(200)} respuestas 200`);

  esperada("pedidos que llegan a la reserva (200 + 422)", n(200, 422), 215, 255);
  esperada("422 (sin fondos)", n(422), 195, 235);
  esperada("403 (ARCA rechaza)", n(403), 126, 162);
  esperada("503 (ARCA no disponible)", n(503), 12, 30);

  // rafaga = los 100 primeros pedidos que salieron
  const orden = [...pedidos].sort((a, b) => a.t - a.ms - (b.t - b.ms));
  const rafaga = orden.slice(0, 100);
  const enRafaga = (e) => rafaga.filter((p) => p.status === e).length;
  esperada("en la rafaga: aprobados", enRafaga(200), capacidad, capacidad);
  esperada("en la rafaga: 422", enRafaga(422), 29, 49);
  esperada("en la rafaga: 403", enRafaga(403), 26, 46);
  esperada("en la rafaga: 503", enRafaga(503), 0, 10);

  const aprobadosPorNodo = {};
  for (const p of pedidos.filter((q) => q.status === 200)) aprobadosPorNodo[p.node ?? "?"] = (aprobadosPorNodo[p.node ?? "?"] ?? 0) + 1;
  extra = { capacidad, aprobadosPorNodo };

  {
    esperada("mediana de un 200 (RTT + 985 ms)", latenciaPorEstado[200]?.mediana ?? null, RTT_MS + 865, RTT_MS + 1105);
    esperada("mediana de un 422 (RTT + 385 ms)", latenciaPorEstado[422]?.mediana ?? null, RTT_MS + 305, RTT_MS + 465);
  }
}

if (escenario === "reintentos") {
  const porClave = new Map();
  for (const p of pedidos) {
    if (!porClave.has(p.key)) porClave.set(p.key, {});
    porClave.get(p.key)[p.intento] = p;
  }
  const pares = [...porClave.values()].filter((par) => par[1] && par[2]);
  const guardadas = pares.filter((par) => par[1].status === 200 || par[1].status === 403);
  const repetidasIguales = guardadas.filter((par) => par[2].status === par[1].status && par[2].id === par[1].id);
  const liberadas = pares.filter((par) => par[1].status === 503 || par[1].status === 502);

  const idsAprobados = new Set(pedidos.filter((p) => p.status === 200).map((p) => p.id));
  const duplicadas = pares.filter((par) => par[1].status === 200 && par[2].status === 200 && par[1].id !== par[2].id);
  const idsRespuestas = new Set(pedidos.filter((p) => [200, 403, 422].includes(p.status)).map((p) => p.id));
  const sinId = pedidos.filter((p) => [200, 403, 422].includes(p.status) && !p.id).length;
  const entradasEsperadas = idsRespuestas.size + n(502, 503);

  exacta("hay 200 usuarios con sus dos respuestas", pares.length === 200, `${pares.length}`);
  exacta("reintentos de un 200 o 403 devuelven la misma respuesta y el mismo id (100 %)", guardadas.length > 0 && repetidasIguales.length === guardadas.length, `${repetidasIguales.length} de ${guardadas.length}`);
  exacta("ningun usuario con dos aprobaciones distintas", duplicadas.length === 0, `${duplicadas.length}`);
  exacta("sin respuestas 409", n(409) === 0, `${n(409)}`);
  exacta("entradas del log con ok:true = aprobaciones distintas", okLog.length === idsAprobados.size && sinId === 0, `${okLog.length} contra ${idsAprobados.size}`);
  exacta("entradas nuevas del log = respuestas distintas + 503", nuevas.length === entradasEsperadas, `${nuevas.length} contra ${entradasEsperadas}`);
  const sumaUsd = okLog.reduce((s, e) => s + e.counterAmount, 0);
  const sumaArs = okLog.reduce((s, e) => s + e.request.baseAmount, 0);
  exacta("saldo de USD varia en -(suma de lo aprobado)", cerca(antes.usd - despues.usd, sumaUsd), `${antes.usd - despues.usd} contra ${sumaUsd}`);
  exacta("saldo de ARS varia en +(suma de lo aprobado)", cerca(despues.ars - antes.ars, sumaArs), `${despues.ars - antes.ars} contra ${sumaArs}`);

  const primeros = pedidos.filter((p) => p.intento === 1);
  const c1 = (e) => primeros.filter((p) => p.status === e).length;
  esperada("primer pedido 200", c1(200), 103, 131);
  esperada("primer pedido 403", c1(403), 60, 84);
  esperada("primer pedido 503", c1(503), 5, 17);
  esperada("usuarios con alguna aprobacion", idsAprobados.size, 110, 138);
  esperada("entradas nuevas del log", nuevas.length, 204, 218);

  const cruzan = pares.filter((par) => par[1].node && par[2].node && par[1].node !== par[2].node).length;
  const nodosDistintos = new Set(pedidos.map((p) => p.node).filter(Boolean)).size;
  if (nodosDistintos > 1) esperada("reintentos que caen en otro nodo", cruzan, 86, 114);
  else exacta("con un solo nodo ningun reintento cruza de nodo", cruzan === 0, `${cruzan}`);

  const repeticiones = repetidasIguales.map((par) => par[2]);
  esperada("mediana del reintento repetido (RTT + 5 ms)", repeticiones.length ? percentil(repeticiones.map((p) => p.ms), 50) : null, RTT_MS, RTT_MS + 60);
  extra = {
    usuarios: pares.length,
    repetidasIguales: repetidasIguales.length,
    liberadasPor503: liberadas.length,
    reintentosQueCruzanDeNodo: cruzan,
    latenciaRepeticion: lat(repeticiones),
  };
}

// ---------------------------------------------------------------- informe

const fallas = comprobaciones.filter((c) => c.tipo === "exacta" && !c.ok);
const fueraDeRango = comprobaciones.filter((c) => c.tipo === "esperada" && !c.ok);
const informe = {
  escenario: nombreCompleto,
  caso,
  entorno: ENTORNO,
  resultado: fallas.length === 0 ? "INVARIANTES OK" : "INVARIANTE ROTA",
  inicioUTC: inicio.toISOString(),
  finUTC: fin.toISOString(),
  nodos: NODOS,
  pedidos: pedidos.length,
  respuestasPorEstado: porEstado,
  pedidosPorNodo: porNodo,
  latenciaPorEstado,
  ...extra,
  comprobaciones,
};
guardar("informe.json", informe);

fs.writeFileSync(
  path.join(extras, "meta.txt"),
  [
    `escenario: ${nombreCompleto}`,
    `caso: ${caso}`,
    `entorno: ${ENTORNO}`,
    `inicio UTC: ${inicio.toISOString()}`,
    `fin UTC: ${fin.toISOString()}`,
    `nodos: ${NODOS.join(", ")}`,
    `commit: ${execSync("git rev-parse HEAD", { cwd: RAIZ }).toString().trim()}`,
    `git status --porcelain (sin perf/results):\n${execSync("git status --porcelain -- . ':!perf/results'", { cwd: RAIZ }).toString().trimEnd() || "(vacio)"}`,
    `artillery: ${execSync(`${path.join(RAIZ, "perf/node_modules/.bin/artillery")} --version`).toString().split("\n").find((l) => /Artillery/.test(l)) ?? "?"}`,
    `node: ${process.version}`,
    `maquina: ${os.hostname()}`,
    `conexion: ${process.env.CONEXION ?? "no informada"}`,
    `RTT base (ms): ${RTT_MS}`,
    `zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ].join("\n") + "\n"
);

console.log(`\n[4/4] ${nombreCompleto} (${caso})`);
console.log(`respuestas: ${JSON.stringify(porEstado)}   por nodo: ${JSON.stringify(porNodo)}`);
for (const c of comprobaciones) {
  const marca = c.ok ? "ok   " : c.tipo === "exacta" ? "FALLA" : "fuera";
  console.log(`  ${marca} [${c.tipo}] ${c.nombre}: ${c.detalle}`);
}
console.log(`\n=> ${informe.resultado}. Invariantes exactas rotas: ${fallas.length}. Valores esperados fuera de rango: ${fueraDeRango.length}.`);
console.log(`Evidencia en ${path.relative(RAIZ, salida)}/ (crudo de Artillery: ${nombreCompleto}.json)`);
process.exit(fallas.length === 0 ? 0 : 1);
