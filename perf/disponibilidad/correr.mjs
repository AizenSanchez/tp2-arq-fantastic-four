#!/usr/bin/env node
// Corrida de disponibilidad (bloque 3): carga constante y fallas del proceso inyectadas a tiempos fijos.
//
//   node perf/disponibilidad/correr.mjs <caso> [--env local|azure]
//
// En orden:
//   1. reinicia el estado y espera /health = 200
//   2. (azure) foto de pm2 en el nodo: pid, reinicios, kill_timeout
//   3. lanza Artillery y, en paralelo, un monitor de GET /health cada 1 s (E14) y las fallas de la linea de tiempo
//   4. (azure) foto de pm2 despues y las lineas de arranque y apagado del log de la app
//   5. meta.txt y analisis (analizar.mjs -> resumen.md)
//
// Linea de tiempo (segundos desde el inicio de la carga; ver README.md):
//   30-40 pedidos invalidos (E9, lo hace procesadores.cjs) · 60 kill -9 (E3) · 120 pm2 stop (E4) · 150 pm2 start
//   210 kill -STOP, proceso congelado (E18) · 240 kill -CONT
//
// Variables: RATE (pedidos/s, 20), DURACION (s, 300), NODO (patron de Ansible del nodo a romper, vmss[0]),
// SIN_FALLAS=1 (solo carga y monitor), CONEXION (cable|wifi), DATADOG_API_KEY y DATADOG_API_HOST (azure).
import { spawn, execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
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

// ---------------------------------------------------------------- comandos en el nodo

// Ansible se corre desde ansible/: el ProxyCommand del inventario usa ../key.pem
function enNodo(comando) {
  const out = execFileSync(
    "ansible",
    ["-i", "vmss_hosts", NODO, "-u", "azureuser", "--private-key", "../key.pem", "-m", "shell", "-a", comando],
    { cwd: path.join(RAIZ, "ansible"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return out.split("\n").slice(1).join("\n").trim(); // la primera linea es "host | CHANGED | rc=0 >>"
}

const compose = (...a) => execFileSync("docker", ["compose", "-f", "docker-compose.local.yml", ...a], { cwd: RAIZ, encoding: "utf8", stdio: "pipe" });

// Cada falla imprime primero la hora del nodo (ms), para fecharla con su reloj y no con el de la laptop.
// En local son aproximaciones con docker (no hay pm2): sirven para ensayar los scripts, no como evidencia.
const PID = "$(pm2 pid app)";
const FALLAS = {
  "kill-9": { azure: `date +%s%3N; kill -9 ${PID}`, local: () => (compose("kill", "app"), compose("start", "app")) },
  "pm2-stop": { azure: "date +%s%3N; pm2 stop app >/dev/null", local: () => compose("stop", "app") },
  "pm2-start": { azure: "date +%s%3N; pm2 start app >/dev/null", local: () => compose("start", "app") },
  "kill-STOP": { azure: `date +%s%3N; kill -STOP ${PID}`, local: () => compose("pause", "app") },
  "kill-CONT": { azure: `date +%s%3N; kill -CONT ${PID}`, local: () => compose("unpause", "app") },
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
      salidaCmd = enNodo(FALLAS[falla].azure);
      tNodo = Number(salidaCmd.match(/\d{13}/)?.[0]) || null;
    } else {
      FALLAS[falla].local();
    }
  } catch (err) {
    error = String(err.stderr || err.message).trim().slice(0, 500);
  }
  const linea = { falla, planificado_s: planificado, t_lanzado: antes, t_nodo: tNodo, t_vuelta: Date.now(), error, salida: salidaCmd || null };
  anotar("fallas.jsonl", linea);
  console.log(`[falla] ${falla} a los ${planificado} s${error ? ` FALLO: ${error}` : ""}`);
  if (ENTORNO === "azure") await marcarEnDatadog(falla, tNodo ?? antes, error);
}

// una marca vertical en los graficos del dashboard (el evento solo necesita la API key, la misma de Artillery)
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

// si la corrida se corta a mitad, el proceso no puede quedar congelado ni detenido en el nodo
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

// ---------------------------------------------------------------- 1 y 2: reinicio y foto de pm2

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

if (ENTORNO === "azure") {
  console.log("[2/5] foto de pm2 antes");
  fs.writeFileSync(archivo("pm2-antes.json"), enNodo(FOTO_PM2) + "\n");
}

// ---------------------------------------------------------------- 3: carga, monitor y fallas

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
const temporizadores = SIN_FALLAS ? [] : LINEA_DE_TIEMPO.map(({ s, falla }) => setTimeout(() => inyectar(falla, s), s * 1000));

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
monitoreando = false;
await monitor;
dejarElNodoAndando();

// ---------------------------------------------------------------- 4: pm2 despues y log de arranques

if (ENTORNO === "azure") {
  console.log("[4/5] foto de pm2 despues y log de arranques y apagados");
  fs.writeFileSync(archivo("pm2-despues.json"), enNodo(FOTO_PM2) + "\n");
  fs.writeFileSync(
    archivo("pm2-log-arranques.txt"),
    enNodo("pm2 logs app --lines 3000 --nostream --raw 2>/dev/null | grep -E 'listening|received|shutting|unhandled|failed|Error' | tail -n 100") + "\n"
  );
}

// ---------------------------------------------------------------- 5: meta y analisis

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
