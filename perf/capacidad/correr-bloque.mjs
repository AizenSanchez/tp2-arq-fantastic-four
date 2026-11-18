#!/usr/bin/env node
// Corre el bloque 1 completo para un caso, sin intervencion:
//   capacidad -> controles -> pausa -> endurance (0,5*B y B) -> capturas de Datadog
//   node perf/capacidad/correr-bloque.mjs <caso> [--env local|azure]
// Usa las mismas variables que correr.mjs (ESCALONES, DURACION_*, CONEXION, TARGET...). B sale de la corrida de
// capacidad, asi que RATE_ENDURANCE y RATE_TRAMO no se pasan. Si un control falla, no corre la endurance.
// Variables propias: PAUSA_S (120, sin carga entre las dos corridas). Las capturas de Datadog se hacen solo en azure
// y si estan DATADOG_API_KEY y DD_APP_KEY. No commitea nada.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const AQUI = import.meta.dirname;
const RAIZ = path.resolve(AQUI, "../..");
const args = process.argv.slice(2);
const i = args.indexOf("--env");
const ENTORNO = i >= 0 ? args.splice(i, 2)[1] : "local";
const [caso] = args;
if (!caso || !["local", "azure"].includes(ENTORNO)) {
  console.error("uso: node perf/capacidad/correr-bloque.mjs <caso> [--env local|azure]");
  process.exit(2);
}
for (const v of ["RATE_ENDURANCE", "RATE_TRAMO"]) {
  if (process.env[v]) {
    console.error(`${v} no se pasa: sale del B de la corrida de capacidad`);
    process.exit(2);
  }
}
const PAUSA_S = Number(process.env.PAUSA_S ?? 120);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toISOString();

function correr(script, argumentos, envExtra = {}) {
  console.log(`\n===== ${hora()} node ${path.relative(RAIZ, script)} ${argumentos.join(" ")}`);
  const r = spawnSync(process.execPath, [script, ...argumentos], { cwd: RAIZ, stdio: "inherit", env: { ...process.env, ...envExtra } });
  return r.status ?? 1;
}

const dirCorrida = (corrida) => path.join(RAIZ, "perf/results", caso, `exchange-${corrida}`);
const leer = (corrida, archivo) => {
  const f = path.join(dirCorrida(corrida), archivo);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
};

// los controles que hacen valida una corrida: si no se cumplen, sus numeros no sirven para la siguiente
function controles(corrida, codigoScript) {
  const meta = leer(corrida, "meta.txt");
  const resumen = JSON.parse(leer(corrida, "resumen.json") ?? "null");
  const c = [];
  const control = (nombre, ok, detalle) => c.push({ nombre, ok: Boolean(ok), detalle });
  control("correr.mjs termino bien", codigoScript === 0, `codigo ${codigoScript}`);
  const codigoArtillery = meta?.match(/codigo de salida de artillery: (\S+)/)?.[1];
  control("Artillery termino con codigo 0", codigoArtillery === "0", `codigo ${codigoArtillery ?? "sin meta.txt"}`);
  const a = resumen?.artillery;
  control("lineas de pedidos.jsonl = usuarios creados", a && a.lineas_en_pedidos_jsonl === a.escenarios_creados, `${a?.lineas_en_pedidos_jsonl} contra ${a?.escenarios_creados}`);
  const fases = resumen?.fases ?? [];
  const enviados = fases.reduce((s, f) => s + f.enviados, 0);
  const conexion = fases.reduce((s, f) => s + (f.cuentas?.conexion ?? 0), 0);
  const pctConexion = enviados ? (100 * conexion) / enviados : null;
  control("errores de conexion < 5 % de lo enviado", pctConexion !== null && pctConexion < 5, `${conexion} de ${enviados} (${pctConexion?.toFixed(2)} %)`);
  if (corrida === "capacidad") {
    const t = resumen?.throughput_sostenido;
    control("B calculado", t?.B_pedidos_por_s != null, `B = ${t?.B_pedidos_por_s}`);
    control("B menor que el escalon mas alto", t && !t.B_es_el_escalon_mas_alto, t?.B_es_el_escalon_mas_alto ? "B es el escalon mas alto: agregar escalones" : "ok");
  }
  return { ok: c.every((x) => x.ok), controles: c, B: resumen?.throughput_sostenido?.B_pedidos_por_s ?? null };
}

const mostrar = (corrida, r) => {
  console.log(`\n----- controles de ${corrida}: ${r.ok ? "OK" : "FALLAN"}`);
  for (const x of r.controles) console.log(`  ${x.ok ? "ok   " : "FALLA"} ${x.nombre}: ${x.detalle}`);
};

const inicio = hora();
const extra = ENTORNO === "azure" ? ["--env", "azure"] : [];

// 1: capacidad
const cap = controles("capacidad", correr(path.join(AQUI, "correr.mjs"), ["capacidad", caso, ...extra]));
mostrar("capacidad", cap);
if (!cap.ok) {
  console.error("\nNo corro la endurance: la corrida de capacidad no es valida. Revisar perf/results/" + caso + "/exchange-capacidad/.");
  process.exit(1);
}

// 2: endurance con el B medido
const rateEndurance = Math.max(1, Math.round(cap.B / 2));
console.log(`\n${hora()} B = ${cap.B} pedidos/s. Pausa de ${PAUSA_S} s sin carga y endurance a ${rateEndurance} y ${cap.B} pedidos/s.`);
await dormir(PAUSA_S * 1000);
const end = controles("endurance", correr(path.join(AQUI, "correr.mjs"), ["endurance", caso, ...extra], { RATE_ENDURANCE: String(rateEndurance), RATE_TRAMO: String(cap.B) }));
mostrar("endurance", end);

// 3: capturas de Datadog
const capturas = {};
if (ENTORNO === "azure" && process.env.DATADOG_API_KEY && process.env.DD_APP_KEY) {
  for (const corrida of ["capacidad", "endurance"]) capturas[corrida] = correr(path.join(AQUI, "capturar-datadog.mjs"), [caso, corrida]) === 0 ? "ok" : "fallo";
} else if (ENTORNO === "azure") {
  console.log("\nSin DD_APP_KEY: falta correr capturar-datadog.mjs para las dos corridas.");
}

console.log(`\n===== bloque 1, caso ${caso} (${ENTORNO}), de ${inicio} a ${hora()}`);
console.log(`B = ${cap.B} pedidos/s; endurance a ${rateEndurance} y ${cap.B} pedidos/s`);
console.log(`capacidad: ${cap.ok ? "valida" : "NO valida"}   endurance: ${end.ok ? "valida" : "NO valida"}   datadog: ${JSON.stringify(capturas)}`);
console.log(`resultados en perf/results/${caso}/`);
process.exit(cap.ok && end.ok ? 0 : 1);
