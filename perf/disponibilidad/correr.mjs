#!/usr/bin/env node
// Uso y linea de tiempo: perf/disponibilidad/README.md
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
const [caso] = args;
if (!caso || !["local", "azure"].includes(ENTORNO)) {
  console.error("uso: node perf/disponibilidad/correr.mjs <caso> [--env local|azure]");
  process.exit(2);
}

const RATE = Number(process.env.RATE ?? 20);
const DURACION = Number(process.env.DURACION ?? 300);
const NODO = process.env.NODO ?? "vmss[0]";
const SIN_FALLAS = process.env.SIN_FALLAS === "1";
const DATADOG_API_HOST = process.env.DATADOG_API_HOST ?? "us5.datadoghq.com";

const salida = path.join(RAIZ, "perf/results", caso, "exchange-disponibilidad");
fs.mkdirSync(salida, { recursive: true });
const archivo = (nombre) => path.join(salida, nombre);
for (const f of ["pedidos.jsonl", "salud.jsonl", "fallas.jsonl"]) fs.rmSync(archivo(f), { force: true });
const anotar = (nombre, linea) => fs.appendFileSync(archivo(nombre), JSON.stringify(linea) + "\n");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE =
  process.env.TARGET ??
  (ENTORNO === "azure" ? `http://${fs.readFileSync(path.join(RAIZ, "node/lb_dns"), "utf8").trim()}` : "http://localhost:3000");

if (ENTORNO === "azure" && !process.env.DATADOG_API_KEY) {
  console.error("falta DATADOG_API_KEY (exportala con read -s; no se escribe en ningun archivo)");
  process.exit(2);
}

// desde ansible/ porque el ProxyCommand del inventario usa ../key.pem
const ANSIBLE = (comando) => ["-i", "vmss_hosts", NODO, "-u", "azureuser", "--private-key", "../key.pem", "-m", "shell", "-a", comando];
const OPCIONES_ANSIBLE = { cwd: path.join(RAIZ, "ansible"), encoding: "utf8" };
const sinCabecera = (out) => out.split("\n").slice(1).join("\n").trim();

const enNodo = (comando) => sinCabecera(execFileSync("ansible", ANSIBLE(comando), { ...OPCIONES_ANSIBLE, stdio: ["ignore", "pipe", "pipe"] }));

// Ansible tarda de 6 a 13 s: si bloquea, el monitor de /health deja de consultar justo durante la falla
const execFileAsync = promisify(execFile);
const enNodoSinBloquear = async (comando) => sinCabecera((await execFileAsync("ansible", ANSIBLE(comando), OPCIONES_ANSIBLE)).stdout);

const compose = (...a) => execFileSync("docker", ["compose", "-f", "docker-compose.local.yml", ...a], { cwd: RAIZ, encoding: "utf8", stdio: "pipe" });
const composeSinBloquear = (...a) => execFileAsync("docker", ["compose", "-f", "docker-compose.local.yml", ...a], { cwd: RAIZ, encoding: "utf8" });

// la hora del nodo fecha la falla mejor que la de la laptop, por la demora de Ansible
const PID = "$(pm2 pid app)";
const FALLAS = {
  "kill-9": { azure: `date +%s%3N; kill -9 ${PID}`, local: async () => (await composeSinBloquear("kill", "app"), await composeSinBloquear("start", "app")) },
  "pm2-stop": { azure: "date +%s%3N; pm2 stop app >/dev/null", local: () => composeSinBloquear("stop", "app") },
  "pm2-start": { azure: "date +%s%3N; pm2 start app >/dev/null", local: () => composeSinBloquear("start", "app") },
  "kill-STOP": { azure: `date +%s%3N; kill -STOP ${PID}`, local: () => composeSinBloquear("pause", "app") },
  "kill-CONT": { azure: `date +%s%3N; kill -CONT ${PID}`, local: () => composeSinBloquear("unpause", "app") },
};
const LINEA_DE_TIEMPO = [
  { s: 60, falla: "kill-9" },
  { s: 120, falla: "pm2-stop" },
  { s: 150, falla: "pm2-start" },
  { s: 210, falla: "kill-STOP" },
  { s: 240, falla: "kill-CONT" },
].filter((f) => f.s < DURACION);

async function inyectar(falla, planificado) {
  const antes = Date.now();
  let tNodo = null;
  let salidaCmd = "";
  let error = null;
  try {
    if (ENTORNO === "azure") {
      salidaCmd = await enNodoSinBloquear(FALLAS[falla].azure);
      tNodo = Number(salidaCmd.match(/\d{13}/)?.[0]) || null;
    } else {
      await FALLAS[falla].local();
    }
  } catch (err) {
    error = String(err.stderr || err.message).trim().slice(0, 500);
  }
  const linea = { falla, planificado_s: planificado, t_lanzado: antes, t_nodo: tNodo, t_vuelta: Date.now(), error, salida: salidaCmd || null };
  anotar("fallas.jsonl", linea);
  console.log(`[falla] ${falla} a los ${planificado} s${error ? ` FALLO: ${error}` : ""}`);
  if (ENTORNO === "azure") await marcarEnDatadog(falla, tNodo ?? antes, error);
}

async function marcarEnDatadog(falla, t, error) {
  const api = `https://api.${DATADOG_API_HOST.replace(/^app\./, "")}`;
  try {
    const r = await fetch(`${api}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "DD-API-KEY": process.env.DATADOG_API_KEY },
      body: JSON.stringify({
        title: `falla: ${falla}${error ? " (fallo la inyeccion)" : ""}`,
        text: `${falla} en ${NODO}, caso ${caso}`,
        date_happened: Math.floor(t / 1000),
        tags: ["test:exchange-disponibilidad", `caso:${caso}`, `falla:${falla}`],
        alert_type: error ? "error" : "warning",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.error(`[datadog] el evento ${falla} no se publico: HTTP ${r.status}`);
  } catch (err) {
    console.error(`[datadog] el evento ${falla} no se publico: ${err.message}`);
  }
}

// si la corrida se corta, el proceso no puede quedar congelado ni detenido
let limpiando = false;
function dejarElNodoAndando() {
  if (limpiando || SIN_FALLAS) return;
  limpiando = true;
  try {
    if (ENTORNO === "azure") {
      enNodo(`P=${PID}; [ -n "$P" ] && [ "$P" != 0 ] && kill -CONT $P; pm2 jlist | grep -q '"status":"stopped"' && pm2 start app >/dev/null; true`);
    } else {
      try { compose("unpause", "app"); } catch {}
      compose("start", "app");
    }
  } catch (err) {
    console.error(`no pude dejar el nodo andando, revisalo a mano: ${err.message}`);
  }
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

const FOTO_PM2 =
  "pm2 jlist | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.stringify(JSON.parse(s).map(p=>({nombre:p.name,pid:p.pid,estado:p.pm2_env.status,reinicios:p.pm2_env.restart_time,kill_timeout_ms:p.pm2_env.kill_timeout,autorestart:p.pm2_env.autorestart,pm2:p.pm2_env._pm2_version,uptime_desde:p.pm2_env.pm_uptime})))))'";

const resetCmd = process.env.RESET_CMD ?? (ENTORNO === "local" ? "docker compose -f docker-compose.local.yml exec -T app node tools/reset-state.js" : "ansible/reset.sh");
console.log(`[1/5] reinicio del estado: ${resetCmd}`);
execSync(resetCmd, { cwd: RAIZ, stdio: "inherit" });
await esperarSalud();

// conexion nueva en cada muestra, como cada pedido de Artillery
const getRaiz = () =>
  new Promise((resolve, reject) => {
    const t = process.hrtime.bigint();
    http
      .get(`${BASE}/`, { agent: false, timeout: 5000 }, (r) => {
        r.resume();
        r.on("end", () => resolve(Number(process.hrtime.bigint() - t) / 1e6));
      })
      .on("timeout", function () { this.destroy(new Error("timeout")); })
      .on("error", reject);
  });
console.log("[2/5] latencia de base: 30 GET / sin carga");
const muestras = [];
for (let n = 0; n < 30; n++) muestras.push(Math.round(await getRaiz()));
const orden = [...muestras].sort((a, b) => a - b);
fs.writeFileSync(archivo("base.json"), JSON.stringify({ url: `${BASE}/`, conexion: "nueva", muestras_ms: muestras, min_ms: orden[0], p50_ms: orden[14], p95_ms: orden[28] }, null, 2) + "\n");

if (ENTORNO === "azure") {
  console.log("      infraestructura desplegada y foto de pm2 antes");
  const infra = { "terraform-state-list.txt": "terraform state list", "terraform-output.txt": "terraform output", "vmss-list-instances.txt": "az vmss list-instances -g tp2_resource_group -n tp2vmss -o table" };
  for (const [nombre, cmd] of Object.entries(infra)) fs.writeFileSync(archivo(nombre), execSync(cmd, { cwd: RAIZ, encoding: "utf8" }));
  fs.writeFileSync(archivo("pm2-antes.json"), enNodo(FOTO_PM2) + "\n");
}

let monitoreando = true;
const monitor = (async () => {
  while (monitoreando) {
    const t = Date.now();
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(800) });
      anotar("salud.jsonl", { t, status: r.status, ms: Date.now() - t, nodo: r.headers.get("x-node") });
    } catch (err) {
      anotar("salud.jsonl", { t, status: null, ms: Date.now() - t, error: err.cause?.code ?? err.name });
    }
    await dormir(Math.max(0, 1000 - (Date.now() - t)));
  }
})();

const INICIO_MS = Date.now();
const inicio = new Date(INICIO_MS);
console.log(`[3/5] ${RATE} pedidos/s durante ${DURACION} s contra ${BASE}${SIN_FALLAS ? " (sin fallas)" : ""}`);
const enCurso = [];
const temporizadores = SIN_FALLAS ? [] : LINEA_DE_TIEMPO.map(({ s, falla }) => setTimeout(() => enCurso.push(inyectar(falla, s)), s * 1000));

const artillery = spawn(
  path.join(RAIZ, "perf/node_modules/.bin/artillery"),
  ["run", "exchange-disponibilidad.yaml", "-e", ENTORNO, "--output", path.join(RAIZ, "perf/results", caso, "exchange-disponibilidad.json")],
  {
    cwd: AQUI,
    stdio: "inherit",
    env: { ...process.env, TARGET: BASE, CASO: caso, RATE: String(RATE), DURACION: String(DURACION), INICIO_MS: String(INICIO_MS), DATADOG_API_HOST, PEDIDOS_JSONL: archivo("pedidos.jsonl") },
  }
);
for (const senal of ["SIGINT", "SIGTERM"]) {
  process.on(senal, () => {
    artillery.kill(senal);
    temporizadores.forEach(clearTimeout);
    dejarElNodoAndando();
    process.exit(130);
  });
}
const codigo = await new Promise((r) => artillery.on("exit", r));
const fin = new Date();
temporizadores.forEach(clearTimeout);
await Promise.all(enCurso);
monitoreando = false;
await monitor;
dejarElNodoAndando();

if (ENTORNO === "azure") {
  console.log("[4/5] foto de pm2 despues y log de arranques y apagados");
  fs.writeFileSync(archivo("pm2-despues.json"), enNodo(FOTO_PM2) + "\n");
  fs.writeFileSync(
    archivo("pm2-log-arranques.txt"),
    enNodo("pm2 logs app --lines 3000 --nostream --raw 2>/dev/null | grep -E 'listening|received|shutting|unhandled|failed|Error' | tail -n 100") + "\n"
  );
}

const sh = (c) => {
  try { return execSync(c, { cwd: RAIZ, encoding: "utf8" }).trim(); } catch { return "?"; }
};
fs.writeFileSync(
  archivo("meta.txt"),
  [
    `caso: ${caso}   entorno: ${ENTORNO}   target: ${BASE}`,
    `inicio UTC: ${inicio.toISOString()}`,
    `fin UTC: ${fin.toISOString()}`,
    `zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `carga: ${RATE} pedidos/s durante ${DURACION} s   fallas: ${SIN_FALLAS ? "ninguna" : LINEA_DE_TIEMPO.map((f) => `${f.falla}@${f.s}s`).join(" ")}   nodo: ${NODO}`,
    `commit: ${sh("git rev-parse HEAD")}`,
    `git status --porcelain (sin perf/results):\n${sh("git status --porcelain -- . ':!perf/results'") || "(vacio)"}`,
    `artillery: ${sh("perf/node_modules/.bin/artillery --version | grep -i artillery")}`,
    `node: ${process.version}   maquina: ${os.hostname()}   conexion: ${process.env.CONEXION ?? "sin anotar"}`,
    `codigo de salida de artillery: ${codigo}`,
  ].join("\n") + "\n"
);

console.log("[5/5] analisis");
execFileSync(process.execPath, [path.join(AQUI, "analizar.mjs"), path.join(RAIZ, "perf/results", caso)], { stdio: "inherit" });
