#!/usr/bin/env node
// Captura de pantalla del dashboard "TP2 arVault" (perf/datadog/tp2-arvault.json, el mismo de los bloques 2 y 4) en
// el rango de cada corrida del bloque 1, con la variable test del tablero en exchange-<corrida> y host en *.
//   DD_DASHBOARD_ID=<id del tablero en tu cuenta> node perf/capacidad/capturar-dashboard.cjs [<caso>/<corrida>]
// Sin argumento captura las cuatro corridas de Azure. Deja perf/results/<caso>/exchange-<corrida>/datadog/
// dashboard-tp2-arvault.png.
//
// Abre Chromium con ventana (Playwright, que viene con Artillery en perf/node_modules) en el dashboard: la primera
// vez pide iniciar sesion en Datadog a mano y la sesion queda en DD_PERFIL (fuera del repo). No usa keys.
// El tablero se importa antes en la cuenta con POST /api/v1/dashboard y el JSON del repo.
// CHROMIUM: ruta a un Chromium si el de Playwright no esta instalado. La zona horaria del navegador es la de la
// cuenta (Buenos Aires) para que Datadog no tape el tablero con el aviso de cambio de zona: las horas del PNG son UTC-3.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const SITIO = process.env.DD_SITIO ?? "https://us5.datadoghq.com";
const DASH = process.env.DD_DASHBOARD_ID;
const PERFIL = process.env.DD_PERFIL ?? path.join(os.tmpdir(), "perfil-datadog");
const ANCHO = 2560; // con menos ancho los widgets quedan chicos
const CORRIDAS = ["azure-1-nodo/capacidad", "azure-1-nodo/endurance", "azure-escalado/capacidad", "azure-escalado/endurance"];
if (!DASH) {
  console.error("falta DD_DASHBOARD_ID (el id del tablero TP2 arVault en tu cuenta de Datadog)");
  process.exit(2);
}
const elegidas = process.argv[2] ? [process.argv[2]] : CORRIDAS;

(async () => {
  const ctx = await chromium.launchPersistentContext(PERFIL, {
    headless: false,
    executablePath: process.env.CHROMIUM,
    viewport: { width: ANCHO, height: 1000 },
    timezoneId: "America/Argentina/Buenos_Aires",
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${SITIO}/dashboard/${DASH}`);
  console.log("si pide login, iniciar sesion en la ventana (espera hasta 30 min)");
  const limite = Date.now() + 30 * 60000;
  while (!page.url().includes(`/dashboard/${DASH}`) || page.url().includes("login")) {
    if (Date.now() > limite) throw new Error("no hubo login en 30 min");
    await page.waitForTimeout(2000);
  }

  for (const elegida of elegidas) {
    const [caso, corrida] = elegida.split("/");
    const dir = path.join(RAIZ, "perf/results", caso, `exchange-${corrida}`);
    const meta = fs.readFileSync(path.join(dir, "meta.txt"), "utf8");
    // la corrida de meta.txt, con 1 min antes y despues
    const desde = Date.parse(meta.match(/^inicio UTC: (\S+)/m)[1]) - 60000;
    const hasta = Date.parse(meta.match(/^fin UTC: (\S+)/m)[1]) + 60000;
    const url = `${SITIO}/dashboard/${DASH}?from_ts=${desde}&to_ts=${hasta}&live=false&tpl_var_test[0]=exchange-${corrida}&tpl_var_host[0]=*`;
    await page.setViewportSize({ width: ANCHO, height: 1000 });
    await page.goto(url, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
    // agrandar la ventana hasta la altura del tablero para que se rendericen todos los widgets
    const alto = await page.evaluate(() => Math.max(...[...document.querySelectorAll("*")].map((e) => e.scrollHeight)));
    await page.setViewportSize({ width: ANCHO, height: Math.min(Math.max(alto, 1000), 6000) });
    await page.waitForTimeout(15000);
    const salida = path.join(dir, "datadog", "dashboard-tp2-arvault.png");
    await page.screenshot({ path: salida, fullPage: true });
    console.log(`  ${path.relative(RAIZ, salida)}`);
  }
  await ctx.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
