#!/usr/bin/env node
// Uso, fases y archivos de salida: perf/capacidad/README.md
//   node perf/capacidad/correr.mjs <capacidad|endurance> <caso> [--env local|azure]
import { spawn, execFile, execFileSync, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const AQUI = import.meta.dirname;
const RAIZ = path.resolve(AQUI, "../..");

const args = process.argv.slice(2);
const i = args.indexOf("--env");
const ENTORNO = i >= 0 ? args.splice(i, 2)[1] : "local";
const [corrida, caso] = args;
if (!["capacidad", "endurance"].includes(corrida) || !caso || !["local", "azure"].includes(ENTORNO)) {
  console.error("uso: node perf/capacidad/correr.mjs <capacidad|endurance> <caso> [--env local|azure]");
  process.exit(2);
}

const num = (nombre, defecto) => {
  const v = process.env[nombre] ?? defecto;
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${nombre} tiene que ser un numero positivo (vale "${v}")`);
    process.exit(2);
  }
  return n;
};

// las fases van en meta.txt: analizar.mjs las lee de ahi
let FASES;
if (corrida === "capacidad") {
  const escalones = (process.env.ESCALONES ?? "10,20,40,80,120,160,240,320,480,640").split(",").map((s) => Number(s.trim()));
  if (!escalones.length || escalones.some((r) => !Number.isFinite(r) || r <= 0)) {
    console.error(`ESCALONES tiene que ser una lista de tasas separadas por coma (vale "${process.env.ESCALONES}")`);
    process.exit(2);
  }
  const dur = num("DURACION_ESCALON", 60);
  FASES = [
    ...escalones.map((rate) => ({ nombre: `escalon-${rate}`, tipo: "escalon", rate, duracion: dur })),
    { nombre: `bajada-${num("BAJADA", 20)}`, tipo: "bajada", rate: num("BAJADA", 20), duracion: num("DURACION_BAJADA", 120) },
  ];
} else {
  const rateEndurance = num("RATE_ENDURANCE");
  const rateTramo = num("RATE_TRAMO");
  if (rateEndurance === undefined || rateTramo === undefined) {
    console.error("faltan RATE_ENDURANCE y/o RATE_TRAMO: dependen del B medido en la corrida de capacidad");
    console.error("(RATE_ENDURANCE ~ 0,5 x B y RATE_TRAMO ~ B, en pedidos/s)");
    process.exit(2);
  }
  FASES = [
    { nombre: `endurance-${rateEndurance}`, tipo: "endurance", rate: rateEndurance, duracion: num("DURACION_ENDURANCE", 600) },
    { nombre: `tramo-${rateTramo}`, tipo: "tramo", rate: rateTramo, duracion: num("DURACION_TRAMO", 180) },
  ];
}
const DURACION_TOTAL = FASES.reduce((s, f) => s + f.duracion, 0);

const nombre = `exchange-${corrida}`;
const salida = path.join(RAIZ, "perf/results", caso, nombre);
fs.mkdirSync(salida, { recursive: true });
const archivo = (n) => path.join(salida, n);
for (const f of ["pedidos.jsonl", "recursos.jsonl", "rtt.json", "meta.txt", "resumen.md", "resumen.json"]) fs.rmSync(archivo(f), { force: true });
const anotar = (n, linea) => fs.appendFileSync(archivo(n), JSON.stringify(linea) + "\n");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE =
  process.env.TARGET ??
  (ENTORNO === "azure" ? `http://${fs.readFileSync(path.join(RAIZ, "node/lb_dns"), "utf8").trim()}` : "http://localhost:3000");
const DATADOG_API_HOST = process.env.DATADOG_API_HOST ?? "us5.datadoghq.com";

if (ENTORNO === "azure" && !process.env.DATADOG_API_KEY) {
  console.error("falta DATADOG_API_KEY (exportala con read -s; no se escribe en ningun archivo)");
  process.exit(2);
}

async function esperarSalud() {
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })).status === 200) return;
    } catch {}
    await dormir(1000);
  }
  throw new Error(`${BASE}/health no responde 200`);
}

const percentil = (v, p) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};

// ------------------------------------------------------------------ 1: reinicio del estado

const resetCmd = process.env.RESET_CMD ?? (ENTORNO === "local" ? "docker compose -f docker-compose.local.yml exec -T app node tools/reset-state.js" : "ansible/reset.sh");
console.log(`[1/5] reinicio del estado: ${resetCmd}`);
execSync(resetCmd, { cwd: RAIZ, stdio: "inherit" });
await esperarSalud();

// ------------------------------------------------------------------ 2: RTT de base

// GET / no toca ARCA ni Redis: es la ida y vuelta de red mas el costo minimo de express. Se mide de dos formas:
// - reutilizada: conexion keep-alive ya abierta (1 RTT). Es lo que agrega la red al http.response_time de
//   Artillery/Datadog, que es la fase firstByte de got: desde que termino de salir el pedido hasta el primer byte.
// - nueva: una conexion TCP por pedido, como hace Artillery (cada usuario virtual tiene su agente y hace un solo
//   pedido). Es lo que agrega la red a la latencia de pedidos.jsonl (handshake + pedido, ~2 RTT).
const r1 = (x) => Math.round(x * 10) / 10;
function getRaiz(agent) {
  return new Promise((resolve, reject) => {
    const t = performance.now();
    let tConnect = null;
    const req = http.get(`${BASE}/`, { agent, timeout: 5000 }, (res) => {
      res.resume();
      res.on("end", () => resolve({ ms: r1(performance.now() - t), connect_ms: tConnect === null ? null : r1(tConnect - t) }));
    });
    req.on("socket", (s) => s.connecting && s.once("connect", () => (tConnect = performance.now())));
    req.on("timeout", () => req.destroy(new Error("timeout de GET /")));
    req.on("error", reject);
  });
}
const N_RTT = 20;
const serie = (muestras) => ({ n: muestras.length, p50_ms: percentil(muestras, 50), p95_ms: percentil(muestras, 95), muestras_ms: muestras });
console.log(`[2/5] RTT de base: ${N_RTT} x GET / con la conexion reutilizada y ${N_RTT} con conexion nueva`);
const agenteKeepAlive = new http.Agent({ keepAlive: true, maxSockets: 1 });
await getRaiz(agenteKeepAlive); // abre la conexion, no cuenta
const reutilizada = [];
for (let n = 0; n < N_RTT; n++) reutilizada.push((await getRaiz(agenteKeepAlive)).ms);
agenteKeepAlive.destroy();
const nueva = [];
const connect = [];
for (let n = 0; n < N_RTT; n++) {
  const m = await getRaiz(false); // agent: false = conexion nueva y Connection: close
  nueva.push(m.ms);
  if (m.connect_ms !== null) connect.push(m.connect_ms);
}
const rtt = {
  target: BASE,
  // p50_ms y p95_ms de arriba son los de la conexion reutilizada (1 RTT)
  p50_ms: percentil(reutilizada, 50),
  p95_ms: percentil(reutilizada, 95),
  reutilizada: serie(reutilizada),
  nueva: { ...serie(nueva), connect_p50_ms: percentil(connect, 50) },
};
fs.writeFileSync(archivo("rtt.json"), JSON.stringify(rtt, null, 2) + "\n");
console.log(`      reutilizada: p50 ${rtt.reutilizada.p50_ms} ms, p95 ${rtt.reutilizada.p95_ms} ms`);
console.log(`      nueva:       p50 ${rtt.nueva.p50_ms} ms, p95 ${rtt.nueva.p95_ms} ms (connect p50 ${rtt.nueva.connect_p50_ms} ms)`);

// ------------------------------------------------------------------ 3: monitor de recursos (solo local)

// en azure lo cubre Datadog: solo se anotan las horas UTC para recortar el dashboard
const execFileAsync = promisify(execFile);
let monitoreando = ENTORNO === "local";
let monitor = Promise.resolve();
if (monitoreando) {
  console.log("[3/5] monitor de recursos: docker stats de app, redis y arca cada 1 s");
  const servicios = Object.fromEntries(
    execFileSync("docker", ["compose", "-f", "docker-compose.local.yml", "ps", "--format", "{{.Name}}\t{{.Service}}"], { cwd: RAIZ, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"))
  );
  const nombres = Object.keys(servicios).filter((n) => ["app", "redis", "arca"].includes(servicios[n]));
  const aMiB = (s) => {
    const m = s.match(/([\d.]+)\s*([KMG]i?B|B)/);
    if (!m) return null;
    const f = { B: 1 / 1048576, KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[m[2]];
    return Math.round(Number(m[1]) * f * 10) / 10;
  };
  monitor = (async () => {
    while (monitoreando) {
      const t = Date.now();
      try {
        const { stdout } = await execFileAsync("docker", ["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", ...nombres]);
        const linea = { t };
        for (const l of stdout.trim().split("\n")) {
          const [n, cpu, mem] = l.split("\t");
          linea[servicios[n]] = { cpu: Number(cpu.replace("%", "")), mem_mib: aMiB(mem.split("/")[0]) };
        }
        anotar("recursos.jsonl", linea);
      } catch (err) {
        anotar("recursos.jsonl", { t, error: String(err.message).slice(0, 200) });
      }
      await dormir(Math.max(0, 1000 - (Date.now() - t)));
    }
  })();
}

// ------------------------------------------------------------------ 4: Artillery

const overrides = { config: { phases: FASES.map((f) => ({ name: f.nombre, arrivalRate: f.rate, duration: f.duracion })) } };
const inicio = new Date();
console.log(`[4/5] ${nombre} contra ${BASE} (${ENTORNO}), ${DURACION_TOTAL} s: ${FASES.map((f) => `${f.rate}/s x ${f.duracion} s`).join(", ")}`);
const artillery = spawn(
  path.join(RAIZ, "perf/node_modules/.bin/artillery"),
  ["run", `${nombre}.yaml`, "-e", ENTORNO, "--overrides", JSON.stringify(overrides), "--output", archivo(`${nombre}.json`)],
  {
    cwd: AQUI,
    stdio: "inherit",
    env: { ...process.env, TARGET: BASE, CASO: caso, DATADOG_API_HOST, PEDIDOS_JSONL: archivo("pedidos.jsonl") },
  }
);
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    artillery.kill(senal);
    process.exit(130);
  });
}
const codigo = await new Promise((r) => artillery.on("exit", r));
const fin = new Date();
monitoreando = false;
await monitor;

// ------------------------------------------------------------------ 5: meta y analisis

const sh = (c) => {
  try {
    return execSync(c, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "?";
  }
};
const lineasAzure = [];
if (ENTORNO === "azure") {
  // solo estas tres salidas: el resto del estado de terraform puede tener secretos
  for (const o of ["vmss_instances", "vmss_sku", "redis_sku"]) lineasAzure.push(`terraform output ${o}: ${sh(`terraform output -json ${o}`)}`);
  const region = sh("grep -E '^\\s*region\\s*=' terraform.tfvars | head -1 | sed -E 's/.*=\\s*\"?([^\"]*)\"?.*/\\1/'");
  lineasAzure.push(`region: ${region && region !== "?" ? region : "eastus2 (default de variables.tf)"}`);
}
fs.writeFileSync(
  archivo("meta.txt"),
  [
    `corrida: ${nombre}   caso: ${caso}   entorno: ${ENTORNO}   target: ${BASE}`,
    `inicio UTC: ${inicio.toISOString()}`,
    `fin UTC: ${fin.toISOString()}`,
    `zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `fases: ${JSON.stringify(FASES)}`,
    `RTT de base (GET /): conexion reutilizada p50 ${rtt.reutilizada.p50_ms} ms, p95 ${rtt.reutilizada.p95_ms} ms; conexion nueva p50 ${rtt.nueva.p50_ms} ms, p95 ${rtt.nueva.p95_ms} ms`,
    `commit: ${sh("git rev-parse HEAD")}`,
    `git status --porcelain (sin perf/results):\n${sh("git status --porcelain -- . ':!perf/results'") || "(vacio)"}`,
    `artillery: ${sh("perf/node_modules/.bin/artillery --version | grep -i artillery")}`,
    `node: ${process.version}   maquina: ${os.hostname()} (${os.cpus().length} CPU, ${Math.round(os.totalmem() / 2 ** 30)} GiB)   conexion: ${process.env.CONEXION ?? "sin anotar"}`,
    ...lineasAzure,
    `codigo de salida de artillery: ${codigo}`,
  ].join("\n") + "\n"
);

console.log("[5/5] analisis");
execFileSync(process.execPath, [path.join(AQUI, "analizar.mjs"), caso, corrida], { stdio: "inherit" });
