#!/usr/bin/env node
// Control negativo: comprueba que el escenario `saldo` DETECTA una reserva de saldo que no es atomica.
//
//   node perf/integridad/control-negativo.mjs
//
// Un test que nunca falla no prueba nada. Este script arma una copia TEMPORAL de la app (la de node/ no se toca)
// en la que reserveBalance hace lo que hacia el TP 1: chequea el saldo y lo descuenta recien unos 600 ms despues
// (la ventana de las dos transferencias simuladas, 2 x U(200, 400) ms), en vez de hacerlo de una vez en Redis.
// Despues corre `correr.mjs saldo` contra esa copia. Lo esperado es que la verificacion FALLE.
// Es una simulacion del defecto del TP 1, no el codigo del TP 1.
//
// Requiere docker-compose.local.yml levantado (Redis y ARCA; el reinicio del estado usa el contenedor `app`).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const PUERTO = 3002;
const BASE = `http://localhost:${PUERTO}`;
const CASO = process.argv[2] ?? "local-control-negativo";

// 1) copia temporal de la app, sin node_modules (se enlaza el de node/), sin tests ni infra.json
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arvault-control-"));
fs.cpSync(path.join(RAIZ, "node"), tmp, {
  recursive: true,
  filter: (origen) => !/(node_modules|[\\/]test|infra\.json|src\.zip)([\\/]|$)/.test(origen),
});
fs.symlinkSync(path.join(RAIZ, "node/node_modules"), path.join(tmp, "node_modules"), "dir");

// 2) la reserva "del TP 1": chequear ahora, descontar despues
const archivo = path.join(tmp, "repository/redis-adapter.js");
const original = fs.readFileSync(archivo, "utf8");
const inicio = original.indexOf("    async reserveBalance(accountId, amount) {");
const fin = original.indexOf("    async creditBalance(");
if (inicio < 0 || fin < 0) throw new Error("no se encontro reserveBalance en redis-adapter.js: actualizar este script");
const noAtomica = `    async reserveBalance(accountId, amount) {
      // SIMULACION DEL DEFECTO DEL TP 1: se chequea el saldo y se descuenta despues de las transferencias
      const saldo = Number(await client.hGet("balances", String(accountId)));
      if (saldo < amount) return false;
      const transferencias = 200 + Math.random() * 200 + (200 + Math.random() * 200);
      await new Promise((r) => setTimeout(r, transferencias));
      await client.hIncrByFloat("balances", String(accountId), -amount);
      return true;
    },

`;
fs.writeFileSync(archivo, original.slice(0, inicio) + noAtomica + original.slice(fin));

// 3) levantar la copia en otro puerto, contra el mismo Redis y ARCA del compose
console.log(`[control] app no atomica en ${BASE} (copia en ${tmp})`);
const app = spawn("node", ["app.js"], {
  cwd: tmp,
  stdio: "ignore",
  env: { ...process.env, PORT: String(PUERTO), REDIS_URL: "redis://localhost:6379", ARCA_URI: "http://localhost:8081", METRICS_ADAPTER: "null" },
});
let listo = false;
for (let i = 0; i < 30 && !listo; i++) {
  try {
    listo = (await fetch(`${BASE}/health`)).status === 200;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!listo) {
  app.kill();
  throw new Error("la copia de la app no arranco");
}

// 4) el mismo escenario de siempre, contra la copia
let codigo;
try {
  const r = spawnSync("node", [path.join(import.meta.dirname, "correr.mjs"), "saldo", CASO], {
    cwd: RAIZ,
    stdio: "inherit",
    env: { ...process.env, TARGETS: BASE },
  });
  codigo = r.status;
} finally {
  app.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(
  codigo === 1
    ? "\n[control] OK: contra una reserva no atomica la verificacion FALLO, como se esperaba. El escenario detecta el defecto."
    : `\n[control] ATENCION: la verificacion termino con codigo ${codigo}. Si dio 0, el escenario NO detecto el defecto con esta carga.`
);
process.exit(codigo === 1 ? 0 : 1);
