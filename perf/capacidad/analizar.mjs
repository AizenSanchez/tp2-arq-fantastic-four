#!/usr/bin/env node
// Lee solo los crudos de perf/results/<caso>/exchange-<corrida>/ y escribe resumen.md y resumen.json.
//   node perf/capacidad/analizar.mjs <caso> <capacidad|endurance>
//
// Definiciones (las mismas que perf/predicciones/capacidad.md):
// - cada pedido cuenta en la fase en que SALIO; de cada fase se descartan los primeros 5 s (transitorio)
//   y los ultimos 2 s: el instante 0 es el primer pedido, que Artillery lanza hasta ~1 s despues del inicio
//   real de la fase (reparte la tasa entre workers y cada uno espera un intervalo antes del primero).
// - error propio: timeout, error de conexion o un 5xx que no es el 503 de ARCA ("ARCA no disponible").
// - throughput sostenido B: el escalon mas alto que cumple las tres condiciones:
//     errores propios < 1 % de lo enviado
//     respuestas HTTP (cualquier estado) >= 95 % de lo ofrecido (tasa nominal x segundos de la ventana)
//     p95 de los 200 <= 2 x el p95 de los 200 del primer escalon
// - recuperacion: desde el inicio de la bajada hasta el inicio de la primera ventana de 5 s con
//   p95 de los 200 <= 1,2 x el del primer escalon y sin errores propios.
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const [caso, corrida] = process.argv.slice(2);
if (!caso || !["capacidad", "endurance"].includes(corrida)) {
  console.error("uso: node perf/capacidad/analizar.mjs <caso> <capacidad|endurance>");
  process.exit(2);
}
const nombre = `exchange-${corrida}`;
const dir = path.join(RAIZ, "perf/results", caso, nombre);
const leer = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : null);
const leerJsonl = (f) => (leer(f) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const meta = leer("meta.txt");
if (!meta) {
  console.error(`no hay ${path.relative(RAIZ, dir)}/meta.txt: la corrida no termino`);
  process.exit(2);
}
const FASES = JSON.parse(meta.match(/^fases: (.*)$/m)[1]);
const ENTORNO = meta.match(/entorno: (\S+)/)[1];
const rtt = JSON.parse(leer("rtt.json") ?? "null");
const artillery = JSON.parse(leer(`${nombre}.json`) ?? "null");
const pedidos = leerJsonl("pedidos.jsonl");
const recursos = leerJsonl("recursos.jsonl").filter((r) => !r.error);
if (!pedidos.length) {
  console.error("pedidos.jsonl esta vacio");
  process.exit(2);
}

const RECORTE_S = 5;
const RECORTE_FIN_S = 2;
// Artillery arranca la primera fase con el primer pedido: ese es el instante 0
const ORIGEN = pedidos.reduce((m, p) => Math.min(m, p.t0), Infinity);
let acumulado = 0;
for (const f of FASES) {
  f.desde_s = acumulado;
  acumulado += f.duracion;
  f.hasta_s = acumulado;
}

const percentil = (v, p) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (a, b) => (b ? r1((100 * a) / b) : null);

// ERR_SOCKET_TIMEOUT es el que da got (el cliente HTTP de Artillery) al cumplirse http.timeout
const TIMEOUTS = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "ERR_SOCKET_TIMEOUT", "TimeoutError"]);
function clase(p) {
  if (typeof p.status !== "number") return TIMEOUTS.has(p.status) ? "timeout" : "conexion";
  if (p.status === 200) return "200";
  if (p.status === 403) return "403";
  if (p.status === 503 && p.arca) return "503";
  if (p.status >= 500) return "otro_5xx";
  if (p.status >= 400) return "otro_4xx";
  return "otro_2xx_3xx";
}
const PROPIOS = new Set(["timeout", "conexion", "otro_5xx"]);
for (const p of pedidos) {
  p.s = (p.t0 - ORIGEN) / 1000;
  p.clase = clase(p);
}

function resumirTramo(ps, segundos, rateNominal) {
  const n = (c) => ps.filter((p) => p.clase === c).length;
  const respuestas = ps.filter((p) => typeof p.status === "number").length;
  const propios = ps.filter((p) => PROPIOS.has(p.clase)).length;
  const lat = (c) => ps.filter((p) => p.clase === c).map((p) => p.ms);
  const ofrecidos = rateNominal === null ? null : rateNominal * segundos;
  return {
    segundos,
    rate_nominal: rateNominal,
    ofrecidos,
    enviados: ps.length,
    enviados_por_s: r1(ps.length / segundos),
    respuestas,
    respuestas_por_s: r1(respuestas / segundos),
    por_s: Object.fromEntries(["200", "403", "503", "otro_4xx", "otro_5xx", "timeout", "conexion"].map((c) => [c, r1(n(c) / segundos)])),
    cuentas: Object.fromEntries(["200", "403", "503", "otro_4xx", "otro_5xx", "otro_2xx_3xx", "timeout", "conexion"].map((c) => [c, n(c)])),
    pct_403_de_respuestas: pct(n("403"), respuestas),
    pct_503_de_respuestas: pct(n("503"), respuestas),
    errores_propios: propios,
    pct_errores_propios: pct(propios, ps.length),
    pct_respuestas_de_ofrecido: ofrecidos ? pct(respuestas, ofrecidos) : null,
    lat_200: { p50: percentil(lat("200"), 50), p95: percentil(lat("200"), 95), p99: percentil(lat("200"), 99) },
    lat_403: { p50: percentil(lat("403"), 50), p95: percentil(lat("403"), 95) },
    motivos_503: ps.filter((p) => p.status === 503).reduce((o, p) => ((o[p.motivo ?? "?"] = (o[p.motivo ?? "?"] ?? 0) + 1), o), {}),
  };
}

const SERVICIOS = ["app", "redis", "arca"];
function recursosEntre(desdeS, hastaS) {
  const rs = recursos.filter((r) => (r.t - ORIGEN) / 1000 >= desdeS && (r.t - ORIGEN) / 1000 < hastaS);
  if (!rs.length) return null;
  return Object.fromEntries(
    SERVICIOS.map((s) => {
      const cpu = rs.map((r) => r[s]?.cpu).filter((x) => typeof x === "number");
      const mem = rs.map((r) => r[s]?.mem_mib).filter((x) => typeof x === "number");
      const max = (l) => (l.length ? r1(Math.max(...l)) : null);
      return [s, { cpu_max: max(cpu), cpu_media: r1(media(cpu)), mem_max_mib: max(mem) }];
    })
  );
}

const porFase = FASES.map((f) => {
  const desde = f.desde_s + RECORTE_S;
  const hasta = f.hasta_s - RECORTE_FIN_S;
  const ps = pedidos.filter((p) => p.s >= desde && p.s < hasta);
  return { ...f, ventana_s: [desde, hasta], ...resumirTramo(ps, hasta - desde, f.rate), recursos: recursosEntre(desde, hasta) };
});

const ref = porFase[0];
const P95_REF = ref.lat_200.p95;
const condiciones = (f) => ({
  errores: f.pct_errores_propios !== null && f.pct_errores_propios < 1,
  respuestas: f.pct_respuestas_de_ofrecido !== null && f.pct_respuestas_de_ofrecido >= 95,
  latencia: P95_REF !== null && f.lat_200.p95 !== null && f.lat_200.p95 <= 2 * P95_REF,
});
for (const f of porFase) {
  f.condiciones = condiciones(f);
  f.cumple = Object.values(f.condiciones).every(Boolean);
}

// rtt.json viejo: una sola serie con fetch (conexion reutilizada salvo la primera muestra)
const rttReutilizada = rtt ? { p50_ms: rtt.reutilizada?.p50_ms ?? rtt.p50_ms, p95_ms: rtt.reutilizada?.p95_ms ?? rtt.p95_ms } : null;
const rttNueva = rtt?.nueva ? { p50_ms: rtt.nueva.p50_ms, p95_ms: rtt.nueva.p95_ms, connect_p50_ms: rtt.nueva.connect_p50_ms } : null;
const resumen = { caso, corrida: nombre, entorno: ENTORNO, rtt: rtt && { reutilizada: rttReutilizada, nueva: rttNueva }, recorte_s: { inicio: RECORTE_S, fin: RECORTE_FIN_S }, fases: porFase };

// ------------------------------------------------------------------ reparto por nodo (header X-Node)

// los timeouts y errores de conexion no traen nodo: el reparto es sobre las respuestas
const NODOS = [...new Set(pedidos.map((p) => p.nodo).filter(Boolean))].sort();
const repartir = (ps) => {
  const respondidos = ps.filter((p) => p.nodo);
  return Object.fromEntries(
    NODOS.map((n) => {
      const del = respondidos.filter((p) => p.nodo === n);
      const lat = del.filter((p) => p.clase === "200").map((p) => p.ms);
      return [n, { respuestas: del.length, pct: pct(del.length, respondidos.length), p50_200: percentil(lat, 50), p95_200: percentil(lat, 95) }];
    })
  );
};
if (NODOS.length > 1) {
  resumen.nodos = NODOS;
  for (const f of porFase) f.por_nodo = repartir(pedidos.filter((p) => p.s >= f.ventana_s[0] && p.s < f.ventana_s[1]));
}

// ------------------------------------------------------------------ capacidad: B y recuperacion

const ventanas5 = (desdeS, hastaS) => {
  const vs = [];
  for (let d = desdeS; d < hastaS; d += 5) {
    const ps = pedidos.filter((p) => p.s >= d && p.s < Math.min(d + 5, hastaS));
    vs.push({ desde_s: d, enviados: ps.length, errores_propios: ps.filter((p) => PROPIOS.has(p.clase)).length, p95_200: percentil(ps.filter((p) => p.clase === "200").map((p) => p.ms), 95) });
  }
  return vs;
};

if (corrida === "capacidad") {
  const escalones = porFase.filter((f) => f.tipo === "escalon");
  const cumplen = escalones.filter((f) => f.cumple);
  const B = cumplen.length ? cumplen.at(-1).rate : null;
  const primeroQueFalla = escalones.find((f) => !f.cumple);
  resumen.throughput_sostenido = {
    B_pedidos_por_s: B,
    p95_ref_ms: P95_REF,
    primer_escalon_que_no_cumple: primeroQueFalla ? { rate: primeroQueFalla.rate, condiciones: primeroQueFalla.condiciones } : null,
    B_es_el_escalon_mas_alto: B !== null && B === escalones.at(-1).rate,
    no_monotono: cumplen.some((f) => primeroQueFalla && f.rate > primeroQueFalla.rate),
  };
  const bajada = FASES.find((f) => f.tipo === "bajada");
  if (bajada) {
    const vs = ventanas5(bajada.desde_s, bajada.hasta_s);
    const ok = vs.find((v) => v.p95_200 !== null && P95_REF !== null && v.p95_200 <= 1.2 * P95_REF && v.errores_propios === 0);
    resumen.recuperacion = {
      rate_bajada: bajada.rate,
      umbral_p95_ms: P95_REF === null ? null : r1(1.2 * P95_REF),
      segundos: ok ? ok.desde_s - bajada.desde_s : null,
      ventanas: vs.map((v) => ({ ...v, desde_bajada_s: v.desde_s - bajada.desde_s })),
    };
  }
}

// ------------------------------------------------------------------ endurance: p95 por minuto y pendiente

function regresion(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = media(xs);
  const my = media(ys);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const sxy = xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0);
  const pendiente = sxy / sxx;
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const ssRes = ys.reduce((s, y, k) => s + (y - (my + pendiente * (xs[k] - mx))) ** 2, 0);
  return { pendiente_ms_por_min: r1(pendiente), r2: ssTot ? Math.round((1 - ssRes / ssTot) * 100) / 100 : null, n };
}

if (corrida === "endurance") {
  const ultimo = Math.ceil(pedidos.reduce((m, p) => Math.max(m, p.s), 0) / 60);
  const minutos = [];
  for (let m = 0; m < ultimo; m++) {
    const ps = pedidos.filter((p) => p.s >= m * 60 && p.s < (m + 1) * 60);
    const f = FASES.find((x) => m * 60 >= x.desde_s && m * 60 < x.hasta_s);
    const rec = recursosEntre(m * 60, (m + 1) * 60);
    minutos.push({
      minuto: m,
      fase: f?.nombre ?? "fin",
      enviados: ps.length,
      errores_propios: ps.filter((p) => PROPIOS.has(p.clase)).length,
      p50_200: percentil(ps.filter((p) => p.clase === "200").map((p) => p.ms), 50),
      p95_200: percentil(ps.filter((p) => p.clase === "200").map((p) => p.ms), 95),
      mem_app_mib: rec?.app.mem_max_mib ?? null,
      mem_redis_mib: rec?.redis.mem_max_mib ?? null,
      ...(NODOS.length > 1 && { por_nodo: repartir(ps) }),
    });
  }
  const pendientes = Object.fromEntries(
    FASES.map((f) => {
      const ms = minutos.filter((m) => m.fase === f.nombre && m.p95_200 !== null && m.minuto * 60 >= f.desde_s && (m.minuto + 1) * 60 <= f.hasta_s);
      return [f.nombre, regresion(ms.map((m) => m.minuto + 0.5), ms.map((m) => m.p95_200))];
    })
  );
  const memoria = {};
  if (recursos.length) {
    for (const f of FASES) {
      const rs = recursos.filter((r) => (r.t - ORIGEN) / 1000 >= f.desde_s && (r.t - ORIGEN) / 1000 < f.hasta_s);
      const extremo = (lista) => Object.fromEntries(["app", "redis"].map((s) => [s, percentil(lista.map((r) => r[s]?.mem_mib).filter((x) => typeof x === "number"), 50)]));
      memoria[f.nombre] = { inicio_mib: extremo(rs.slice(0, 10)), fin_mib: extremo(rs.slice(-10)) };
    }
  }
  resumen.endurance = { pendiente_p95: pendientes, memoria, minutos };
}

const contadores = artillery?.aggregate?.counters ?? {};
// http.response_time de Artillery (y de Datadog) es la fase firstByte de got: sin connect ni envio del pedido
const resumenes = artillery?.aggregate?.summaries ?? {};
const tiempo = (k) => (resumenes[k] ? { n: resumenes[k].count, p50: resumenes[k].p50 ?? resumenes[k].median, p95: resumenes[k].p95, p99: resumenes[k].p99 } : null);
resumen.artillery = {
  response_time_2xx: tiempo("http.response_time.2xx"),
  response_time_4xx: tiempo("http.response_time.4xx"),
  codigos: Object.fromEntries(Object.entries(contadores).filter(([k]) => k.startsWith("http.codes."))),
  errores: Object.fromEntries(Object.entries(contadores).filter(([k]) => k.startsWith("errors."))),
  escenarios_creados: contadores["vusers.created"] ?? null,
  escenarios_fallidos: contadores["vusers.failed"] ?? null,
  lineas_en_pedidos_jsonl: pedidos.length,
};

fs.writeFileSync(path.join(dir, "resumen.json"), JSON.stringify(resumen, null, 2) + "\n");

// ------------------------------------------------------------------ resumen.md

const v = (x) => (x === null || x === undefined ? "—" : x);
const fila = (celdas) => `| ${celdas.map(v).join(" | ")} |`;
const sep = (n) => fila(Array(n).fill("---"));
const si = (b) => (b ? "✓" : "✗");

const md = [
  `# ${corrida === "capacidad" ? "Capacidad" : "Endurance"} — ${caso}`,
  "",
  "Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.",
  "",
  "```",
  meta.trim(),
  "```",
  "",
  `RTT de base (\`GET /\`): conexión reutilizada p50 ${v(rttReutilizada?.p50_ms)} ms, p95 ${v(rttReutilizada?.p95_ms)} ms · conexión nueva ${rttNueva ? `p50 ${rttNueva.p50_ms} ms, p95 ${rttNueva.p95_ms} ms (connect p50 ${v(rttNueva.connect_p50_ms)} ms)` : "— (no se midió en esta corrida)"}.`,
  "",
  "Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.",
  "",
  `## Por fase (por hora de salida, sin los primeros ${RECORTE_S} s ni los últimos ${RECORTE_FIN_S} s de cada fase)`,
  "",
  "Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.",
  "",
  fila(["fase", "nominal", "enviados/s", "respuestas/s", "200/s", "403/s", "503/s", "otros/s", "timeout/s", "conexión/s", "% resp. de lo ofrecido", "% errores propios", "200 p50", "200 p95", "200 p99", "403 p50", "403 p95", "cumple B"]),
  sep(18),
  ...porFase.map((f) =>
    fila([
      f.nombre,
      f.rate,
      f.enviados_por_s,
      f.respuestas_por_s,
      f.por_s["200"],
      f.por_s["403"],
      f.por_s["503"],
      `${f.por_s.otro_4xx} / ${f.por_s.otro_5xx}`,
      f.por_s.timeout,
      f.por_s.conexion,
      f.pct_respuestas_de_ofrecido,
      f.pct_errores_propios,
      f.lat_200.p50,
      f.lat_200.p95,
      f.lat_200.p99,
      f.lat_403.p50,
      f.lat_403.p95,
      f.tipo === "escalon" ? `${si(f.cumple)} (err ${si(f.condiciones.errores)}, resp ${si(f.condiciones.respuestas)}, lat ${si(f.condiciones.latencia)})` : "",
    ])
  ),
  "",
  `Proporciones de ARCA (sobre respuestas): ${porFase.map((f) => `${f.nombre}: 403 ${v(f.pct_403_de_respuestas)} %, 503 ${v(f.pct_503_de_respuestas)} %`).join(" · ")}`,
  "",
  `Motivos de los 503: ${porFase.map((f) => `${f.nombre} \`${JSON.stringify(f.motivos_503)}\``).join(" · ")}`,
  "",
];

if (recursos.length) {
  md.push(
    "## Recursos (docker stats cada 1 s; CPU en % de un núcleo)",
    "",
    fila(["fase", "app CPU máx", "app CPU media", "app mem máx (MiB)", "redis CPU máx", "redis CPU media", "redis mem máx (MiB)", "arca CPU máx", "arca CPU media"]),
    sep(9),
    ...porFase.map((f) =>
      fila([f.nombre, f.recursos?.app.cpu_max, f.recursos?.app.cpu_media, f.recursos?.app.mem_max_mib, f.recursos?.redis.cpu_max, f.recursos?.redis.cpu_media, f.recursos?.redis.mem_max_mib, f.recursos?.arca.cpu_max, f.recursos?.arca.cpu_media])
    ),
    ""
  );
} else {
  md.push("## Recursos", "", "Sin muestreo local. En Azure: los nodos en Datadog (`datadog/`, horas UTC de meta.txt) y Redis, ARCA y el balanceador en `azure-monitor/`.", "");
}

if (resumen.nodos) {
  md.push(
    "## Reparto por nodo (header `X-Node`)",
    "",
    "Sobre las respuestas HTTP (los timeouts y errores de conexión no traen nodo). Latencias de los 200 en ms.",
    "",
    fila(["fase", ...NODOS.flatMap((n) => [`${n} respuestas (%)`, `${n} 200 p50`, `${n} 200 p95`])]),
    sep(1 + 3 * NODOS.length),
    ...porFase.map((f) => fila([f.nombre, ...NODOS.flatMap((n) => [`${f.por_nodo[n].respuestas} (${v(f.por_nodo[n].pct)} %)`, f.por_nodo[n].p50_200, f.por_nodo[n].p95_200])])),
    ""
  );
}

if (resumen.throughput_sostenido) {
  const t = resumen.throughput_sostenido;
  md.push(
    "## Throughput sostenido",
    "",
    `- **B = ${v(t.B_pedidos_por_s)} pedidos/s** (p95 de referencia del primer escalón: ${v(t.p95_ref_ms)} ms; tope de latencia: ${P95_REF === null ? "—" : 2 * P95_REF} ms).`,
    t.primer_escalon_que_no_cumple
      ? `- Primer escalón que no cumple: ${t.primer_escalon_que_no_cumple.rate} pedidos/s (errores ${si(t.primer_escalon_que_no_cumple.condiciones.errores)}, respuestas ${si(t.primer_escalon_que_no_cumple.condiciones.respuestas)}, latencia ${si(t.primer_escalon_que_no_cumple.condiciones.latencia)}).`
      : "- Todos los escalones cumplen.",
    t.B_es_el_escalon_mas_alto ? "- **B es el escalón más alto: el límite real está más arriba, agregar escalones y repetir.**" : "",
    t.no_monotono ? "- Ojo: hay escalones que cumplen por encima de uno que no cumple." : "",
    ""
  );
}
if (resumen.recuperacion) {
  const r = resumen.recuperacion;
  md.push(
    "## Recuperación (bajada)",
    "",
    `Bajada a ${r.rate_bajada} pedidos/s. Umbral: p95 de los 200 ≤ ${v(r.umbral_p95_ms)} ms y sin errores propios en una ventana de 5 s.`,
    "",
    `**Recuperación: ${r.segundos === null ? "no se recuperó dentro de la bajada" : `${r.segundos} s`}.**`,
    "",
    fila(["desde la bajada (s)", "enviados", "errores propios", "p95 200 (ms)"]),
    sep(4),
    ...r.ventanas.map((w) => fila([w.desde_bajada_s, w.enviados, w.errores_propios, w.p95_200])),
    ""
  );
}
if (resumen.endurance) {
  const e = resumen.endurance;
  md.push(
    "## Endurance",
    "",
    ...Object.entries(e.pendiente_p95).map(([f, r]) => `- Pendiente del p95 de los 200 en ${f}: ${r ? `${r.pendiente_ms_por_min} ms/min (R² ${v(r.r2)}, ${r.n} minutos)` : "—"}.`),
    ...Object.entries(e.memoria).map(([f, m]) => `- Memoria en ${f}: app ${v(m.inicio_mib.app)} → ${v(m.fin_mib.app)} MiB, redis ${v(m.inicio_mib.redis)} → ${v(m.fin_mib.redis)} MiB (mediana de las 10 primeras y 10 últimas muestras).`),
    "",
    fila(["minuto", "fase", "enviados", "errores propios", "200 p50", "200 p95", "app mem (MiB)", "redis mem (MiB)"]),
    sep(8),
    ...e.minutos.map((m) => fila([m.minuto, m.fase, m.enviados, m.errores_propios, m.p50_200, m.p95_200, m.mem_app_mib, m.mem_redis_mib])),
    ""
  );
  if (resumen.nodos) {
    md.push(
      "### Por minuto y nodo",
      "",
      fila(["minuto", ...NODOS.flatMap((n) => [`${n} respuestas (%)`, `${n} 200 p95`])]),
      sep(1 + 2 * NODOS.length),
      ...e.minutos.map((m) => fila([m.minuto, ...NODOS.flatMap((n) => [`${m.por_nodo[n].respuestas} (${v(m.por_nodo[n].pct)} %)`, m.por_nodo[n].p95_200])])),
      ""
    );
  }
}
md.push(
  "## Control contra Artillery",
  "",
  `Códigos: \`${JSON.stringify(resumen.artillery.codigos)}\` · errores: \`${JSON.stringify(resumen.artillery.errores)}\``,
  "",
  `\`http.response_time\` de Artillery (toda la corrida, ms): 2xx \`${JSON.stringify(resumen.artillery.response_time_2xx)}\` · 4xx \`${JSON.stringify(resumen.artillery.response_time_4xx)}\``,
  "",
  `Escenarios creados: ${v(resumen.artillery.escenarios_creados)}, fallidos: ${v(resumen.artillery.escenarios_fallidos)}, líneas en pedidos.jsonl: ${pedidos.length}.`,
  ""
);

// observaciones escritas a mano (lo que los crudos no explican solos): se copian tal cual al final
const observaciones = leer("observaciones.md");
if (observaciones) md.push("## Observaciones (de `observaciones.md`, escritas a mano)", "", observaciones.trim(), "");

fs.writeFileSync(path.join(dir, "resumen.md"), md.filter((l, k, a) => !(l === "" && a[k - 1] === "")).join("\n"));
console.log(md.join("\n"));
