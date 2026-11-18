#!/usr/bin/env node
// Baja de Datadog las series y los graficos de una corrida, en el rango de su meta.txt (con 1 min de margen).
//   DATADOG_API_KEY=... DD_APP_KEY=... node perf/capacidad/capturar-datadog.mjs <caso> <capacidad|endurance>
// Las dos keys solo por entorno (read -s): no se escriben en ningun archivo.
// Deja en perf/results/<caso>/exchange-<corrida>/datadog/: series.json y un PNG por grafico.
//
// Nombres de Artillery: el plugin publish-metrics (artillery-plugin-publish-metrics/lib/datadog.js) publica por API
// con el prefijo "artillery.": los contadores (http.codes.200, errors.*) como count, los resumenes como gauges con
// sufijo (http.response_time.p95, http.response_time.2xx.p95) y las tasas como gauge (http.request_rate).
// Lleva los tags test:exchange-<corrida> y caso:<caso>.
//
// Nodos: DD_HOSTS (lista separada por coma); si no esta, los valores de X-Node que quedaron en pedidos.jsonl (el
// hostname de cada nodo, que es el host de Datadog); si tampoco hay, DD_HOST o tp2vmss000000.
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const [caso, corrida] = process.argv.slice(2);
if (!caso || !["capacidad", "endurance"].includes(corrida)) {
  console.error("uso: node perf/capacidad/capturar-datadog.mjs <caso> <capacidad|endurance>");
  process.exit(2);
}
const API_KEY = process.env.DATADOG_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
if (!API_KEY || !APP_KEY) {
  console.error("faltan DATADOG_API_KEY y/o DD_APP_KEY (exportalas con read -s; no se escriben en ningun archivo)");
  process.exit(2);
}
const API = process.env.DATADOG_API_URL ?? "https://api.us5.datadoghq.com";
const MARGEN_S = 60;

const nombre = `exchange-${corrida}`;
const dir = path.join(RAIZ, "perf/results", caso, nombre);
const meta = fs.existsSync(path.join(dir, "meta.txt")) ? fs.readFileSync(path.join(dir, "meta.txt"), "utf8") : null;
if (!meta) {
  console.error(`no hay ${path.relative(RAIZ, dir)}/meta.txt: la corrida no termino`);
  process.exit(2);
}
const nodosDePedidos = () => {
  const f = path.join(dir, "pedidos.jsonl");
  if (!fs.existsSync(f)) return [];
  const vistos = new Set();
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/"nodo":"([^"]+)"/);
    if (m) vistos.add(m[1]);
  }
  return [...vistos].sort();
};
const HOSTS = process.env.DD_HOSTS
  ? process.env.DD_HOSTS.split(",").map((h) => h.trim()).filter(Boolean)
  : nodosDePedidos().length
    ? nodosDePedidos()
    : [process.env.DD_HOST ?? "tp2vmss000000"];
const desde = Math.floor(Date.parse(meta.match(/^inicio UTC: (\S+)/m)[1]) / 1000) - MARGEN_S;
const hasta = Math.ceil(Date.parse(meta.match(/^fin UTC: (\S+)/m)[1]) / 1000) + MARGEN_S;
const salida = path.join(dir, "datadog");
fs.mkdirSync(salida, { recursive: true });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const avisos = [];
const avisar = (texto) => {
  avisos.push(texto);
  console.error(`AVISO: ${texto}`);
};

// las keys van solo en los headers; ningun mensaje de error las incluye
async function dd(ruta, params) {
  const url = `${API}${ruta}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { "DD-API-KEY": API_KEY, "DD-APPLICATION-KEY": APP_KEY }, signal: AbortSignal.timeout(30000) });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status} ${texto.slice(0, 200)}`);
  return JSON.parse(texto);
}

console.log(`rango: ${new Date(desde * 1000).toISOString()} a ${new Date(hasta * 1000).toISOString()} (corrida con ${MARGEN_S} s de margen), hosts: ${HOSTS.join(", ")}`);

// ------------------------------------------------------------------ 1: metricas de Artillery activas

// /api/v1/metrics devuelve las metricas que reportaron algo desde "from" (no filtra por tag ni tiene "to")
let activas = [];
try {
  activas = ((await dd("/api/v1/metrics", { from: desde })).metrics ?? []).filter((m) => m.startsWith("artillery.")).sort();
} catch (err) {
  avisar(`no se pudo listar las metricas activas: ${err.message}`);
}
console.log(`\nmetricas artillery.* activas desde ${new Date(desde * 1000).toISOString()} (${activas.length}):`);
for (const m of activas) console.log(`  ${m}`);

const TAGS = `caso:${caso},test:${nombre}`;
const primera = (...candidatas) => candidatas.find((m) => activas.includes(m)) ?? null;
const elegidas = {
  tasa: primera("artillery.http.request_rate", "artillery.http.requests"),
  p95: primera("artillery.http.response_time.2xx.p95", "artillery.http.response_time.p95"),
  p99: primera("artillery.http.response_time.2xx.p99", "artillery.http.response_time.p99"),
  codigos: activas.filter((m) => m.startsWith("artillery.http.codes.")),
  errores: activas.filter((m) => m.startsWith("artillery.errors.")),
};
for (const [k, v] of Object.entries(elegidas)) if (v === null || (Array.isArray(v) && !v.length && k === "codigos")) avisar(`no aparece ninguna metrica de Artillery para "${k}"`);
console.log(`\nelegidas (con ${TAGS}): ${JSON.stringify(elegidas, null, 2)}`);

// ------------------------------------------------------------------ 2: series

const esCount = (m) => m.startsWith("artillery.http.codes.") || m.startsWith("artillery.errors.") || m === "artillery.http.requests";
const consulta = (m, alcance) => (esCount(m) ? `sum:${m}{${alcance}}.as_count()` : `avg:${m}{${alcance}}`);
const consultas = [
  ...[elegidas.tasa, elegidas.p95, elegidas.p99, ...elegidas.codigos, ...elegidas.errores].filter(Boolean).map((m) => ({ metrica: m, q: consulta(m, TAGS) })),
  // system.net.bytes_rcvd: si el trafico llega o no a cada nodo (para separar la red de la generadora de los nodos)
  ...HOSTS.flatMap((h) => ["system.cpu.user", "system.cpu.system", "system.mem.used", "system.net.bytes_rcvd"].map((m) => ({ metrica: m, host: h, q: `avg:${m}{host:${h}}` }))),
];
const series = [];
for (const { metrica, host, q } of consultas) {
  try {
    const r = await dd("/api/v1/query", { from: desde, to: hasta, query: q });
    const s = (r.series ?? []).map((x) => ({ scope: x.scope, interval_s: x.interval, unidad: x.unit?.[0]?.name ?? null, puntos: x.pointlist }));
    if (!s.length || s.every((x) => !x.puntos?.length)) avisar(`${metrica}: sin datos para ${q}`);
    series.push({ metrica, ...(host && { host }), query: q, series: s });
    console.log(`  ${metrica}${host ? ` (${host})` : ""}: ${s.reduce((n, x) => n + (x.puntos?.length ?? 0), 0)} puntos`);
  } catch (err) {
    avisar(`${metrica}: ${err.message}`);
    series.push({ metrica, ...(host && { host }), query: q, error: err.message });
  }
}
fs.writeFileSync(
  path.join(salida, "series.json"),
  JSON.stringify({ caso, corrida: nombre, desde: new Date(desde * 1000).toISOString(), hasta: new Date(hasta * 1000).toISOString(), hosts: HOSTS, metricas_artillery_activas: activas, elegidas, series, avisos }, null, 2) + "\n"
);

// ------------------------------------------------------------------ 3: graficos

const graficos = [
  // con un nodo, user y system apilados (como en el caso de 1 nodo); con varios, una serie user + system por nodo
  HOSTS.length === 1
    ? { archivo: "cpu-nodo.png", titulo: `CPU del nodo ${HOSTS[0]} (%)`, qs: [`avg:system.cpu.user{host:${HOSTS[0]}}`, `avg:system.cpu.system{host:${HOSTS[0]}}`], tipo: "area" }
    : { archivo: "cpu-nodo.png", titulo: `CPU por nodo, user + system (%): ${HOSTS.join(", ")}`, qs: HOSTS.map((h) => `avg:system.cpu.user{host:${h}} + avg:system.cpu.system{host:${h}}`), tipo: "line" },
  { archivo: "memoria-nodo.png", titulo: `Memoria usada por nodo: ${HOSTS.join(", ")}`, qs: HOSTS.map((h) => `avg:system.mem.used{host:${h}}`), tipo: "line" },
  { archivo: "red-nodo.png", titulo: `Bytes recibidos por nodo: ${HOSTS.join(", ")}`, qs: HOSTS.map((h) => `avg:system.net.bytes_rcvd{host:${h}}`), tipo: "line" },
  { archivo: "artillery-p95.png", titulo: `Artillery http.response_time p95 / p99 (ms), ${caso}`, qs: [elegidas.p95, elegidas.p99].filter(Boolean).map((m) => consulta(m, TAGS)), tipo: "line" },
  { archivo: "artillery-codigos.png", titulo: `Artillery codigos y errores por intervalo, ${caso}`, qs: [...elegidas.codigos, ...elegidas.errores].map((m) => consulta(m, TAGS)), tipo: "bars" },
];
for (const g of graficos) {
  if (!g.qs.length) {
    avisar(`${g.archivo}: no hay metricas para graficar`);
    continue;
  }
  try {
    const graphDef = { viz: "timeseries", requests: g.qs.map((q) => ({ q, type: g.tipo })) };
    const { snapshot_url } = await dd("/api/v1/graph/snapshot", { start: desde, end: hasta, title: g.titulo, graph_def: JSON.stringify(graphDef) });
    // la imagen se genera en segundo plano: hasta que esta lista, la URL no devuelve un PNG
    let png = null;
    for (let n = 0; n < 30 && !png; n++) {
      await dormir(2000);
      const r = await fetch(snapshot_url, { signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) png = buf;
    }
    if (!png) throw new Error("el snapshot no estuvo listo en 60 s");
    fs.writeFileSync(path.join(salida, g.archivo), png);
    console.log(`  ${g.archivo}: ${png.length} bytes`);
  } catch (err) {
    avisar(`${g.archivo}: ${err.message}`);
  }
}

console.log(`\nlisto: ${path.relative(RAIZ, salida)}/ (${avisos.length} avisos)`);
