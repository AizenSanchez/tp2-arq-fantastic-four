#!/usr/bin/env node
// Reparto de pedidos entre los nodos del VMSS en una corrida, contado por la app en cada nodo (Datadog).
//   DATADOG_API_KEY=... DD_APP_KEY=... node perf/tacticas-nginx/datadog-reparto.mjs <inicio UTC> <fin UTC> [host ...]
// Cuenta, por host, los pedidos de cada ruta que mide la app (timers http.<METODO>.<ruta>, su .count) en el rango.
// Las keys solo por entorno: no se escriben en ningun archivo. Imprime una tabla markdown.
const [inicio, fin, ...hostsArg] = process.argv.slice(2);
if (!inicio || !fin || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fin))) {
  console.error("uso: node perf/tacticas-nginx/datadog-reparto.mjs <inicio UTC> <fin UTC> [host ...]");
  process.exit(2);
}
const API = process.env.DATADOG_API_URL ?? "https://api.us5.datadoghq.com";
const hosts = hostsArg.length ? hostsArg : ["tp2vmss000000", "tp2vmss000001"];
const rutas = ["GET.rates", "GET.accounts", "POST.exchange"];
const desde = Math.floor(Date.parse(inicio) / 1000);
const hasta = Math.ceil(Date.parse(fin) / 1000);

async function contar(ruta, host) {
  const q = `sum:arvault.exchange.http.${ruta}.count{host:${host}}.as_count()`;
  const url = `${API}/api/v1/query?from=${desde}&to=${hasta}&query=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "DD-API-KEY": process.env.DATADOG_API_KEY, "DD-APPLICATION-KEY": process.env.DD_APP_KEY } });
  if (!r.ok) throw new Error(`${r.status} en ${q}`);
  const j = await r.json();
  return (j.series ?? []).reduce((t, s) => t + s.pointlist.reduce((u, p) => u + (p[1] ?? 0), 0), 0);
}

const filas = [];
for (const ruta of rutas) {
  const n = [];
  for (const h of hosts) n.push(await contar(ruta, h));
  const total = n.reduce((a, b) => a + b, 0);
  if (total) filas.push(`| ${ruta} | ${n.map((x) => `${Math.round(x)} (${((100 * x) / total).toFixed(1)} %)`).join(" | ")} | ${Math.round(total)} |`);
}
console.log(`| Ruta | ${hosts.join(" | ")} | Total |`);
console.log(`|---|${hosts.map(() => "---|").join("")}---|`);
console.log(filas.join("\n"));
