#!/usr/bin/env node
// Caracteriza a ARCA con numeros: cuantas llamadas fallan, cuantos DNI rechaza y si el rechazo es fijo por DNI.
// Sirve para anclar las predicciones (no es una prueba de carga del servicio).
//
//   node perf/integridad/medir-arca.mjs [urlDeArca]     (por defecto http://127.0.0.1:8081, el ARCA de docker-compose.local.yml)
//
// En Azure ARCA solo es alcanzable desde dentro de la red (IP privada): correr desde el jumpbox, o hacer
// una variante que pase por el servicio (POST /exchange) y cuente 403 y 503.
const ARCA = process.argv[2] ?? "http://127.0.0.1:8081";
const dniAlAzar = () => 1000000 + Math.floor(Math.random() * (99999999 - 1000000 + 1));

async function llamar(dni) {
  const t0 = Date.now();
  const r = await fetch(`${ARCA}/validar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dni: String(dni) }),
    signal: AbortSignal.timeout(10000),
  });
  const cuerpo = r.status === 200 ? await r.json() : null;
  return { status: r.status, ok: cuerpo?.ok ?? null, ms: Date.now() - t0 };
}

// una respuesta valida: reintenta hasta 8 veces si ARCA devuelve 500
async function respuestaValida(dni) {
  for (let i = 0; i < 8; i++) {
    const r = await llamar(dni);
    if (r.status === 200) return r.ok;
  }
  return null;
}

const enLotes = async (lista, tamano, fn) => {
  const salida = [];
  for (let i = 0; i < lista.length; i += tamano) salida.push(...(await Promise.all(lista.slice(i, i + tamano).map(fn))));
  return salida;
};
const percentil = (v, p) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
const pct = (a, b) => ((100 * a) / b).toFixed(1);
const ic = (p, n) => (196 * Math.sqrt((p * (1 - p)) / n)).toFixed(1);

console.log(`ARCA: ${ARCA}   fecha: ${new Date().toISOString()}`);

// 1) fallas al azar y latencia
const N1 = 3000;
const llamadas = await enLotes(Array.from({ length: N1 }, dniAlAzar), 50, llamar);
const fallas = llamadas.filter((r) => r.status === 500);
const buenas = llamadas.filter((r) => r.status === 200);
const pFalla = fallas.length / N1;
console.log(`\n1) ${N1} llamadas con DNI al azar, 50 a la vez`);
console.log(`   HTTP 500: ${fallas.length} (${pct(fallas.length, N1)} % +- ${ic(pFalla, N1)}); HTTP 200: ${buenas.length}; otros: ${N1 - fallas.length - buenas.length}`);
console.log(`   latencia de los 200: mediana ${percentil(buenas.map((r) => r.ms), 50)} ms, P95 ${percentil(buenas.map((r) => r.ms), 95)} ms, maximo ${Math.max(...buenas.map((r) => r.ms))} ms`);
console.log(`   latencia de los 500: mediana ${percentil(fallas.map((r) => r.ms), 50)} ms`);
console.log(`   falla residual con 1 reintento (p^2): ${pct(pFalla * pFalla, 1)} %`);

// 2) rechazo por DNI
const N2 = 600;
const dnis = Array.from({ length: N2 }, dniAlAzar);
const oks = await enLotes(dnis, 30, respuestaValida);
const validos = oks.filter((o) => o !== null).length;
const rechazados = oks.filter((o) => o === false).length;
console.log(`\n2) ${N2} DNI al azar, una respuesta valida cada uno`);
console.log(`   rechazados (ok:false): ${rechazados} de ${validos} (${pct(rechazados, validos)} % +- ${ic(rechazados / validos, validos)})`);

// 3) el rechazo es fijo por DNI?
const rech = dnis.filter((_, i) => oks[i] === false).slice(0, 30);
const apro = dnis.filter((_, i) => oks[i] === true).slice(0, 30);
const cambian = async (lista) => {
  const r = await enLotes(lista, 10, async (d) => new Set(await Promise.all([1, 2, 3, 4, 5].map(() => respuestaValida(d)))).size > 1);
  return r.filter(Boolean).length;
};
console.log(`\n3) repetir 5 veces el mismo DNI`);
console.log(`   rechazados que cambian de respuesta: ${await cambian(rech)} de ${rech.length}; aprobados que cambian: ${await cambian(apro)} de ${apro.length}`);
