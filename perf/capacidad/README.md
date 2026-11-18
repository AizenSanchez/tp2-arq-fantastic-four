# Pruebas de capacidad y endurance (bloque 1)

Los cuatro escenarios de capacidad del TP 1 se juntan en dos corridas. Las fases no están fijas en los YAML: las
arma `correr.mjs` con `--overrides` a partir de variables de entorno. Las predicciones están en
[`../predicciones/capacidad.md`](../predicciones/capacidad.md) y se commitean y pushean **antes** de medir en Azure.

## Corrida A — `capacidad` (E1 breakpoint + E2 stress)

| Fase | Tasa (pedidos/s) | Duración | Escenario del TP 1 | Qué mide |
|---|---|---|---|---|
| escalones | `ESCALONES` (10, 20, 40, 80, 120, 160, 240, 320, 480, 640) | `DURACION_ESCALON` (60 s) cada uno | E1 breakpoint | Throughput sostenido B: el escalón más alto que cumple el criterio |
| escalones por encima de B | los que no cumplen | ídem | E2 stress | Qué falla primero: timeouts, 503 de ARCA o latencia |
| bajada | `BAJADA` (20) | `DURACION_BAJADA` (120 s) | E2 stress (recuperación) | Si el sistema vuelve solo y en cuánto tiempo |

En el TP 1, E1 eran escalones de 160 a 1.120 req/s con B = 800 (api con 1 CPU detrás de nginx). Acá se empieza más
abajo porque cada pedido hace una llamada a ARCA y dos transferencias simuladas (~1 s por pedido aprobado).

## Corrida B — `endurance` (E5 + E6)

| Fase | Tasa (pedidos/s) | Duración | Escenario del TP 1 | Qué mide |
|---|---|---|---|---|
| endurance | `RATE_ENDURANCE` (~0,5 · B) | `DURACION_ENDURANCE` (600 s) | E5 (160 req/s × 10 min) | Si el p95 crece con el tiempo y qué pasa con la memoria |
| tramo | `RATE_TRAMO` (~B) | `DURACION_TRAMO` (180 s) | E6 (320 req/s × 3 min) | Si B se sostiene después de 10 min de carga |

`RATE_ENDURANCE` y `RATE_TRAMO` no tienen valor por defecto: dependen del B medido en la corrida A, y el script
aborta si faltan. En el TP 1 el p95 crecía con el log en memoria; ahora el log está en Redis.

## Criterios (los aplica `analizar.mjs`)

- Cada pedido cuenta en la fase en que **salió**. De cada fase se descartan los primeros 5 s y los últimos 2 s
  (el instante 0 es el primer pedido, que Artillery lanza hasta ~1 s después del inicio real de la fase).
- **Error propio**: timeout, error de conexión o un 5xx que no es el 503 de ARCA (`"ARCA no disponible"`).
- **B**: el escalón más alto con errores propios < 1 %, respuestas HTTP ≥ 95 % de lo ofrecido (tasa nominal × segundos)
  y p95 de los 200 ≤ 2 × el p95 de los 200 del primer escalón.
- **Recuperación**: desde el inicio de la bajada hasta la primera ventana de 5 s con p95 de los 200 ≤ 1,2 × el del
  primer escalón y sin errores propios.
- **Endurance**: p95 de los 200 por minuto y pendiente de la regresión lineal (ms/min) en cada fase.

## Uso

```bash
cd perf && npm ci && cd ..                                         # una vez

# local, con los límites de la VM (app 1 CPU y 2 GiB) y de ACI (arca 0,5 CPU)
docker compose -f docker-compose.local.yml -f perf/capacidad/docker-compose.capacidad.yml up -d --build
CONEXION=local node perf/capacidad/correr.mjs capacidad local-1-nodo
RATE_ENDURANCE=<0,5·B> RATE_TRAMO=<B> CONEXION=local node perf/capacidad/correr.mjs endurance local-1-nodo

# ensayo corto (perf/results/prueba-* no se commitea)
ESCALONES=5,10 DURACION_ESCALON=15 DURACION_BAJADA=15 node perf/capacidad/correr.mjs capacidad prueba-capacidad

# Azure (con las predicciones ya pusheadas)
read -s DATADOG_API_KEY; export DATADOG_API_KEY                   # nunca en un archivo
export CONEXION=cable                                              # o wifi, queda en meta.txt
ESCALONES=10,20,40,80,120,160,200,240,320 node perf/capacidad/correr.mjs capacidad azure-1-nodo --env azure
RATE_ENDURANCE=<0,5·B> RATE_TRAMO=<B> node perf/capacidad/correr.mjs endurance azure-1-nodo --env azure

# volver a analizar sin correr
node perf/capacidad/analizar.mjs <caso> <capacidad|endurance>
```

Después de cada corrida en Azure, las series y los gráficos de Datadog (métricas `artillery.*` de la corrida y CPU y
memoria del nodo `tp2vmss000000`) se bajan a `datadog/` con:

```bash
read -s DD_APP_KEY; export DD_APP_KEY                             # además de DATADOG_API_KEY; nunca en un archivo
node perf/capacidad/capturar-datadog.mjs azure-1-nodo capacidad   # o endurance
```

Variables: `TARGET` (por defecto `localhost:3000` o `node/lb_dns`), `RESET_CMD` (por defecto `reset-state.js` en el
contenedor, o `ansible/reset.sh` en Azure), `CONEXION`, `DATADOG_API_KEY` (solo Azure, solo por entorno),
`DATADOG_API_HOST` (`us5.datadoghq.com`), `AZURE_GRUPO` (`tp2_resource_group`), `AZURE_MONITOR_ESPERA_S` (180) y
las de las fases de arriba.

En Azure los escalones son `10,20,40,80,120,160,200,240,320` (ver `../predicciones/capacidad.md`): se agrega 200 para
afinar B entre 160 y 240, y se cortan 480 y 640 para no sostener miles de conexiones a la vez a través del router.

Antes de Artillery, `correr.mjs` reinicia el estado de Redis y mide el RTT de base con `GET /` (no toca ARCA ni
Redis), de dos formas: 20 pedidos por una conexión keep-alive ya abierta (1 RTT) y 20 con una conexión nueva cada uno
(handshake TCP + pedido, ~2 RTT).

## Dos latencias distintas

| Latencia | Dónde está | Desde | Hasta | RTT que incluye |
|---|---|---|---|---|
| la de `pedidos.jsonl` (y de `resumen.md`) | `ms` = `t1 − t0` | `beforeRequest`, antes de abrir la conexión | `afterResponse`, con el cuerpo ya recibido | conexión nueva (~2 RTT): Artillery abre una conexión por pedido, porque cada usuario virtual tiene su propio agente y hace un solo pedido |
| `http.response_time` de Artillery y `artillery.http.response_time.*` en Datadog | reporte JSON de Artillery | fin del envío del pedido | primer byte de la respuesta | conexión reutilizada (1 RTT) |

La segunda es la fase `firstByte` de got (`timings.response − timings.upload`, en
`perf/node_modules/got/dist/source/core/utils/timer.js`), que Artillery publica como `http.response_time`
(`artillery/dist/lib/core/engine_http.js`). No incluye la espera del socket, el DNS, el connect TCP ni el envío.

## Qué queda en `perf/results/<caso>/exchange-<corrida>/`

- `exchange-<corrida>.json`: el reporte crudo de Artillery (`--output`).
- `pedidos.jsonl`: una línea por pedido: `t0` (salida), `t1` (llegada), `status` (código HTTP, o `ERR_SOCKET_TIMEOUT`,
  `ECONNREFUSED`...), `ms`, `escenario` (par de monedas) y, en los 503, si vino de ARCA y el motivo.
- `recursos.jsonl` (solo local): CPU (% de un núcleo) y memoria de app, redis y arca cada 1 s, de `docker stats`.
  En Azure no se muestrea: el nodo lo cubre Datadog y Redis y ARCA, `azure-monitor/`, con las horas UTC de `meta.txt`.
- `rtt.json`: las muestras de `GET /` con conexión reutilizada y con conexión nueva, con su p50, p95 y el connect.
- `meta.txt`: inicio y fin UTC, fases, commit, `git status`, versiones, máquina y conexión; en Azure, además,
  `terraform output` de `vmss_instances`, `vmss_sku` y `redis_sku`, y la región.
- `azure-monitor/` (solo Azure): Redis y ARCA no tienen agente de Datadog, así que `correr.mjs` exporta sus métricas
  de Azure Monitor con `az monitor metrics list`, en el rango de la corrida más 2 min antes y después, con grano de
  1 min. Espera `AZURE_MONITOR_ESPERA_S` antes, porque Azure Monitor publica con 1 a 3 min de demora:
  - `redis.json`: `usedmemory` (bytes), `operationsPerSecond` y `percentProcessorTime` (%), con máximo y promedio;
  - `arca.json`: `CpuUsage` (milicores: 0,5 vCPU = 500) y `MemoryUsage` (bytes), con promedio y máximo;
  - `LEEME.txt`: el rango y cómo volver a exportar; un `<recurso>.error.txt` si alguna exportación falló.

  Los nombres se verificaron con `az monitor metrics list-definitions`. Los campos `id` se borran y cualquier
  `subscriptions/<id>` se reemplaza, para no publicar el id de la suscripción.
- `resumen.md` y `resumen.json`: los genera `analizar.mjs` solo a partir de los archivos anteriores (sin `azure-monitor/`).
