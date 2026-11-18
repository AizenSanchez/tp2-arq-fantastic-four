#!/usr/bin/env node
// Baja de Datadog las series y los graficos de una corrida de un escenario (E7, E8, E10), con 1 min de margen.
//   DATADOG_API_KEY=... DD_APP_KEY=... node perf/tacticas-nginx/capturar-datadog.mjs <carpeta de resultados> <tag test> <inicio UTC> <fin UTC>
// Ej.: node perf/tacticas-nginx/capturar-datadog.mjs perf/results/prueba-e10 exchange-lectura-tasas 2026-11-18T01:30:00Z 2026-11-18T01:33:00Z
// Las keys solo por entorno: no se escriben en ningun archivo. Deja en <carpeta>/datadog/ series.json y un PNG por grafico.
// Con mas de un nodo: DD_HOST=tp2vmss000001 elige el nodo y DD_SALIDA=datadog-nodo-1 la subcarpeta.
// Mismo metodo que perf/capacidad/capturar-datadog.mjs del bloque 1, con los graficos que miran las tacticas de nginx:
// latencia por endpoint en el cliente y en la app, conntrack del nodo y ARCA.
import fs from "node:fs";
import path from "node:path";

const [carpeta, test, inicio, fin] = process.argv.slice(2);
if (!carpeta || !test || !inicio || !fin || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fin))) {
  console.error("uso: node perf/tacticas-nginx/capturar-datadog.mjs <carpeta de resultados> <tag test> <inicio UTC> <fin UTC>");
  process.exit(2);
}
const API_KEY = process.env.DATADOG_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
if (!API_KEY || !APP_KEY) {
  console.error("faltan DATADOG_API_KEY y/o DD_APP_KEY (por entorno; no se escriben en ningun archivo)");
  process.exit(2);
}
const API = process.env.DATADOG_API_URL ?? "https://api.us5.datadoghq.com";
const HOST = process.env.DD_HOST ?? "tp2vmss000000";
const MARGEN_S = 60;
const desde = Math.floor(Date.parse(inicio) / 1000) - MARGEN_S;
const hasta = Math.ceil(Date.parse(fin) / 1000) + MARGEN_S;
const salida = path.join(carpeta, process.env.DD_SALIDA ?? "datadog");
fs.mkdirSync(salida, { recursive: true });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const avisos = [];
const avisar = (texto) => {
  avisos.push(texto);
  console.error(`AVISO: ${texto}`);
};

// las keys van solo en los headers; ningun mensaje de error las incluye
async function dd(ruta, params) {
  const r = await fetch(`${API}${ruta}?${new URLSearchParams(params)}`, {
    headers: { "DD-API-KEY": API_KEY, "DD-APPLICATION-KEY": APP_KEY },
    signal: AbortSignal.timeout(30000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status} ${texto.slice(0, 200)}`);
  return JSON.parse(texto);
}

console.log(`rango: ${new Date(desde * 1000).toISOString()} a ${new Date(hasta * 1000).toISOString()} (con ${MARGEN_S} s de margen)`);

// /api/v1/metrics lista lo que reporto algo desde "from" (no filtra por tag): se queda con lo de Artillery
let activas = [];
try {
  activas = ((await dd("/api/v1/metrics", { from: desde })).metrics ?? []).filter((m) => m.startsWith("artillery.")).sort();
} catch (err) {
  avisar(`no se pudo listar las metricas activas: ${err.message}`);
}
const T = `test:${test}`;
const H = `host:${HOST}`;
const cuenta = (m, alcance) => `sum:${m}{${alcance}}.as_count()`;
const codigos = activas.filter((m) => /^artillery\.(http\.codes\.|errors\.)/.test(m)).map((m) => cuenta(m, T));
const endpoints = ["rates", "exchange", "accounts"].filter((e) => activas.includes(`artillery.plugins.metrics_by_endpoint.response_time.${e}.p95`));
const latCliente = endpoints.length
  ? endpoints.map((e) => `avg:artillery.plugins.metrics_by_endpoint.response_time.${e}.p95{${T}}`)
  : [`avg:artillery.http.response_time.p95{${T}}`];

const graficos = [
  { archivo: "cpu-nodo.png", titulo: `CPU del nodo ${HOST} (%): user, system y steal`, qs: ["user", "system", "stolen"].map((c) => `avg:system.cpu.${c}{${H}}`), tipo: "area" },
  { archivo: "conntrack-nodo.png", titulo: `Conntrack del nodo ${HOST}: entradas y maximo`, qs: [`max:system.net.conntrack.count{${H}}`, `max:system.net.conntrack.max{${H}}`], tipo: "line" },
  { archivo: "artillery-codigos.png", titulo: `Artillery: codigos y errores por intervalo, ${test}`, qs: codigos, tipo: "bars" },
  { archivo: "artillery-p95.png", titulo: `Artillery: p95 por endpoint en el cliente (ms), ${test}`, qs: latCliente, tipo: "line" },
  {
    archivo: "app-latencia.png",
    titulo: `App: mediana y p95 por endpoint en el servidor (ms), ${HOST}`,
    qs: ["GET.rates", "GET.accounts", "POST.exchange"].flatMap((e) => ["median", "95percentile"].map((s) => `avg:arvault.exchange.http.${e}.${s}{${H}}`)),
    tipo: "line",
  },
  {
    archivo: "arca.png",
    titulo: `ARCA desde la app: p95 (ms) y errores por motivo, ${HOST}`,
    qs: [`avg:arvault.exchange.arca.ms.95percentile{${H}}`, ...["timeout", "conexion", "http_5xx", "http_4xx"].map((m) => cuenta(`arvault.exchange.arca.errores.${m}`, H))],
    tipo: "line",
  },
];

const series = [];
for (const q of [...new Set(graficos.flatMap((g) => g.qs))]) {
  try {
    const r = await dd("/api/v1/query", { from: desde, to: hasta, query: q });
    const s = (r.series ?? []).map((x) => ({ scope: x.scope, interval_s: x.interval, unidad: x.unit?.[0]?.name ?? null, puntos: x.pointlist }));
    if (!s.length) avisar(`sin datos para ${q}`);
    series.push({ query: q, series: s });
  } catch (err) {
    avisar(`${q}: ${err.message}`);
    series.push({ query: q, error: err.message });
  }
}
fs.writeFileSync(
  path.join(salida, "series.json"),
  JSON.stringify({ test, host: HOST, desde: new Date(desde * 1000).toISOString(), hasta: new Date(hasta * 1000).toISOString(), metricas_artillery_activas: activas, series, avisos }, null, 2) + "\n"
);
console.log(`series.json: ${series.length} consultas`);

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
    console.log(`${g.archivo}: ${png.length} bytes`);
  } catch (err) {
    avisar(`${g.archivo}: ${err.message}`);
  }
}
console.log(`listo: ${salida}/ (${avisos.length} avisos)`);
