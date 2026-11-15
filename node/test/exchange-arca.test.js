//the whole POST /exchange flow with a fake ARCA, over the file adapter: it never touches Redis or Azure
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, cp, rm, chmod, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let server;
let baseUrl;
let stateDir;
let arcaServer;
let arcaCalls;
let arcaMode;

//arcaMode: "approve" | "reject" | "500" | "400" | "flaky" (500 the first time, then approve)
before(async () => {
  arcaServer = http.createServer((req, res) => {
    arcaCalls++;
    res.setHeader("content-type", "application/json");
    if (arcaMode === "500" || (arcaMode === "flaky" && arcaCalls === 1)) return res.writeHead(500).end();
    if (arcaMode === "400") return res.writeHead(400).end("{}");
    res.end(JSON.stringify(arcaMode === "reject" ? { ok: false, codigoAutorizacion: null } : { ok: true, codigoAutorizacion: "cod-123" }));
  });
  await new Promise((resolve) => arcaServer.listen(0, resolve));

  stateDir = await mkdtemp(path.join(tmpdir(), "arvault-arca-"));
  await cp(path.join(import.meta.dirname, "../state"), stateDir, { recursive: true });
  Object.assign(process.env, {
    STATE_ADAPTER: "file",
    STATE_DIR: stateDir,
    ARCA_URI: `http://localhost:${arcaServer.address().port}`,
    ARCA_RETRY_DELAY_MS: "1",
    METRICS_ADAPTER: "null",
    PORT: "0",
  });

  ({ server } = await import("../app.js"));
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  arcaServer.close();
  await rm(stateDir, { recursive: true, force: true });
});

const body = (extra = {}) => ({
  baseCurrency: "ARS",
  counterCurrency: "USD",
  baseAmount: 1000,
  baseAccountId: 101,
  counterAccountId: 102,
  dni: "40101235",
  ...extra,
});

async function exchange(payload, headers = {}) {
  const response = await fetch(`${baseUrl}/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status, headers: response.headers, json: await response.json() };
}

const reset = (mode) => {
  arcaMode = mode;
  arcaCalls = 0;
};

test("GET / answers without ARCA", async () => {
  reset("500");
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "Server is up.");
  assert.equal(arcaCalls, 0);
});

test("approved: 200, with the ARCA code in the answer", async () => {
  reset("approve");
  const { status, json } = await exchange(body());
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.arca, { ok: true, codigoAutorizacion: "cod-123", intentos: 1 });
});

test("ARCA rejects: 403, logged with ok:false, nothing reserved", async () => {
  reset("reject");
  const before = await (await fetch(`${baseUrl}/accounts`)).json();
  const { status, json } = await exchange(body());
  assert.equal(status, 403);
  assert.equal(json.ok, false);
  assert.equal(json.obs, "DNI con restricciones fiscales (ARCA)");
  assert.deepEqual(await (await fetch(`${baseUrl}/accounts`)).json(), before);
  const last = (await (await fetch(`${baseUrl}/log`)).json()).at(-1);
  assert.equal(last.id, json.id);
});

test("ARCA 5xx once: the retry saves it and the request is 200", async () => {
  reset("flaky");
  const { status, json } = await exchange(body());
  assert.equal(status, 200);
  assert.equal(json.arca.intentos, 2);
});

test("ARCA 5xx twice: 503 with Retry-After, logged, and the key is free for a retry", async () => {
  reset("500");
  const first = await exchange(body(), { "idempotency-key": "arca-down" });
  assert.equal(first.status, 503);
  assert.equal(first.headers.get("retry-after"), "1");
  assert.deepEqual(first.json, { error: "ARCA no disponible", motivo: "http_5xx" });
  assert.equal(arcaCalls, 2);

  const last = (await (await fetch(`${baseUrl}/log`)).json()).at(-1);
  assert.equal(last.ok, false);
  assert.equal(last.arca.motivo, "http_5xx");

  reset("approve");
  const retry = await exchange(body(), { "idempotency-key": "arca-down" });
  assert.equal(retry.status, 200);
});

test("ARCA answers 4xx: 502", async () => {
  reset("400");
  const { status, json } = await exchange(body());
  assert.equal(status, 502);
  assert.deepEqual(json, { error: "ARCA rechazó el pedido", motivo: "http_4xx" });
});

test("invalid or missing DNI: 400 and ARCA is not called", async () => {
  reset("approve");
  for (const dni of [undefined, "", "abc", "999999", "100000000", "0123456", 40101235, 1.5, null]) {
    const { status } = await exchange(body({ dni }));
    assert.equal(status, 400, `dni ${JSON.stringify(dni)}`);
  }
  assert.equal(arcaCalls, 0);
});

test("a 500 after ARCA approved is saved: the retry does not move the funds again", async () => {
  reset("approve");
  const logFile = path.join(stateDir, "log.jsonl");
  await appendFile(logFile, "");
  await chmod(logFile, 0o444);
  let first;
  try {
    first = await exchange(body(), { "idempotency-key": "log-down" });
  } finally {
    await chmod(logFile, 0o644);
  }
  assert.equal(first.status, 500);
  const accounts = await (await fetch(`${baseUrl}/accounts`)).json();

  const retry = await exchange(body(), { "idempotency-key": "log-down" });
  assert.equal(retry.status, 500);
  assert.equal(arcaCalls, 1);
  assert.deepEqual(await (await fetch(`${baseUrl}/accounts`)).json(), accounts);
});
