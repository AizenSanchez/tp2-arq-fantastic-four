//client for the ARCA service: says if a DNI can trade foreign currency (POST /validar)

//ARCA could not decide: motivo is timeout, conexion, http_5xx, http_4xx or respuesta_invalida
export class ArcaUnavailableError extends Error {
  constructor(motivo, { intentos, ms, status } = {}) {
    super(`ARCA no disponible (${motivo})`);
    this.motivo = motivo;
    this.intentos = intentos;
    this.ms = ms;
    //http_4xx is a 502 for our client (ARCA refused our request), anything else a 503
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createArcaClient({ baseUrl, timeoutMs, retries, retryDelayMs, fetchFn = fetch }) {
  //one HTTP call, returns { ok, codigoAutorizacion } or throws { motivo }
  async function callOnce(dni) {
    let response;
    try {
      response = await fetchFn(`${baseUrl}/validar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dni }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      throw { motivo: timeout ? "timeout" : "conexion" };
    }

    if (response.status >= 500) throw { motivo: "http_5xx" };
    if (response.status >= 400) throw { motivo: "http_4xx" };

    let body;
    try {
      body = await response.json();
    } catch {
      throw { motivo: "respuesta_invalida" };
    }

    //valid: ok is a boolean, and an approval comes with its code
    if (typeof body?.ok !== "boolean" || (body.ok && typeof body.codigoAutorizacion !== "string")) {
      throw { motivo: "respuesta_invalida" };
    }

    return { ok: body.ok, codigoAutorizacion: body.ok ? body.codigoAutorizacion : null };
  }

  return {
    //returns { ok, codigoAutorizacion, intentos, ms }, throws ArcaUnavailableError
    //retries only connection errors and 5xx: a timeout already cost the whole timeout, a 4xx or ok:false will not change
    async validate(dni) {
      const start = process.hrtime.bigint();
      const elapsed = () => Number(process.hrtime.bigint() - start) / 1e6;

      for (let intentos = 1; ; intentos++) {
        try {
          return { ...(await callOnce(dni)), intentos, ms: elapsed() };
        } catch (err) {
          const retryable = err.motivo === "conexion" || err.motivo === "http_5xx";
          if (!retryable || intentos > retries) {
            throw new ArcaUnavailableError(err.motivo, {
              intentos,
              ms: elapsed(),
              status: err.motivo === "http_4xx" ? 502 : 503,
            });
          }
          await sleep(retryDelayMs);
        }
      }
    },
  };
}
