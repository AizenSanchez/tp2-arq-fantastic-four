// Lo que hace falta medir y guardar cuando la corrida es en Azure: RTT de base, salidas de terraform y metricas de
// Azure Monitor de Redis y ARCA (que no tienen agente de Datadog).
// Es el mismo metodo que usa perf/capacidad (bloque 1), que ya se probo contra Azure; los nombres de las metricas
// se verificaron alli con `az monitor metrics list-definitions`. Se copia y no se importa porque esa rama todavia no esta en main.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => Math.round(x * 10) / 10;
const percentil = (v, p) => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)] : null);

// GET / no toca ARCA ni Redis: es la ida y vuelta de red mas el costo minimo de express. Se mide de dos formas:
// - reutilizada: conexion keep-alive ya abierta (1 RTT).
// - nueva: una conexion TCP por pedido (handshake + pedido, ~2 RTT). Es lo que le suma la red a cada pedido de estos
//   escenarios, porque cada usuario virtual abre su propia conexion (y el primer reintento usa Connection: close).
//   Por eso la mediana de esta es el "RTT" de las predicciones.
export async function medirRtt(base, muestras = 20) {
  const getRaiz = (agent) =>
    new Promise((resolve, reject) => {
      const t = performance.now();
      let tConnect = null;
      const req = http.get(`${base}/`, { agent, timeout: 5000 }, (res) => {
        res.resume();
        res.on("end", () => resolve({ ms: r1(performance.now() - t), connect_ms: tConnect === null ? null : r1(tConnect - t) }));
      });
      req.on("socket", (s) => s.connecting && s.once("connect", () => (tConnect = performance.now())));
      req.on("timeout", () => req.destroy(new Error("timeout de GET /")));
      req.on("error", reject);
    });
  const serie = (m) => ({ n: m.length, p50_ms: percentil(m, 50), p95_ms: percentil(m, 95), muestras_ms: m });

  const agente = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await getRaiz(agente); // abre la conexion, no cuenta
  const reutilizada = [];
  for (let n = 0; n < muestras; n++) reutilizada.push((await getRaiz(agente)).ms);
  agente.destroy();
  const nueva = [];
  const connect = [];
  for (let n = 0; n < muestras; n++) {
    const m = await getRaiz(false); // agent: false = conexion nueva y Connection: close
    nueva.push(m.ms);
    if (m.connect_ms !== null) connect.push(m.connect_ms);
  }
  return { target: base, reutilizada: serie(reutilizada), nueva: { ...serie(nueva), connect_p50_ms: percentil(connect, 50) } };
}

const sh = (raiz, comando) => {
  try {
    return execSync(comando, { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "?";
  }
};

// solo estas salidas: el resto del estado de terraform puede tener secretos
export function lineasDeAzureParaMeta(raiz, grupo = "tp2_resource_group") {
  const lineas = [];
  for (const o of ["vmss_instances", "vmss_sku", "redis_sku"]) lineas.push(`terraform output ${o}: ${sh(raiz, `terraform output -json ${o}`)}`);
  lineas.push(`region: ${sh(raiz, `az group show -n ${grupo} --query location -o tsv`)}`);
  return lineas;
}

// evidencia/capturar-infra.sh guarda terraform state list, terraform output y az vmss list-instances en evidencia/<caso>/
export function capturarInfra(raiz, caso) {
  try {
    execFileSync(path.join(raiz, "evidencia/capturar-infra.sh"), [caso], { cwd: raiz, stdio: "inherit" });
    return true;
  } catch (err) {
    console.error(`AVISO: no se pudo capturar la infra (${err.message.split("\n")[0]}). Correr a mano: evidencia/capturar-infra.sh ${caso}`);
    return false;
  }
}

// Redis administrado y ACI no tienen agente de Datadog: sus metricas salen de Azure Monitor (grano minimo 1 min).
// CpuUsage de ACI esta en milicores (0,5 vCPU = 500).
const AZURE_MONITOR = [
  { recurso: "redis", tipo: "Microsoft.Cache/redisEnterprise", metricas: ["usedmemory", "operationsPerSecond", "percentProcessorTime"], agregaciones: ["Maximum", "Average"] },
  { recurso: "arca", tipo: "Microsoft.ContainerInstance/containerGroups", metricas: ["CpuUsage", "MemoryUsage"], agregaciones: ["Average", "Maximum"] },
];

// los ids de Azure llevan el id de la suscripcion: no se guardan
const sinIds = (texto) => {
  const limpiar = (x) =>
    Array.isArray(x) ? x.map(limpiar) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "id").map(([k, v]) => [k, limpiar(v)])) : x;
  return JSON.stringify(limpiar(JSON.parse(texto)), null, 2).replace(/subscriptions\/[0-9a-f-]{36}/gi, "subscriptions/<suscripcion>");
};

export async function exportarAzureMonitor({ raiz, dir, inicio, fin }) {
  // Azure Monitor publica con 1 a 3 min de demora: sin esperar, faltan los ultimos minutos
  const espera = Number(process.env.AZURE_MONITOR_ESPERA_S ?? 180);
  const grupo = process.env.AZURE_GRUPO ?? "tp2_resource_group";
  const desde = new Date(inicio.getTime() - 2 * 60000).toISOString();
  const hasta = new Date(fin.getTime() + 2 * 60000).toISOString();
  console.log(`      Azure Monitor (Redis y ARCA) de ${desde} a ${hasta}, despues de esperar ${espera} s a que se publiquen`);
  await dormir(espera * 1000);
  fs.mkdirSync(dir, { recursive: true });
  const az = (...a) => execFileSync("az", a, { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  for (const m of AZURE_MONITOR) {
    try {
      const id = az("resource", "list", "-g", grupo, "--resource-type", m.tipo, "--query", "[0].id", "-o", "tsv");
      if (!id) throw new Error(`no hay ningun ${m.tipo} en ${grupo}`);
      const json = az("monitor", "metrics", "list", "--resource", id, "--metrics", ...m.metricas, "--aggregation", ...m.agregaciones, "--interval", "PT1M", "--start-time", desde, "--end-time", hasta, "-o", "json");
      fs.writeFileSync(path.join(dir, `${m.recurso}.json`), sinIds(json) + "\n");
      console.log(`      ${m.recurso}: ${m.metricas.join(", ")}`);
    } catch (err) {
      const detalle = String(err.stderr || err.message).trim().slice(0, 500);
      fs.writeFileSync(path.join(dir, `${m.recurso}.error.txt`), detalle.replace(/subscriptions\/[0-9a-f-]{36}/gi, "subscriptions/<suscripcion>") + "\n");
      console.error(`      ${m.recurso}: no se pudo exportar (${detalle.split("\n")[0]})`);
    }
  }
  fs.writeFileSync(
    path.join(dir, "LEEME.txt"),
    [
      `rango: ${desde} a ${hasta} (la corrida, con 2 min antes y despues), grano 1 min`,
      ...AZURE_MONITOR.map((m) => `${m.recurso}: ${m.tipo}, metricas ${m.metricas.join(", ")}, agregaciones ${m.agregaciones.join(", ")}`),
      "CpuUsage de ACI esta en milicores (0,5 vCPU = 500). usedmemory y MemoryUsage en bytes.",
      `para volver a exportar: az monitor metrics list --resource <id> --metrics ... --interval PT1M --start-time ${desde} --end-time ${hasta}`,
    ].join("\n") + "\n"
  );
}
