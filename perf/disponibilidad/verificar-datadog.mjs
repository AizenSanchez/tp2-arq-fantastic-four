#!/usr/bin/env node
// Uso: DATADOG_API_KEY=... DD_APP_KEY=... node perf/disponibilidad/verificar-datadog.mjs perf/results/<caso>
// Compara lo que guardo Datadog de una corrida con sus crudos y escribe exchange-disponibilidad/datadog/verificacion.md.
// Los totales de Datadog son conteos agregados cada 10 s (y los del servidor viajan por UDP): se esperan diferencias chicas.
import fs from "node:fs";
import path from "node:path";

const dirCaso = process.argv[2];
const API_KEY = process.env.DATADOG_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;
if (!dirCaso || !API_KEY || !APP_KEY) {
  console.error("uso: DATADOG_API_KEY=... DD_APP_KEY=... node perf/disponibilidad/verificar-datadog.mjs perf/results/<caso>");
  process.exit(2);
}
const API = process.env.DATADOG_API_URL ?? "https://api.us5.datadoghq.com";
const caso = path.basename(dirCaso);
const dir = path.join(dirCaso, "exchange-disponibilidad");
const meta = fs.readFileSync(path.join(dir, "meta.txt"), "utf8");
const desde = Math.floor(Date.parse(meta.match(/inicio UTC: (\S+)/)[1]) / 1000) - 60;
const hasta = Math.ceil(Date.parse(meta.match(/fin UTC: (\S+)/)[1]) / 1000) + 60;

async function total(query) {
  const url = `${API}/api/v1/query?${new URLSearchParams({ from: desde, to: hasta, query })}`;
  const r = await fetch(url, { headers: { "DD-API-KEY": API_KEY, "DD-APPLICATION-KEY": APP_KEY }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} para ${query}`);
  const series = (await r.json()).series ?? [];
  if (!series.length) return null;
  return Math.round(series.flatMap((s) => s.pointlist).reduce((n, [, v]) => n + (v ?? 0), 0));
}

const artillery = JSON.parse(fs.readFileSync(path.join(dirCaso, "exchange-disponibilidad.json"), "utf8")).aggregate.counters;
const pedidos = fs.readFileSync(path.join(dir, "pedidos.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.tipo === "respuesta");
const nodos = [...new Set(pedidos.map((p) => p.nodo).filter(Boolean))].sort();
// sin X-Node (el caso de 1 nodo se corrio antes de agregarlo) todas las respuestas son del unico nodo
const hosts = nodos.length ? nodos : [process.env.DD_HOST ?? "tp2vmss000000"];

const filas = [];
const comparar = async (que, crudo, origen, query) => {
  const dd = await total(query);
  const dif = dd === null || crudo === null ? null : dd - crudo;
  filas.push({ que, crudo, origen, datadog: dd, dif, pct: dif === null || !crudo ? null : Math.round((1000 * dif) / crudo) / 10, query });
};

const TAGS = `caso:${caso},test:exchange-disponibilidad`;
for (const k of Object.keys(artillery).filter((k) => /^http\.codes\.|^errors\./.test(k)).sort()) {
  await comparar(`Artillery ${k}`, artillery[k], "exchange-disponibilidad.json", `sum:artillery.${k}{${TAGS}}.as_count()`);
}
for (const h of hosts) {
  const respondidos = pedidos.filter((p) => (nodos.length ? p.nodo === h : true)).length;
  await comparar(`POST /exchange atendidos por ${h}`, respondidos, nodos.length ? "pedidos.jsonl, por X-Node" : "pedidos.jsonl, total (sin X-Node)", `sum:arvault.exchange.http.POST.exchange.count{host:${h}}.as_count()`);
}

const fila = (c) => `| ${c.map((x) => (x === null || x === undefined ? "—" : x)).join(" | ")} |`;
const md = [
  `# Datadog contra los crudos — ${caso}`,
  "",
  `Generado por \`perf/disponibilidad/verificar-datadog.mjs\` el ${new Date().toISOString()}. Rango: ${new Date(desde * 1000).toISOString()} a ${new Date(hasta * 1000).toISOString()} (la corrida de \`meta.txt\` con 60 s de margen).`,
  "",
  "Datadog agrega cada 10 s y las métricas del servidor viajan por UDP: una diferencia chica es esperable; una grande, no.",
  "",
  fila(["qué", "crudo", "de dónde", "Datadog", "diferencia", "%"]),
  fila(["---", "---", "---", "---", "---", "---"]),
  ...filas.map((f) => fila([f.que, f.crudo, f.origen, f.datadog, f.dif, f.pct])),
  "",
  "Consultas:",
  "",
  ...filas.map((f) => `- ${f.que}: \`${f.query}\``),
  "",
];
fs.mkdirSync(path.join(dir, "datadog"), { recursive: true });
fs.writeFileSync(path.join(dir, "datadog", "verificacion.md"), md.join("\n"));
console.log(md.join("\n"));
