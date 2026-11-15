import { test } from "node:test";
import assert from "node:assert/strict";

import { ArcaUnavailableError, createArcaClient } from "../arca.js";

//fetchFn that answers from a list, one item per call: a Response-like object or an error to throw
function arcaWith(answers, options = {}) {
  let calls = 0;
  const fetchFn = async () => {
    const answer = answers[Math.min(calls++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const arca = createArcaClient({ baseUrl: "http://arca", timeoutMs: 100, retries: 1, retryDelayMs: 1, fetchFn, ...options });
  return { arca, calls: () => calls };
}

const reply = (status, body) => ({ status, json: async () => (body instanceof Error ? Promise.reject(body) : body) });
const approved = reply(200, { ok: true, codigoAutorizacion: "abc" });
const rejected = reply(200, { ok: false, codigoAutorizacion: null });
const timeoutError = Object.assign(new Error("timeout"), { name: "TimeoutError" });
const connectionError = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

test("approved: returns the authorization code", async () => {
  const { arca, calls } = arcaWith([approved]);
  const result = await arca.validate("40101235");
  assert.equal(result.ok, true);
  assert.equal(result.codigoAutorizacion, "abc");
  assert.equal(result.intentos, 1);
  assert.equal(calls(), 1);
});

test("rejected (ok:false) is an answer: no retry", async () => {
  const { arca, calls } = arcaWith([rejected]);
  const result = await arca.validate("40101235");
  assert.equal(result.ok, false);
  assert.equal(calls(), 1);
});

test("timeout: fails without retry", async () => {
  const { arca, calls } = arcaWith([timeoutError]);
  await assert.rejects(arca.validate("40101235"), (err) => err instanceof ArcaUnavailableError && err.motivo === "timeout" && err.status === 503);
  assert.equal(calls(), 1);
});

test("5xx then approved: one retry saves the request", async () => {
  const { arca, calls } = arcaWith([reply(500, {}), approved]);
  const result = await arca.validate("40101235");
  assert.equal(result.ok, true);
  assert.equal(result.intentos, 2);
  assert.equal(calls(), 2);
});

test("5xx twice: unavailable after the retries", async () => {
  const { arca, calls } = arcaWith([reply(500, {})]);
  await assert.rejects(arca.validate("40101235"), (err) => err.motivo === "http_5xx" && err.intentos === 2 && err.status === 503);
  assert.equal(calls(), 2);
});

test("connection error is retried", async () => {
  const { arca, calls } = arcaWith([connectionError, approved]);
  assert.equal((await arca.validate("40101235")).intentos, 2);
  assert.equal(calls(), 2);
});

test("4xx: ArcaUnavailableError with status 502, no retry", async () => {
  const { arca, calls } = arcaWith([reply(400, {})]);
  await assert.rejects(arca.validate("40101235"), (err) => err.motivo === "http_4xx" && err.status === 502);
  assert.equal(calls(), 1);
});

test("invalid answers: ok not boolean, approval without code, body that is not JSON", async () => {
  for (const answer of [reply(200, { ok: "si" }), reply(200, { ok: true }), reply(200, new Error("not json"))]) {
    const { arca, calls } = arcaWith([answer]);
    await assert.rejects(arca.validate("40101235"), (err) => err.motivo === "respuesta_invalida");
    assert.equal(calls(), 1);
  }
});

test("retries = 0 never retries", async () => {
  const { arca, calls } = arcaWith([reply(500, {})], { retries: 0 });
  await assert.rejects(arca.validate("40101235"), ArcaUnavailableError);
  assert.equal(calls(), 1);
});
