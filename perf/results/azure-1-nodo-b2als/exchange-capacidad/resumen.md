# Capacidad — azure-1-nodo-b2als

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-capacidad   caso: azure-1-nodo-b2als   entorno: azure   target: http://pliokzzsno.northcentralus.cloudapp.azure.com
inicio UTC: 2026-11-18T00:56:43.608Z
fin UTC: 2026-11-18T01:08:04.362Z
zona horaria: UTC
fases: [{"nombre":"escalon-10","tipo":"escalon","rate":10,"duracion":60},{"nombre":"escalon-20","tipo":"escalon","rate":20,"duracion":60},{"nombre":"escalon-40","tipo":"escalon","rate":40,"duracion":60},{"nombre":"escalon-80","tipo":"escalon","rate":80,"duracion":60},{"nombre":"escalon-120","tipo":"escalon","rate":120,"duracion":60},{"nombre":"escalon-160","tipo":"escalon","rate":160,"duracion":60},{"nombre":"escalon-200","tipo":"escalon","rate":200,"duracion":60},{"nombre":"escalon-240","tipo":"escalon","rate":240,"duracion":60},{"nombre":"escalon-320","tipo":"escalon","rate":320,"duracion":60},{"nombre":"bajada-20","tipo":"bajada","rate":20,"duracion":120}]
RTT de base (GET /): conexion reutilizada p50 160.3 ms, p95 164.1 ms; conexion nueva p50 324.9 ms, p95 340.2 ms
commit: ?
git status --porcelain (sin perf/results):
?
artillery: Artillery: 2.0.34
node: v24.22.3   maquina: generadora (12 CPU, 16 GiB)   conexion: cable
terraform output vmss_instances: ?
terraform output vmss_sku: ?
terraform output redis_sku: ?
region: northcentralus
codigo de salida de artillery: 0
```

RTT de base (`GET /`): conexión reutilizada p50 160.3 ms, p95 164.1 ms · conexión nueva p50 324.9 ms, p95 340.2 ms (connect p50 163.1 ms).

Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| escalon-10 | 10 | 10 | 10 | 6.3 | 3.1 | 0.6 | 0 / 0 | 0 | 0 | 100 | 0 | 1309 | 1513 | 1613 | 676 | 871 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-20 | 20 | 20 | 20 | 12.2 | 6.4 | 1.4 | 0 / 0 | 0 | 0 | 100 | 0 | 1295 | 1523 | 1615 | 694 | 848 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-40 | 40 | 40 | 40 | 25.2 | 12.2 | 2.6 | 0 / 0 | 0 | 0 | 100 | 0 | 1298 | 1555 | 2018 | 707 | 910 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-80 | 80 | 80 | 80 | 49.2 | 25.5 | 5.3 | 0 / 0 | 0 | 0 | 100 | 0 | 1293 | 1501 | 1571 | 696 | 861 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-120 | 120 | 120 | 120 | 73.9 | 38.1 | 7.9 | 0 / 0 | 0 | 0 | 100 | 0 | 1296 | 1510 | 1588 | 702 | 864 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-160 | 160 | 160 | 160 | 99.2 | 51 | 9.8 | 0 / 0 | 0 | 0 | 100 | 0 | 1295 | 1511 | 1590 | 697 | 851 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-200 | 200 | 200 | 200 | 123 | 65 | 12 | 0 / 0 | 0 | 0 | 100 | 0 | 1295 | 1505 | 1576 | 692 | 853 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-240 | 240 | 240 | 240 | 149.9 | 75.6 | 14.5 | 0 / 0 | 0 | 0 | 100 | 0 | 1300 | 1511 | 1593 | 699 | 847 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-320 | 320 | 320 | 320 | 196.3 | 102.9 | 20.8 | 0 / 0 | 0 | 0 | 100 | 0 | 1305 | 1520 | 1594 | 702 | 865 | ✓ (err ✓, resp ✓, lat ✓) |
| bajada-20 | 20 | 20 | 20 | 12.7 | 6.2 | 1.2 | 0 / 0 | 0 | 0 | 100 | 0 | 1300 | 1506 | 1576 | 707 | 867 |  |

Proporciones de ARCA (sobre respuestas): escalon-10: 403 31.3 %, 503 5.7 % · escalon-20: 403 32.2 %, 503 6.8 % · escalon-40: 403 30.5 %, 503 6.6 % · escalon-80: 403 31.9 %, 503 6.6 % · escalon-120: 403 31.8 %, 503 6.6 % · escalon-160: 403 31.9 %, 503 6.1 % · escalon-200: 403 32.5 %, 503 6 % · escalon-240: 403 31.5 %, 503 6 % · escalon-320: 403 32.2 %, 503 6.5 % · bajada-20: 403 30.8 %, 503 5.9 %

Motivos de los 503: escalon-10 `{"http_5xx":30}` · escalon-20 `{"http_5xx":72}` · escalon-40 `{"http_5xx":140}` · escalon-80 `{"http_5xx":280}` · escalon-120 `{"http_5xx":421}` · escalon-160 `{"http_5xx":518}` · escalon-200 `{"http_5xx":638}` · escalon-240 `{"http_5xx":766}` · escalon-320 `{"http_5xx":1104}` · bajada-20 `{"http_5xx":134}`

## Recursos

Sin muestreo local. En Azure: el nodo en Datadog (horas UTC de meta.txt) y Redis y ARCA en `azure-monitor/`.

## Throughput sostenido

- **B = 320 pedidos/s** (p95 de referencia del primer escalón: 1513 ms; tope de latencia: 3026 ms).
- Todos los escalones cumplen.
- **B es el escalón más alto: el límite real está más arriba, agregar escalones y repetir.**

## Recuperación (bajada)

Bajada a 20 pedidos/s. Umbral: p95 de los 200 ≤ 1815.6 ms y sin errores propios en una ventana de 5 s.

**Recuperación: 0 s.**

| desde la bajada (s) | enviados | errores propios | p95 200 (ms) |
| --- | --- | --- | --- |
| 0 | 100 | 0 | 1503 |
| 5 | 100 | 0 | 1502 |
| 10 | 100 | 0 | 1499 |
| 15 | 100 | 0 | 1480 |
| 20 | 100 | 0 | 1527 |
| 25 | 100 | 0 | 1515 |
| 30 | 100 | 0 | 1502 |
| 35 | 100 | 0 | 1495 |
| 40 | 100 | 0 | 1517 |
| 45 | 100 | 0 | 1509 |
| 50 | 100 | 0 | 1479 |
| 55 | 100 | 0 | 1469 |
| 60 | 100 | 0 | 1498 |
| 65 | 100 | 0 | 1484 |
| 70 | 100 | 0 | 1508 |
| 75 | 100 | 0 | 1547 |
| 80 | 100 | 0 | 1531 |
| 85 | 100 | 0 | 1470 |
| 90 | 100 | 0 | 1505 |
| 95 | 100 | 0 | 1527 |
| 100 | 100 | 0 | 1561 |
| 105 | 100 | 0 | 1537 |
| 110 | 100 | 0 | 1449 |
| 115 | 90 | 0 | 1487 |

## Control contra Artillery

Códigos: `{"http.codes.200":45573,"http.codes.403":23582,"http.codes.503":4645}` · errores: `{}`

`http.response_time` de Artillery (toda la corrida, ms): 2xx `{"n":45573,"p50":1130.2,"p95":1353.1,"p99":1436.8}` · 4xx `{"n":23582,"p50":539.2,"p95":699.4,"p99":757.6}`

Escenarios creados: 73800, fallidos: 0, líneas en pedidos.jsonl: 73800.
