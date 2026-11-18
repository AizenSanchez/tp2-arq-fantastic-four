#!/usr/bin/env node
// Uso: node perf/disponibilidad/exportar-probe.mjs perf/results/<caso>
// Azure Monitor tarda unos minutos en tener la ultima parte de la corrida: correr.mjs espera antes de llamarlo.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const dirCaso = process.argv[2];
if (!dirCaso) {
  console.error("uso: node perf/disponibilidad/exportar-probe.mjs perf/results/<caso>");
  process.exit(2);
}
const dir = path.join(dirCaso, "exchange-disponibilidad");
const salida = path.join(dir, "azure-monitor");
fs.mkdirSync(salida, { recursive: true });

const meta = fs.readFileSync(path.join(dir, "meta.txt"), "utf8");
const MARGEN = 2 * 60 * 1000;
const desde = new Date(Date.parse(meta.match(/inicio UTC: (\S+)/)[1]) - MARGEN).toISOString();
const hasta = new Date(Date.parse(meta.match(/fin UTC: (\S+)/)[1]) + MARGEN).toISOString();
const GRUPO = process.env.AZURE_GRUPO ?? "tp2_resource_group";

const az = (...a) => execFileSync("az", a, { encoding: "utf8" });
// sin ids ni suscripcion, como las exportaciones del bloque 1
const limpiar = (x) =>
  Array.isArray(x) ? x.map(limpiar) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "id").map(([k, v]) => [k, limpiar(v)])) : x;
const sinSuscripcion = (texto) => texto.replace(/subscriptions\/[0-9a-f-]{36}/gi, "subscriptions/<suscripcion>");

const lb = az("network", "lb", "show", "-g", GRUPO, "-n", "tp2_lb", "--query", "id", "-o", "tsv").trim();
const json = az("monitor", "metrics", "list", "--resource", lb, "--metric", "DipAvailability", "--dimension", "BackendIPAddress",
  "--aggregation", "Average", "--interval", "PT1M", "--start-time", desde, "--end-time", hasta, "-o", "json");
fs.writeFileSync(path.join(salida, "lb-probe-dipavailability.json"), sinSuscripcion(JSON.stringify(limpiar(JSON.parse(json)), null, 2)) + "\n");

const nodos = execFileSync("ansible", ["-i", "vmss_hosts", "all", "-u", "azureuser", "--private-key", "../key.pem", "-m", "shell", "-a", "echo $(hostname) $(hostname -I | cut -d' ' -f1)"],
  { cwd: path.join(RAIZ, "ansible"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  .split("\n").filter((l) => /^tp2vmss/.test(l)).sort();

fs.writeFileSync(
  path.join(salida, "LEEME.txt"),
  [
    `rango: ${desde} a ${hasta} (la corrida, con 2 min antes y despues), grano 1 min`,
    "lb: Microsoft.Network/loadBalancers tp2_lb, metrica DipAvailability (estado del probe por nodo, % de probes exitosos), dimension BackendIPAddress",
    `nodos (hostname e IP privada, consultado el ${new Date().toISOString()}):`,
    ...nodos.map((n) => `  ${n}`),
    `para volver a exportar: az monitor metrics list --resource <id del lb> --metric DipAvailability --dimension BackendIPAddress --aggregation Average --interval PT1M --start-time ${desde} --end-time ${hasta}`,
  ].join("\n") + "\n"
);
console.log(`estado del probe exportado en ${salida}`);
