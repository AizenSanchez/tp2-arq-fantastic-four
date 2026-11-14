import fs from "fs";

//lo escribe terraform (node.tf); los tests y el compose local usan variables de entorno
function readInfra() {
  try {
    return JSON.parse(fs.readFileSync(`${import.meta.dirname}/infra.json`, "utf8"));
  } catch (err) {
    if (err.code == "ENOENT") return {};
    throw err;
  }
}

const infra = readInfra();
const env = process.env;

export default {
  port: Number(env.PORT || 3000),
  stateAdapter: env.STATE_ADAPTER || "redis",
  stateDir: env.STATE_DIR || `${import.meta.dirname}/state`,
  redisUrl: env.REDIS_URL || infra.redisUrl,
  arcaUri: env.ARCA_URI || infra.arcaUri,
  arcaTimeoutMs: Number(env.ARCA_TIMEOUT_MS || 1000),
  arcaRetries: Number(env.ARCA_RETRIES ?? 1),
  arcaRetryDelayMs: Number(env.ARCA_RETRY_DELAY_MS ?? 100),
  idempotencyTtlMs: Number(env.IDEMPOTENCY_TTL_MS || 10 * 60 * 1000),
  metricsAdapter: env.METRICS_ADAPTER || "statsd",
  statsdHost: env.STATSD_HOST || "127.0.0.1", //el agente de Datadog del nodo
  statsdPort: Number(env.STATSD_PORT || 8125),
  metricsPrefix: env.METRICS_PREFIX || "arvault.exchange",
};
