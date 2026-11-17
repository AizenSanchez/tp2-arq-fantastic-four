# Endurance — local-1-nodo

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-endurance   caso: local-1-nodo   entorno: local   target: http://localhost:3000
inicio UTC: 2026-11-17T06:48:40.564Z
fin UTC: 2026-11-17T07:01:46.103Z
zona horaria: UTC
fases: [{"nombre":"endurance-120","tipo":"endurance","rate":120,"duracion":600},{"nombre":"tramo-240","tipo":"tramo","rate":240,"duracion":180}]
RTT de base (GET /): p50 1.4 ms, p95 4.1 ms
commit: 7104bfee8ea14c5862f6705ff81543c05ce7e607
git status --porcelain (sin perf/results):
M perf/capacidad/README.md
 M perf/capacidad/analizar.mjs
 M perf/capacidad/correr.mjs
 M perf/root.yaml
artillery: Artillery: 2.0.34
node: v24.22.3   maquina: DESKTOP-BV02RG7 (8 CPU, 8 GiB)   conexion: local
codigo de salida de artillery: 0
```

RTT de base (`GET /`): conexión reutilizada p50 1.4 ms, p95 4.1 ms · conexión nueva — (no se midió en esta corrida).

Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| endurance-120 | 120 | 120 | 120 | 74.5 | 38.2 | 7.4 | 0 / 0 | 0 | 0 | 100 | 0 | 978 | 1190 | 1268 | 380 | 539 |  |
| tramo-240 | 240 | 240 | 240 | 149.3 | 75.7 | 15 | 0 / 0 | 0 | 0 | 100 | 0 | 1036 | 1508 | 1763 | 425 | 878 |  |

Proporciones de ARCA (sobre respuestas): endurance-120: 403 31.8 %, 503 6.1 % · tramo-240: 403 31.5 %, 503 6.3 %

Motivos de los 503: endurance-120 `{"http_5xx":4373}` · tramo-240 `{"http_5xx":2598}`

## Recursos (docker stats cada 1 s; CPU en % de un núcleo)

| fase | app CPU máx | app CPU media | app mem máx (MiB) | redis CPU máx | redis CPU media | redis mem máx (MiB) | arca CPU máx | arca CPU media |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| endurance-120 | 69.8 | 38.9 | 179.5 | 29.2 | 7.5 | 41 | 20 | 9.5 |
| tramo-240 | 93 | 70.6 | 181 | 28.8 | 9.9 | 62.6 | 28.2 | 18.1 |

## Endurance

- Pendiente del p95 de los 200 en endurance-120: 0.8 ms/min (R² 0.13, 10 minutos).
- Pendiente del p95 de los 200 en tramo-240: 26 ms/min (R² 0.25, 3 minutos).
- Memoria en endurance-120: app 178.2 → 178.7 MiB, redis 9.1 → 40.5 MiB (mediana de las 10 primeras y 10 últimas muestras).
- Memoria en tramo-240: app 179.8 → 179.9 MiB, redis 42.3 → 61.6 MiB (mediana de las 10 primeras y 10 últimas muestras).

| minuto | fase | enviados | errores propios | 200 p50 | 200 p95 | app mem (MiB) | redis mem (MiB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | endurance-120 | 7186 | 0 | 978 | 1181 | 179.1 | 52.8 |
| 1 | endurance-120 | 7201 | 0 | 978 | 1187 | 179.4 | 12.8 |
| 2 | endurance-120 | 7201 | 0 | 975 | 1181 | 179.1 | 16.4 |
| 3 | endurance-120 | 7202 | 0 | 980 | 1195 | 179 | 19.7 |
| 4 | endurance-120 | 7200 | 0 | 977 | 1192 | 179.1 | 23.3 |
| 5 | endurance-120 | 7201 | 0 | 982 | 1204 | 179.3 | 26.9 |
| 6 | endurance-120 | 7202 | 0 | 978 | 1184 | 179 | 30.3 |
| 7 | endurance-120 | 7200 | 0 | 977 | 1191 | 179.3 | 33.9 |
| 8 | endurance-120 | 7200 | 0 | 978 | 1191 | 179.5 | 37.5 |
| 9 | endurance-120 | 7204 | 0 | 977 | 1190 | 179.4 | 41.2 |
| 10 | tramo-240 | 14396 | 0 | 1027 | 1488 | 180.8 | 48.1 |
| 11 | tramo-240 | 14401 | 0 | 1027 | 1437 | 180.7 | 55.4 |
| 12 | tramo-240 | 14393 | 0 | 1050 | 1540 | 181 | 62.8 |
| 13 | fin | 13 | 0 | 895 | 1085 | 178.4 | 62.8 |

## Control contra Artillery

Códigos: `{"http.codes.503":7136,"http.codes.403":36522,"http.codes.200":71542}` · errores: `{}`

`http.response_time` de Artillery (toda la corrida, ms): 2xx `{"n":71542,"p50":1002.4,"p95":1274.3,"p99":1620}` · 4xx `{"n":36522,"p50":391.6,"p95":608,"p99":982.6}`

Escenarios creados: 115200, fallidos: 0, líneas en pedidos.jsonl: 115200.
