#!/usr/bin/env node
// Uso: perf/disponibilidad/README.md
import fs from "node:fs";

const SITE = (process.env.DD_SITE ?? "us5.datadoghq.com").replace(/^app\./, "");
const API = `https://api.${SITE}`;
const WEB = SITE === "datadoghq.com" ? "https://app.datadoghq.com" : `https://${SITE}`;

for (const k of ["DD_API_KEY", "DD_APP_KEY"]) {
  if (!process.env[k]) {
    console.error(`falta ${k}: read -s ${k}; export ${k}`);
    process.exit(2);
  }
}

async function dd(metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", "DD-API-KEY": process.env.DD_API_KEY, "DD-APPLICATION-KEY": process.env.DD_APP_KEY },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${ruta}: HTTP ${r.status} ${texto.slice(0, 500)}`);
  return texto ? JSON.parse(texto) : {};
}

const args = process.argv.slice(2);

if (args[0] === "--metricas") {
  const prefijo = args[1] ?? "";
  const desde = Math.floor(Date.now() / 1000) - 3600;
  const { metrics = [] } = await dd("GET", `/api/v1/metrics?from=${desde}`);
  const lista = metrics.filter((m) => m.startsWith(prefijo)).sort();
  console.log(lista.length ? lista.join("\n") : `ninguna metrica con prefijo "${prefijo}" en la ultima hora`);
  process.exit(0);
}

if (!args[0]) {
  console.error("uso: node perf/datadog/crear-dashboard.mjs <dashboard.json> | --metricas <prefijo>");
  process.exit(2);
}

const dashboard = JSON.parse(fs.readFileSync(args[0], "utf8"));
const { dashboards = [] } = await dd("GET", "/api/v1/dashboard");
const existente = dashboards.find((d) => d.title === dashboard.title);
const r = existente ? await dd("PUT", `/api/v1/dashboard/${existente.id}`, dashboard) : await dd("POST", "/api/v1/dashboard", dashboard);
console.log(`${existente ? "actualizado" : "creado"}: ${WEB}${r.url}`);
