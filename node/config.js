import fs from "fs";

// infra.json lo escribe terraform al crear la infraestructura (ignorado por git, tiene credenciales).
// Formato: { "arcaUri": "http://10.0.4.4:8080", "redisUrl": "rediss://:<clave codificada>@<host>:10000" }
function readInfra() {
  try {
    return JSON.parse(fs.readFileSync(`${import.meta.dirname}/infra.json`, "utf8"));
  } catch {
    return {};
  }
}

const infra = readInfra();
const env = process.env;

// precedencia: variable de entorno > infra.json > default
export default {
  port: Number(env.PORT || 3000),
  stateAdapter: env.STATE_ADAPTER || "redis",
  stateDir: env.STATE_DIR || `${import.meta.dirname}/state`,
  redisUrl: env.REDIS_URL || infra.redisUrl,
  arcaUri: env.ARCA_URI || infra.arcaUri,
  // 1000 ms por intento; 1 reintento (solo ante error de conexion o 5xx) con 100 ms de espera
  arcaTimeoutMs: Number(env.ARCA_TIMEOUT_MS || 1000),
  arcaRetries: Number(env.ARCA_RETRIES ?? 1),
  arcaRetryDelayMs: Number(env.ARCA_RETRY_DELAY_MS ?? 100),
  idempotencyTtlMs: Number(env.IDEMPOTENCY_TTL_MS || 10 * 60 * 1000),
  // el agente de Datadog de cada nodo escucha statsd en 127.0.0.1:8125
  metricsAdapter: env.METRICS_ADAPTER || "statsd",
  statsdHost: env.STATSD_HOST || "127.0.0.1",
  statsdPort: Number(env.STATSD_PORT || 8125),
  metricsPrefix: env.METRICS_PREFIX || "arvault.exchange",
};
