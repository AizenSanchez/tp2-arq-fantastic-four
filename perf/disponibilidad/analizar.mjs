#!/usr/bin/env node
// Analiza una corrida de disponibilidad a partir de los archivos crudos (no usa nada mas).
//
//   node perf/disponibilidad/analizar.mjs perf/results/<caso>
//
// Lee exchange-disponibilidad.json (Artillery) y exchange-disponibilidad/{pedidos,salud,fallas}.jsonl, meta.txt,
// pm2-*.json. Escribe exchange-disponibilidad/resumen.md y resumen.json.
//
// Definiciones (las mismas del TP 1 y del plan del grupo):
// - atendido: respuesta 2xx o 4xx (403 y 422 son decisiones de negocio, 400 es la validacion funcionando).
// - arca_503: 503 con "ARCA no disponible". Es la dependencia externa: pasa sin ninguna falla nuestra (~6 %).
// - falla propia: cualquier otro 5xx o un pedido sin respuesta (conexion rechazada o cortada, timeout de 10 s).
// - cada pedido se cuenta en el segundo en que SALIO, no en el que volvio.
// - t_rec: desde la falla hasta el primer segundo de 3 seguidos sin fallas propias (tope: la falla siguiente).
import fs from "node:fs";
import path from "node:path";

const dirCaso = process.argv[2];
if (!dirCaso) {
  console.error("uso: node perf/disponibilidad/analizar.mjs perf/results/<caso>");
  process.exit(2);
}
const dir = path.join(dirCaso, "exchange-disponibilidad");
const leerJsonl = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const leerJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);

const meta = fs.readFileSync(path.join(dir, "meta.txt"), "utf8");
const ORIGEN = Date.parse(meta.match(/inicio UTC: (\S+)/)[1]);
const lineas = leerJsonl("pedidos.jsonl");
const salud = leerJsonl("salud.jsonl");
const fallas = leerJsonl("fallas.jsonl");
const artillery = leerJson(path.join(dirCaso, "exchange-disponibilidad.json"));

const seg = (t) => Math.floor((t - ORIGEN) / 1000);
const percentil = (v, p) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

// ---------------------------------------------------------------- pedidos

const enviados = new Map();
const respuestas = new Map();
for (const l of lineas) (l.tipo === "enviado" ? enviados : respuestas).set(l.id, l);

const pedidos = [...enviados.values()].map((e) => {
  const r = respuestas.get(e.id);
  return {
    s: seg(e.t),
    invalido: e.invalido,
    clase: r ? r.clase : "perdido",
    status: r?.status ?? null,
    ms: r ? r.t1 - r.t0 : null,
    nodo: r?.nodo ?? null,
  };
});
const propia = (p) => p.clase === "perdido" || p.clase === "error_5xx";
const ultimoSeg = Math.max(0, ...pedidos.map((p) => p.s));

const porSeg = Array.from({ length: ultimoSeg + 1 }, (_, s) => ({ s, enviados: 0, atendidos: 0, arca503: 0, error5xx: 0, perdidos: 0 }));
for (const p of pedidos) {
  if (p.s < 0) continue;
  const c = porSeg[p.s];
  c.enviados++;
  if (p.clase === "atendido") c.atendidos++;
  else if (p.clase === "arca_503") c.arca503++;
  else if (p.clase === "error_5xx") c.error5xx++;
  else c.perdidos++;
}

// ventanas de 10 s, como el dashboard del TP 1
const ventanas = [];
for (let desde = 0; desde <= ultimoSeg; desde += 10) {
  const ps = pedidos.filter((p) => p.s >= desde && p.s < desde + 10);
  const at = ps.filter((p) => p.clase === "atendido");
  ventanas.push({
    desde,
    enviados: ps.length,
    atendidos: at.length,
    pct_atendido: pct(at.length, ps.length),
    arca503: ps.filter((p) => p.clase === "arca_503").length,
    error5xx: ps.filter((p) => p.clase === "error_5xx").length,
    perdidos: ps.filter((p) => p.clase === "perdido").length,
    p50_ms: percentil(at.map((p) => p.ms), 50),
    p95_ms: percentil(at.map((p) => p.ms), 95),
  });
}

// ---------------------------------------------------------------- efecto de cada falla

const tFalla = (f) => f.t_nodo ?? f.t_lanzado;
const fallasOrd = [...fallas].sort((a, b) => tFalla(a) - tFalla(b));
// las fallas que restauran no abren un evento propio: se reportan dentro del evento que cierran
const RESTAURA = { "pm2-start": "pm2-stop", "kill-CONT": "kill-STOP" };
const eventos = fallasOrd
  .filter((f) => !RESTAURA[f.falla])
  .map((f) => {
    const sFalla = seg(tFalla(f));
    const restauracion = fallasOrd.find((g) => RESTAURA[g.falla] === f.falla && tFalla(g) > tFalla(f));
    const siguiente = fallasOrd.find((g) => !RESTAURA[g.falla] && tFalla(g) > tFalla(f));
    const tope = siguiente ? seg(tFalla(siguiente)) : ultimoSeg + 1;
    const tramo = porSeg.filter((c) => c.s >= sFalla && c.s < tope);
    const malos = tramo.filter((c) => c.error5xx + c.perdidos > 0);
    let recupera = null;
    for (let k = 0; k + 2 < tramo.length; k++) {
      const tres = tramo.slice(k, k + 3);
      const desdeRestauracion = !restauracion || tramo[k].s >= seg(tFalla(restauracion));
      if (desdeRestauracion && tres.every((c) => c.enviados > 0 && c.error5xx + c.perdidos === 0) && tramo[k].s > (malos[0]?.s ?? -1)) {
        recupera = tramo[k].s;
        break;
      }
    }
    const enTramo = pedidos.filter((p) => p.s >= sFalla && p.s < (recupera ?? tope));
    const saludTramo = salud.filter((h) => seg(h.t) >= sFalla && seg(h.t) < tope);
    const saludMal = saludTramo.filter((h) => h.status !== 200);
    const lentos = pedidos.filter((p) => p.s >= sFalla && p.s < tope && p.clase === "atendido" && p.ms > 2000);
    return {
      falla: f.falla,
      planificado_s: f.planificado_s,
      s_real: sFalla,
      demora_inyeccion_ms: f.t_nodo ? f.t_nodo - f.t_lanzado : null,
      restaurada_s: restauracion ? seg(tFalla(restauracion)) : null,
      primer_seg_con_falla: malos[0]?.s ?? null,
      ultimo_seg_con_falla: malos.at(-1)?.s ?? null,
      t_rec_s: recupera === null ? null : recupera - sFalla,
      t_rec_desde_restauracion_s: recupera !== null && restauracion ? recupera - seg(tFalla(restauracion)) : null,
      pedidos_afectados: enTramo.filter(propia).length,
      de_ellos_perdidos: enTramo.filter((p) => p.clase === "perdido").length,
      de_ellos_5xx: enTramo.filter((p) => p.clase === "error_5xx").length,
      atendidos_lentos_mas_de_2s: lentos.length,
      latencia_max_ms: Math.max(0, ...pedidos.filter((p) => p.s >= sFalla && p.s < tope && p.ms !== null).map((p) => p.ms)),
      health_segundos_no_200: saludMal.length,
      health_primer_no_200_s: saludMal[0] ? seg(saludMal[0].t) : null,
      health_ultimo_no_200_s: saludMal.at(-1) ? seg(saludMal.at(-1).t) : null,
      error: f.error,
    };
  });

// ---------------------------------------------------------------- pedidos invalidos (E9)

const invalidos = pedidos.filter((p) => p.invalido);
const porStatus = (lista) => lista.reduce((o, p) => ((o[p.status ?? "sin respuesta"] = (o[p.status ?? "sin respuesta"] ?? 0) + 1), o), {});
const medianaDe = (lista) => percentil(lista.filter((p) => p.ms !== null).map((p) => p.ms), 50);
const tranquilos = pedidos.filter((p) => !p.invalido && p.s >= 5 && p.s < Math.min(30, fallasOrd.length ? seg(tFalla(fallasOrd[0])) : 30));
const e9 = {
  enviados: invalidos.length,
  por_tipo: { dni: invalidos.filter((p) => p.invalido === "dni").length, moneda: invalidos.filter((p) => p.invalido === "moneda").length },
  respuestas: porStatus(invalidos),
  mediana_400_ms: medianaDe(invalidos.filter((p) => p.status === 400)),
  validos_en_la_ventana: porStatus(pedidos.filter((p) => !p.invalido && p.s >= 30 && p.s < 40)),
};

// ---------------------------------------------------------------- referencia sin fallas y totales

const latPorStatus = Object.fromEntries(
  [200, 403, 422].map((st) => {
    const l = tranquilos.filter((p) => p.status === st);
    return [st, { n: l.length, mediana_ms: medianaDe(l), p95_ms: percentil(l.map((p) => p.ms), 95) }];
  })
);
const totales = {
  enviados: pedidos.length,
  atendidos: pedidos.filter((p) => p.clase === "atendido").length,
  arca503: pedidos.filter((p) => p.clase === "arca_503").length,
  error5xx: pedidos.filter((p) => p.clase === "error_5xx").length,
  perdidos: pedidos.filter((p) => p.clase === "perdido").length,
  por_status: porStatus(pedidos),
  por_nodo: pedidos.reduce((o, p) => ((o[p.nodo ?? "?"] = (o[p.nodo ?? "?"] ?? 0) + 1), o), {}),
  artillery_errores: Object.fromEntries(Object.entries(artillery?.aggregate?.counters ?? {}).filter(([k]) => k.startsWith("errors."))),
  artillery_codigos: Object.fromEntries(Object.entries(artillery?.aggregate?.counters ?? {}).filter(([k]) => k.startsWith("http.codes."))),
};
const pm2Antes = leerJson(path.join(dir, "pm2-antes.json"));
const pm2Despues = leerJson(path.join(dir, "pm2-despues.json"));
const reinicios = pm2Antes && pm2Despues ? pm2Despues[0]?.reinicios - pm2Antes[0]?.reinicios : null;

const resumen = { meta: meta.trim(), totales, referencia_sin_fallas: latPorStatus, e9, eventos, reinicios_pm2: reinicios, pm2: { antes: pm2Antes, despues: pm2Despues }, ventanas };
fs.writeFileSync(path.join(dir, "resumen.json"), JSON.stringify(resumen, null, 2) + "\n");

// ---------------------------------------------------------------- resumen.md

const fila = (celdas) => `| ${celdas.map((c) => (c === null || c === undefined ? "—" : c)).join(" | ")} |`;
const md = [
  `# Disponibilidad — ${path.basename(dirCaso)}`,
  "",
  "Generado por `perf/disponibilidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.",
  "",
  "```",
  meta.trim(),
  "```",
  "",
  "## Totales",
  "",
  fila(["enviados", "atendidos (2xx/4xx)", "503 de ARCA", "otros 5xx", "sin respuesta", "reinicios de pm2"]),
  fila(["---", "---", "---", "---", "---", "---"]),
  fila([totales.enviados, `${totales.atendidos} (${pct(totales.atendidos, totales.enviados)} %)`, totales.arca503, totales.error5xx, totales.perdidos, reinicios]),
  "",
  `Por estado: \`${JSON.stringify(totales.por_status)}\` · por nodo: \`${JSON.stringify(totales.por_nodo)}\``,
  "",
  `Errores de Artillery: \`${JSON.stringify(totales.artillery_errores)}\``,
  "",
  "## Referencia sin fallas (pedidos válidos de los segundos 5 a 30)",
  "",
  fila(["estado", "n", "mediana (ms)", "p95 (ms)"]),
  fila(["---", "---", "---", "---"]),
  ...Object.entries(latPorStatus).map(([st, v]) => fila([st, v.n, v.mediana_ms, v.p95_ms])),
  "",
  "## Pedidos inválidos (E9, segundos 30 a 40)",
  "",
  `- Enviados: ${e9.enviados} (DNI inválido ${e9.por_tipo.dni}, moneda XYZ ${e9.por_tipo.moneda}).`,
  `- Respuestas a los inválidos: \`${JSON.stringify(e9.respuestas)}\`. Mediana de un 400: ${e9.mediana_400_ms} ms.`,
  `- Respuestas a los válidos de la misma ventana: \`${JSON.stringify(e9.validos_en_la_ventana)}\`.`,
  "",
  "## Efecto de cada falla",
  "",
  "Segundos desde el inicio de la carga. t_rec: hasta el primer segundo de 3 seguidos sin fallas propias.",
  "",
  fila(["falla", "plan (s)", "real (s)", "restaurada (s)", "fallas propias desde-hasta (s)", "t_rec (s)", "t_rec desde la restauración (s)", "pedidos afectados (perdidos / 5xx)", "atendidos > 2 s", "latencia máx (ms)", "/health no 200 (s)"]),
  fila(Array(11).fill("---")),
  ...eventos.map((e) =>
    fila([
      e.falla + (e.error ? " (FALLÓ LA INYECCIÓN)" : ""),
      e.planificado_s,
      e.s_real,
      e.restaurada_s,
      e.primer_seg_con_falla === null ? "ninguna" : `${e.primer_seg_con_falla}–${e.ultimo_seg_con_falla}`,
      e.t_rec_s,
      e.t_rec_desde_restauracion_s,
      `${e.pedidos_afectados} (${e.de_ellos_perdidos} / ${e.de_ellos_5xx})`,
      e.atendidos_lentos_mas_de_2s,
      e.latencia_max_ms,
      e.health_segundos_no_200 ? `${e.health_segundos_no_200} (${e.health_primer_no_200_s}–${e.health_ultimo_no_200_s})` : 0,
    ])
  ),
  "",
  "## Ventanas de 10 s",
  "",
  fila(["desde (s)", "enviados", "% atendido", "503 ARCA", "otros 5xx", "sin respuesta", "p50 (ms)", "p95 (ms)"]),
  fila(Array(8).fill("---")),
  ...ventanas.map((v) => fila([v.desde, v.enviados, v.pct_atendido, v.arca503, v.error5xx, v.perdidos, v.p50_ms, v.p95_ms])),
  "",
];
fs.writeFileSync(path.join(dir, "resumen.md"), md.join("\n"));
console.log(md.join("\n"));
