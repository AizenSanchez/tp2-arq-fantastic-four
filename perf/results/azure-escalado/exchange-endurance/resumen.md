# Endurance — azure-escalado

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-endurance   caso: azure-escalado   entorno: azure   target: http://aqvautmvnv.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-18T14:48:58.206Z
fin UTC: 2026-11-18T15:02:12.765Z
zona horaria: UTC
fases: [{"nombre":"endurance-80","tipo":"endurance","rate":80,"duracion":600},{"nombre":"tramo-160","tipo":"tramo","rate":160,"duracion":180}]
RTT de base (GET /): conexion reutilizada p50 143.8 ms, p95 145.6 ms; conexion nueva p50 296.6 ms, p95 302.7 ms
commit: c171d498c45957d12ad7894c0c526227933aec84
git status --porcelain (sin perf/results):
(vacio)
artillery: Artillery: 2.0.34
node: v24.22.3   maquina: DESKTOP-BV02RG7 (8 CPU, 8 GiB)   conexion: wifi
terraform output vmss_instances: 2
terraform output vmss_sku: "Standard_F1als_v7"
terraform output redis_sku: "Balanced_B0"
region: eastus2 (default de variables.tf)
codigo de salida de artillery: 0
```

RTT de base (`GET /`): conexión reutilizada p50 143.8 ms, p95 145.6 ms · conexión nueva p50 296.6 ms, p95 302.7 ms (connect p50 152.3 ms).

Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| endurance-80 | 80 | 80 | 80 | 49.5 | 25.4 | 5.1 | 0 / 0 | 0 | 0 | 100 | 0 | 1272 | 1485 | 1571 | 673 | 832 |  |
| tramo-160 | 160 | 160 | 159 | 97.7 | 51.4 | 9.9 | 0 / 0 | 1 | 0 | 99.4 | 0.6 | 1283 | 1513 | 1676 | 682 | 866 |  |

Proporciones de ARCA (sobre respuestas): endurance-80: 403 31.7 %, 503 6.4 % · tramo-160: 403 32.3 %, 503 6.2 %

Motivos de los 503: endurance-80 `{"http_5xx":3020}` · tramo-160 `{"http_5xx":1719}`

## Recursos

Sin muestreo local. En Azure: los nodos en Datadog (`datadog/`, horas UTC de meta.txt) y Redis, ARCA y el balanceador en `azure-monitor/`.

## Reparto por nodo (header `X-Node`)

Sobre las respuestas HTTP (los timeouts y errores de conexión no traen nodo). Latencias de los 200 en ms.

| fase | tp2vmss000000 respuestas (%) | tp2vmss000000 200 p50 | tp2vmss000000 200 p95 | tp2vmss000001 respuestas (%) | tp2vmss000001 200 p50 | tp2vmss000001 200 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| endurance-80 | 23523 (49.6 %) | 1273 | 1485 | 23919 (50.4 %) | 1272 | 1485 |
| tramo-160 | 13532 (49.2 %) | 1281 | 1511 | 13974 (50.8 %) | 1285 | 1514 |

## Endurance

- Pendiente del p95 de los 200 en endurance-80: -0.7 ms/min (R² 0.19, 10 minutos).
- Pendiente del p95 de los 200 en tramo-160: -4.5 ms/min (R² 0.15, 3 minutos).

| minuto | fase | enviados | errores propios | 200 p50 | 200 p95 | app mem (MiB) | redis mem (MiB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | endurance-80 | 4792 | 0 | 1270 | 1496 | — | — |
| 1 | endurance-80 | 4800 | 0 | 1276 | 1488 | — | — |
| 2 | endurance-80 | 4801 | 0 | 1278 | 1481 | — | — |
| 3 | endurance-80 | 4800 | 0 | 1273 | 1488 | — | — |
| 4 | endurance-80 | 4800 | 0 | 1270 | 1483 | — | — |
| 5 | endurance-80 | 4800 | 0 | 1270 | 1485 | — | — |
| 6 | endurance-80 | 4801 | 0 | 1272 | 1482 | — | — |
| 7 | endurance-80 | 4800 | 0 | 1269 | 1480 | — | — |
| 8 | endurance-80 | 4800 | 0 | 1272 | 1488 | — | — |
| 9 | endurance-80 | 4802 | 0 | 1271 | 1486 | — | — |
| 10 | tramo-160 | 9596 | 0 | 1283 | 1510 | — | — |
| 11 | tramo-160 | 9601 | 0 | 1285 | 1524 | — | — |
| 12 | tramo-160 | 9597 | 176 | 1278 | 1501 | — | — |
| 13 | fin | 10 | 0 | 1262 | 1388 | — | — |

### Por minuto y nodo

| minuto | tp2vmss000000 respuestas (%) | tp2vmss000000 200 p95 | tp2vmss000001 respuestas (%) | tp2vmss000001 200 p95 |
| --- | --- | --- | --- | --- |
| 0 | 2326 (48.5 %) | 1491 | 2466 (51.5 %) | 1502 |
| 1 | 2358 (49.1 %) | 1482 | 2442 (50.9 %) | 1491 |
| 2 | 2422 (50.4 %) | 1480 | 2379 (49.6 %) | 1484 |
| 3 | 2405 (50.1 %) | 1489 | 2395 (49.9 %) | 1486 |
| 4 | 2405 (50.1 %) | 1483 | 2395 (49.9 %) | 1481 |
| 5 | 2344 (48.8 %) | 1484 | 2456 (51.2 %) | 1485 |
| 6 | 2370 (49.4 %) | 1485 | 2431 (50.6 %) | 1477 |
| 7 | 2370 (49.4 %) | 1486 | 2430 (50.6 %) | 1471 |
| 8 | 2371 (49.4 %) | 1489 | 2429 (50.6 %) | 1485 |
| 9 | 2424 (50.5 %) | 1486 | 2378 (49.5 %) | 1486 |
| 10 | 4670 (48.7 %) | 1511 | 4926 (51.3 %) | 1509 |
| 11 | 4771 (49.7 %) | 1519 | 4830 (50.3 %) | 1528 |
| 12 | 4647 (49.3 %) | 1501 | 4774 (50.7 %) | 1504 |
| 13 | 3 (30 %) | 1340 | 7 (70 %) | 1388 |

## Control contra Artillery

Códigos: `{"http.codes.403":24467,"http.codes.200":47307,"http.codes.503":4850}` · errores: `{"errors.ERR_SOCKET_TIMEOUT":176}`

`http.response_time` de Artillery (toda la corrida, ms): 2xx `{"n":47307,"p50":1130.2,"p95":1326.4,"p99":1408.4}` · 4xx `{"n":24467,"p50":518.1,"p95":671.9,"p99":727.9}`

Escenarios creados: 76800, fallidos: 176, líneas en pedidos.jsonl: 76800.

## Observaciones (de `observaciones.md`, escritas a mano)

Anotadas el 2026-11-18, después de la corrida. Fuentes: `datadog/series.json` y `azure-monitor/`.

1. **Endurance a 80 pedidos/s (0,5 · B) durante 10 min:** 0 errores, reparto 49,6 / 50,4 % y pendiente del p95 de los
   200 de −0,7 ms/min. Memoria de cada nodo (`system.mem.used`) desde el minuto 1 hasta el final: +1,4 % y +0,7 %.
2. **Tramo a 160 pedidos/s (B) durante 3 min:** p95 de los 200 de 1.513 ms y 0,6 % de timeouts (por debajo del 1 % del
   criterio). Son los únicos errores de la corrida: a 160 la red de la generadora ya está cerca de su límite (ver
   `../exchange-capacidad/observaciones.md`).
3. **Redis (`usedmemory`):** de 3,4 a 37,7 MiB en 76.800 pedidos, ≈ 0,46 KiB por pedido, lineal. Hizo ≈ 1.165 ops/s
   a 80 pedidos/s y ≈ 2.330 a 160: ≈ 14,6 por pedido, igual que con 1 nodo.
4. **ARCA (`CpuUsage`):** ≈ 25 milicores a 80 pedidos/s y ≈ 50 a 160, ≈ 0,31 milicores por pedido/s.
5. Las marcas de tiempo de Azure Monitor van ≈ 2 min corridas respecto de `meta.txt` y Datadog.
