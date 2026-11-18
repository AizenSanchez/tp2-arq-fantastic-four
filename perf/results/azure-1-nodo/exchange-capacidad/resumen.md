# Capacidad — azure-1-nodo

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-capacidad   caso: azure-1-nodo   entorno: azure   target: http://ppqqurpdgg.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-17T07:37:18.424Z
fin UTC: 2026-11-17T07:48:39.813Z
zona horaria: UTC
fases: [{"nombre":"escalon-10","tipo":"escalon","rate":10,"duracion":60},{"nombre":"escalon-20","tipo":"escalon","rate":20,"duracion":60},{"nombre":"escalon-40","tipo":"escalon","rate":40,"duracion":60},{"nombre":"escalon-80","tipo":"escalon","rate":80,"duracion":60},{"nombre":"escalon-120","tipo":"escalon","rate":120,"duracion":60},{"nombre":"escalon-160","tipo":"escalon","rate":160,"duracion":60},{"nombre":"escalon-200","tipo":"escalon","rate":200,"duracion":60},{"nombre":"escalon-240","tipo":"escalon","rate":240,"duracion":60},{"nombre":"escalon-320","tipo":"escalon","rate":320,"duracion":60},{"nombre":"bajada-20","tipo":"bajada","rate":20,"duracion":120}]
RTT de base (GET /): conexion reutilizada p50 142.8 ms, p95 144.3 ms; conexion nueva p50 293.8 ms, p95 308.6 ms
commit: fa3a97616b0c9589883ce0f3f4920abf0814a937
git status --porcelain (sin perf/results):
M perf/root.yaml
artillery: Artillery: 2.0.34
node: v24.22.3   maquina: DESKTOP-BV02RG7 (8 CPU, 8 GiB)   conexion: wifi
terraform output vmss_instances: 1
terraform output vmss_sku: "Standard_F1als_v7"
terraform output redis_sku: "Balanced_B0"
region: eastus2 (default de variables.tf)
codigo de salida de artillery: 0
```

RTT de base (`GET /`): conexión reutilizada p50 142.8 ms, p95 144.3 ms · conexión nueva p50 293.8 ms, p95 308.6 ms (connect p50 149.7 ms).

Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| escalon-10 | 10 | 10 | 10 | 6.3 | 3.1 | 0.6 | 0 / 0 | 0 | 0 | 100 | 0 | 1263 | 1480 | 1565 | 655 | 846 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-20 | 20 | 20 | 20 | 12.3 | 6.1 | 1.6 | 0 / 0 | 0 | 0 | 100 | 0 | 1270 | 1499 | 1595 | 682 | 843 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-40 | 40 | 40 | 40 | 25.2 | 12.5 | 2.3 | 0 / 0 | 0 | 0 | 100 | 0 | 1282 | 1504 | 1737 | 657 | 816 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-80 | 80 | 80 | 80 | 49.4 | 25.5 | 5.1 | 0 / 0 | 0 | 0 | 100 | 0 | 1269 | 1491 | 1629 | 661 | 843 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-120 | 120 | 120 | 120 | 73.1 | 38.8 | 8.1 | 0 / 0 | 0 | 0 | 100 | 0 | 1274 | 1501 | 1606 | 677 | 843 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-160 | 160 | 160 | 158.2 | 97.9 | 50.9 | 9.4 | 0 / 0 | 1.8 | 0 | 98.9 | 1.2 | 1276 | 1496 | 1578 | 669 | 838 | ✗ (err ✗, resp ✓, lat ✓) |
| escalon-200 | 200 | 200 | 185.5 | 116 | 57.8 | 11.7 | 0 / 0 | 14.5 | 0 | 92.8 | 7.2 | 1389 | 2424 | 2693 | 773 | 1813 | ✗ (err ✗, resp ✗, lat ✓) |
| escalon-240 | 240 | 240 | 65 | 40.5 | 20.3 | 4.3 | 0 / 0 | 175 | 0 | 27.1 | 72.9 | 8741 | 10598 | 11190 | 8120 | 10065 | ✗ (err ✗, resp ✗, lat ✗) |
| escalon-320 | 320 | 320 | 0 | 0 | 0 | 0 | 0 / 0 | 320 | 0 | 0 | 100 | — | — | — | — | — | ✗ (err ✗, resp ✗, lat ✗) |
| bajada-20 | 20 | 20 | 15.5 | 9.8 | 4.8 | 0.9 | 0 / 0 | 4.5 | 0 | 77.5 | 22.5 | 1298 | 7021 | 10264 | 704 | 6871 |  |

Proporciones de ARCA (sobre respuestas): escalon-10: 403 31.1 %, 503 5.8 % · escalon-20: 403 30.6 %, 503 7.8 % · escalon-40: 403 31.2 %, 503 5.8 % · escalon-80: 403 31.9 %, 503 6.3 % · escalon-120: 403 32.4 %, 503 6.7 % · escalon-160: 403 32.2 %, 503 6 % · escalon-200: 403 31.1 %, 503 6.3 % · escalon-240: 403 31.2 %, 503 6.6 % · escalon-320: 403 — %, 503 — % · bajada-20: 403 31.2 %, 503 5.6 %

Motivos de los 503: escalon-10 `{"http_5xx":31}` · escalon-20 `{"http_5xx":83}` · escalon-40 `{"http_5xx":124}` · escalon-80 `{"http_5xx":269}` · escalon-120 `{"http_5xx":427}` · escalon-160 `{"http_5xx":499}` · escalon-200 `{"http_5xx":622}` · escalon-240 `{"http_5xx":227}` · escalon-320 `{}` · bajada-20 `{"http_5xx":98}`

## Recursos

Sin muestreo local. En Azure: el nodo en Datadog (horas UTC de meta.txt) y Redis y ARCA en `azure-monitor/`.

## Throughput sostenido

- **B = 120 pedidos/s** (p95 de referencia del primer escalón: 1480 ms; tope de latencia: 2960 ms).
- Primer escalón que no cumple: 160 pedidos/s (errores ✗, respuestas ✓, latencia ✓).

## Recuperación (bajada)

Bajada a 20 pedidos/s. Umbral: p95 de los 200 ≤ 1776 ms y sin errores propios en una ventana de 5 s.

**Recuperación: 45 s.**

| desde la bajada (s) | enviados | errores propios | p95 200 (ms) |
| --- | --- | --- | --- |
| 0 | 100 | 100 | — |
| 5 | 100 | 100 | — |
| 10 | 100 | 100 | — |
| 15 | 100 | 100 | — |
| 20 | 100 | 100 | — |
| 25 | 100 | 100 | — |
| 30 | 100 | 9 | 11113 |
| 35 | 100 | 0 | 6627 |
| 40 | 100 | 0 | 2136 |
| 45 | 100 | 0 | 1498 |
| 50 | 100 | 0 | 1484 |
| 55 | 101 | 0 | 1570 |
| 60 | 100 | 0 | 1508 |
| 65 | 100 | 0 | 1512 |
| 70 | 100 | 0 | 1417 |
| 75 | 100 | 0 | 1506 |
| 80 | 100 | 0 | 1548 |
| 85 | 100 | 0 | 1545 |
| 90 | 100 | 0 | 1483 |
| 95 | 100 | 0 | 1528 |
| 100 | 100 | 0 | 1465 |
| 105 | 100 | 0 | 1514 |
| 110 | 100 | 0 | 1466 |
| 115 | 95 | 0 | 1502 |

## Control contra Artillery

Códigos: `{"http.codes.200":26767,"http.codes.403":13688,"http.codes.503":2714}` · errores: `{"errors.ERR_SOCKET_TIMEOUT":30631}`

`http.response_time` de Artillery (toda la corrida, ms): 2xx `{"n":26767,"p50":1130.2,"p95":1326.4,"p99":1408.4}` · 4xx `{"n":13688,"p50":518.1,"p95":671.9,"p99":727.9}`

Escenarios creados: 73800, fallidos: 30631, líneas en pedidos.jsonl: 73800.

## Observaciones (de `observaciones.md`, escritas a mano)

Anotadas el 2026-11-17, después de la corrida, con `datadog/series.json` (CPU del nodo `tp2vmss000000` cada ≈ 15 s) y
`pedidos.jsonl`. **No cambian B**: B = 120 pedidos/s según el criterio commiteado en las predicciones.

1. **Pausa al final del escalón de 160 (07:43:09 UTC, segundos 351–357 de la corrida).** Los timeouts que hacen fallar
   el escalón (1,2 % contra un tope de 1 %) no están repartidos: entre los segundos 305 y 350 no hay ninguno, y entre el
   351 y el 357 hay 98. Justo antes, la latencia de los 200 salta de ≈ 1,5 s a 5–8 s. La CPU del nodo en ese momento
   está **normal**: 20–21 % (user + system) a las 07:43:00, 07:43:15 y 07:43:30, sin pico. El nodo no estaba
   saturado: **probablemente fue la red de la generadora de carga** (wifi de la casa), no el sistema.
2. **Minuto muerto en la sobrecarga (≈ 07:45:30 a 07:47:00 UTC, escalón de 320 e inicio de la bajada).** Todos los
   pedidos terminan en timeout, pero la CPU del nodo está en **0–1 %**, igual que sin carga. Redis (`operationsPerSecond`
   ≈ 1) y ARCA (`CpuUsage` = 0) tampoco reciben trabajo, y la app no se reinició: `/health` daba `uptime` 5.090 s a las
   07:54:41, o sea que arrancó a las 06:29:51. Por encima de ≈ 200 pedidos/s **el límite no fue la CPU del nodo**: el
   máximo fue ≈ 21 % a 160 pedidos/s y ≈ 27 % a 200, lejos del 78 % y 95 % predichos. Con lo medido no se puede separar
   entre dos explicaciones, y las dos dan la CPU ociosa y Redis sin operaciones:
   - el tráfico no llegó al nodo (la red de la generadora o el router de la casa, con miles de conexiones nuevas
     abiertas a la vez: hasta 320 × 10 s);
   - la app quedó esperando a Redis (si la conexión TLS a `Balanced_B0` se trabó, todos los pedidos esperan antes de
     llamar a ARCA).

   Para distinguirlas: `system.net.bytes_rcvd` del nodo o las métricas del balanceador (si no entró tráfico, es la red),
   y el log de pm2 de la app (si hay `Redis error`, es Redis).
3. Las marcas de tiempo de Azure Monitor (`azure-monitor/`, grano 1 min) parecen ir **≈ 1 min corridas** respecto de la
   carga y de Datadog. Por ejemplo, los minutos sin operaciones en Redis figuran en 07:47, y en Datadog la CPU ociosa
   empieza a las 07:45:30. Hay que tenerlo en cuenta al comparar por minuto.
