import express from "express";
import connectDatadog from "connect-datadog";
import dogstatsd from "node-dogstatsd";

import {
  init as exchangeInit,
  getAccounts,
  setAccountBalance,
  getRates,
  setRate,
  getLog,
  getAudit,
  exchange,
  recordArcaRefusal,
  isKnownCurrency,
  isKnownAccount,
  isSupportedPair,
} from "./exchange.js";
import { createFileAdapter } from "./repository/file-adapter.js";
import { createRedisAdapter } from "./repository/redis-adapter.js";
import { InsufficientFundsError } from "./errors.js";
import { createIdempotencyMiddleware, createMemoryStore, createRedisStore } from "./idempotency.js";
import { ArcaUnavailableError, createArcaClient } from "./arca.js";
import { neverThrow } from "./metrics/metrics.js";
import { createStatsdMetrics } from "./metrics/statsd-adapter.js";
import { createNullMetrics } from "./metrics/null-adapter.js";
import config from "./config.js";

if (config.stateAdapter == "redis" && !config.redisUrl) {
  throw new Error("no Redis url: set REDIS_URL or node/infra.json (written by terraform)");
}
if (!config.arcaUri) {
  throw new Error("no ARCA uri: set ARCA_URI or node/infra.json (written by terraform)");
}

const repository =
  config.stateAdapter == "redis"
    ? await createRedisAdapter(config.redisUrl)
    : await createFileAdapter({ dir: config.stateDir });

const metrics =
  config.metricsAdapter == "statsd"
    ? createStatsdMetrics({ host: config.statsdHost, port: config.statsdPort, prefix: config.metricsPrefix })
    : createNullMetrics();
const guardedMetrics = neverThrow(metrics, (err) => console.error("metrics:", err));

exchangeInit(repository, guardedMetrics);

const idempotencyStore = config.stateAdapter == "redis" ? await createRedisStore(config.redisUrl) : createMemoryStore();
const idempotency = createIdempotencyMiddleware({ store: idempotencyStore, ttlMs: config.idempotencyTtlMs });
const arca = createArcaClient({
  baseUrl: config.arcaUri,
  timeoutMs: config.arcaTimeoutMs,
  retries: config.arcaRetries,
  retryDelayMs: config.arcaRetryDelayMs,
});
metrics.start((await getAccounts()).map((account) => account.currency));

const app = express();

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    guardedMetrics.requestFinished({
      method: req.method,
      route: req.route?.path,
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - start) / 1e6,
    });
  });
  next();
});

//standard HTTP metrics of the Datadog integration (the teacher asked for it), next to our own http.* ones
if (config.metricsAdapter == "statsd") {
  app.use(
    connectDatadog({
      dogstatsd: new dogstatsd.StatsD(config.statsdHost, config.statsdPort),
      stat: `${config.metricsPrefix}.express`,
      method: true,
      response_code: true,
    })
  );
}

app.use(express.json());

const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// root: no ARCA, no Redis. It is what the network baseline latency is measured against

app.get("/", (req, res) => {
  res.status(200).send("Server is up.");
});

// HEALTH endpoint (ping/echo): answers only while the process is serving requests and the state store answers

app.get("/health", asyncHandler(async (req, res) => {
  const ok = await repository.ping().catch(() => false);
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "state store not available", uptime: process.uptime() });
}));

// VALIDATION (parameter typing / fence): se rechaza el pedido antes de ejecutar nada,
// indicando el primer campo inválido

const isPositiveNumber = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isCurrencyCode = (v) => typeof v === "string" && /^[A-Z]{3}$/.test(v);
//DNI as text, 7 or 8 digits: from 1000000 to 99999999 (a number is converted to text before this check)
const isDni = (v) => typeof v === "string" && /^[1-9][0-9]{6,7}$/.test(v);
const isAccountId = (v) => (typeof v === "string" && v.length > 0) || Number.isInteger(v);

async function validateExchange(body) {
  const { baseCurrency, counterCurrency, baseAccountId, counterAccountId, baseAmount, dni } = body;
  if (!isDni(dni)) return "dni must be a string with a number from 1000000 to 99999999";
  if (!isCurrencyCode(baseCurrency)) return "baseCurrency must be a 3-letter currency code";
  if (!isCurrencyCode(counterCurrency)) return "counterCurrency must be a 3-letter currency code";
  if (baseCurrency === counterCurrency) return "baseCurrency and counterCurrency must be different";
  if (!(await isSupportedPair(baseCurrency, counterCurrency)))
    return `exchange ${baseCurrency}->${counterCurrency} is not supported`;
  if (!isPositiveNumber(baseAmount)) return "baseAmount must be a positive number";
  if (!isAccountId(baseAccountId)) return "baseAccountId is required";
  if (!isAccountId(counterAccountId)) return "counterAccountId is required";
  return null;
}

async function validateRate(body) {
  const { baseCurrency, counterCurrency, rate } = body;
  if (!(await isKnownCurrency(baseCurrency))) return "baseCurrency must be a currency with an internal account";
  if (!(await isKnownCurrency(counterCurrency))) return "counterCurrency must be a currency with an internal account";
  if (baseCurrency === counterCurrency) return "baseCurrency and counterCurrency must be different";
  if (!isPositiveNumber(rate)) return "rate must be a positive number";
  return null;
}

//user authenticated by vaultSec
const actorOf = (req) => req.get("X-Authenticated-User") ?? null;

// ACCOUNT endpoints

app.get("/accounts", asyncHandler(async (req, res) => {
  res.json(await getAccounts());
}));

app.put("/accounts/:id/balance", asyncHandler(async (req, res) => {
  const accountId = req.params.id;
  const { balance } = req.body;

  if (!(await isKnownAccount(accountId))) {
    return res.status(404).json({ error: `account ${accountId} not found` });
  }
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) {
    return res.status(400).json({ error: "balance must be a non-negative number" });
  }

  await setAccountBalance(accountId, balance, actorOf(req));

  res.json(await getAccounts());
}));

// RATE endpoints

app.get("/rates", asyncHandler(async (req, res) => {
  res.json(await getRates());
}));

app.put("/rates", asyncHandler(async (req, res) => {
  const error = await validateRate(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const newRateRequest = { ...req.body };
  await setRate(newRateRequest, actorOf(req));

  res.json(await getRates());
}));

// LOG endpoint

//GET /log?last=N answers only the newest N entries: with thousands of entries the full log is too big
app.get("/log", asyncHandler(async (req, res) => {
  if (req.query.last === undefined) {
    return res.json(await getLog());
  }
  if (!/^[1-9][0-9]{0,5}$/.test(String(req.query.last))) {
    return res.status(400).json({ error: "last must be a positive integer" });
  }
  res.json(await getLog({ last: Number(req.query.last) }));
}));

app.get("/audit", asyncHandler(async (req, res) => {
  res.json(await getAudit());
}));

// EXCHANGE endpoint

// order (plan, section 3.1): idempotency -> validation -> ARCA -> exchange.
// ARCA goes before the funds are reserved, so a refusal leaves nothing to undo

async function validateBody(req, res, next) {
  //until ARCA answers nothing is decided, so a failure up to there lets the client retry with the same key
  res.locals.retryable = true;
  if (typeof req.body?.dni === "number" && Number.isSafeInteger(req.body.dni)) {
    req.body.dni = String(req.body.dni);
  }
  const error = await validateExchange(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  next();
}

//one JSON line per validation in stdout (pm2 keeps it): this is the ARCA evidence
function logArcaValidation({ dni, resultado, codigoAutorizacion, intentos, ms, motivo }) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      evento: "arca_validacion",
      dni,
      resultado,
      codigoAutorizacion: codigoAutorizacion ?? null,
      intentos,
      ms: Math.round(ms),
      ...(motivo && { motivo }),
    })
  );
}

async function checkArca(req, res, next) {
  const { dni } = req.body;
  const actor = actorOf(req);
  let validation;

  try {
    validation = await arca.validate(dni);
  } catch (err) {
    if (!(err instanceof ArcaUnavailableError)) throw err;

    guardedMetrics.arcaFinished({ resultado: "error", motivo: err.motivo, intentos: err.intentos, ms: err.ms });
    logArcaValidation({ dni, resultado: "error", intentos: err.intentos, ms: err.ms, motivo: err.motivo });
    await recordArcaRefusal({ ...req.body }, actor, { ok: false, codigoAutorizacion: null, intentos: err.intentos, motivo: err.motivo }, err.message);

    if (err.status === 502) {
      return res.status(502).json({ error: "ARCA rechazó el pedido", motivo: err.motivo });
    }
    return res.status(503).set("Retry-After", "1").json({ error: "ARCA no disponible", motivo: err.motivo });
  }

  res.locals.retryable = false;
  const resultado = validation.ok ? "aprobado" : "rechazado";
  guardedMetrics.arcaFinished({ resultado, intentos: validation.intentos, ms: validation.ms });
  logArcaValidation({ dni, resultado, codigoAutorizacion: validation.codigoAutorizacion, intentos: validation.intentos, ms: validation.ms });

  const arcaResult = { ok: validation.ok, codigoAutorizacion: validation.codigoAutorizacion, intentos: validation.intentos };

  if (!validation.ok) {
    const refusal = await recordArcaRefusal({ ...req.body }, actor, arcaResult, "DNI con restricciones fiscales (ARCA)");
    guardedMetrics.exchangeRejected();
    return res.status(403).json(refusal);
  }

  req.arca = arcaResult;
  next();
}

app.post("/exchange", asyncHandler(idempotency), asyncHandler(validateBody), asyncHandler(checkArca), asyncHandler(async (req, res) => {
  const exchangeRequest = { ...req.body };
  const exchangeResult = await exchange(exchangeRequest, actorOf(req), req.arca);

  if (exchangeResult.ok) {
    res.status(200).json(exchangeResult);
  } else {
    res.status(500).json(exchangeResult);
  }
}));

// errores de cualquier handler: JSON sin stack trace (el detalle queda en el log del servidor)
app.use((err, req, res, next) => {
  if (err instanceof InsufficientFundsError) {
    return res.status(422).json(err.exchangeResult);
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "body must be valid JSON" });
  }
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} failed:`, err);
  res.status(500).json({ error: "internal error" });
});

// red de seguridad: una promesa rechazada fuera de un handler se registra pero no termina el proceso
process.on("unhandledRejection", (err) => {
  console.error(`[${new Date().toISOString()}] unhandled rejection:`, err);
});

const server = app.listen(config.port, () => {
  console.log(`Exchange API listening on port ${server.address().port}`);
});

//graceful shutdown
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);

  await repository.close();
  await idempotencyStore.close();
  metrics.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
export { server };
