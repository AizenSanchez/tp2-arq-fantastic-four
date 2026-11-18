#!/usr/bin/env node
// Exporta de Azure Monitor las metricas de Redis, ARCA y el balanceador en el rango de una corrida (meta.txt, con
// 2 min antes y despues, grano 1 min) a perf/results/<caso>/exchange-<corrida>/azure-monitor/.
//   node perf/capacidad/exportar-azure-monitor.mjs <caso> <capacidad|endurance>
// Lo llama correr.mjs al final de cada corrida en Azure (despues de esperar a que Azure Monitor publique), y sirve
// para volver a exportar mientras la infra exista. Solo lee: az resource list y az monitor metrics list.
//
// Redis administrado y ACI no tienen agente de Datadog. Nombres verificados con az monitor metrics list-definitions.
// CpuUsage de ACI esta en milicores (0,5 vCPU = 500). Las dimensiones van con --filter "<dim> eq '*'": con
// --dimension, SYNCount, ByteCount y PacketCount vuelven vacias.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const [caso, corrida] = process.argv.slice(2);
if (!caso || !["capacidad", "endurance"].includes(corrida)) {
  console.error("uso: node perf/capacidad/exportar-azure-monitor.mjs <caso> <capacidad|endurance>");
  process.exit(2);
}
const dir = path.join(RAIZ, "perf/results", caso, `exchange-${corrida}`);
const meta = fs.readFileSync(path.join(dir, "meta.txt"), "utf8");
const MARGEN_MS = 2 * 60000;
const desde = new Date(Date.parse(meta.match(/^inicio UTC: (\S+)/m)[1]) - MARGEN_MS).toISOString();
const hasta = new Date(Date.parse(meta.match(/^fin UTC: (\S+)/m)[1]) + MARGEN_MS).toISOString();
const GRUPO = process.env.AZURE_GRUPO ?? "tp2_resource_group";

const AZURE_MONITOR = [
  { recurso: "redis", tipo: "Microsoft.Cache/redisEnterprise", metricas: ["usedmemory", "operationsPerSecond", "percentProcessorTime"], agregaciones: ["Maximum", "Average"] },
  { recurso: "arca", tipo: "Microsoft.ContainerInstance/containerGroups", metricas: ["CpuUsage", "MemoryUsage"], agregaciones: ["Average", "Maximum"] },
  // balanceador: estado del probe por nodo (como exportar-probe.mjs del bloque 3) y trafico de su frontend por
  // direccion, para saber si los pedidos que vencen por timeout llegaron a Azure o se perdieron antes
  { recurso: "lb-probe", tipo: "Microsoft.Network/loadBalancers", metricas: ["DipAvailability"], agregaciones: ["Average"], dimension: "BackendIPAddress" },
  { recurso: "lb-trafico", tipo: "Microsoft.Network/loadBalancers", metricas: ["SYNCount", "ByteCount", "PacketCount"], agregaciones: ["Total"], dimension: "Direction" },
];

// los ids de Azure llevan el id de la suscripcion: no se guardan
const SUSCRIPCION = /subscriptions\/[0-9a-f-]{36}/gi;
const sinIds = (texto) => {
  const limpiar = (x) =>
    Array.isArray(x) ? x.map(limpiar) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "id").map(([k, v]) => [k, limpiar(v)])) : x;
  return JSON.stringify(limpiar(JSON.parse(texto)), null, 2).replace(SUSCRIPCION, "subscriptions/<suscripcion>");
};

const salida = path.join(dir, "azure-monitor");
fs.mkdirSync(salida, { recursive: true });
const az = (...a) => execFileSync("az", a, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let fallas = 0;
for (const m of AZURE_MONITOR) {
  fs.rmSync(path.join(salida, `${m.recurso}.error.txt`), { force: true });
  try {
    const id = az("resource", "list", "-g", GRUPO, "--resource-type", m.tipo, "--query", "[0].id", "-o", "tsv");
    if (!id) throw new Error(`no hay ningun ${m.tipo} en ${GRUPO}`);
    const filtro = m.dimension ? ["--filter", `${m.dimension} eq '*'`] : [];
    // a veces Azure Monitor devuelve una metrica sin series aunque tenga datos: se reintenta antes de aceptarlo
    let json;
    let vacias = [];
    for (let intento = 1; intento <= 3; intento++) {
      json = az("monitor", "metrics", "list", "--resource", id, "--metrics", ...m.metricas, ...filtro, "--aggregation", ...m.agregaciones, "--interval", "PT1M", "--start-time", desde, "--end-time", hasta, "-o", "json");
      vacias = JSON.parse(json).value.filter((v) => !v.timeseries?.length).map((v) => v.name.value);
      if (!vacias.length) break;
      if (intento < 3) execFileSync("sleep", ["10"]);
    }
    fs.writeFileSync(path.join(salida, `${m.recurso}.json`), sinIds(json) + "\n");
    console.log(`  ${m.recurso}: ${m.metricas.join(", ")}${vacias.length ? ` (AVISO: sin series: ${vacias.join(", ")})` : ""}`);
  } catch (err) {
    fallas++;
    const detalle = String(err.stderr || err.message).trim().slice(0, 500);
    fs.writeFileSync(path.join(salida, `${m.recurso}.error.txt`), detalle.replace(SUSCRIPCION, "subscriptions/<suscripcion>") + "\n");
    console.error(`  ${m.recurso}: no se pudo exportar (${detalle.split("\n")[0]})`);
  }
}
fs.writeFileSync(
  path.join(salida, "LEEME.txt"),
  [
    `rango: ${desde} a ${hasta} (la corrida, con 2 min antes y despues), grano 1 min; exportado el ${new Date().toISOString()}`,
    ...AZURE_MONITOR.map((m) => `${m.recurso}: ${m.tipo}, metricas ${m.metricas.join(", ")}, agregaciones ${m.agregaciones.join(", ")}${m.dimension ? `, separado por ${m.dimension}` : ""}`),
    "CpuUsage de ACI esta en milicores (0,5 vCPU = 500). usedmemory y MemoryUsage en bytes.",
    "DipAvailability: % de probes exitosos por nodo (BackendIPAddress). SYNCount, ByteCount y PacketCount: totales por minuto en el frontend del balanceador, separados por Direction (In = entrante, Out = saliente).",
    "Las marcas de tiempo de Azure Monitor pueden ir corridas 1 a 2 min respecto de la carga: comparar con meta.txt y Datadog.",
    `para volver a exportar (mientras exista la infra): node perf/capacidad/exportar-azure-monitor.mjs ${caso} ${corrida}`,
  ].join("\n") + "\n"
);
process.exit(fallas ? 1 : 0);
