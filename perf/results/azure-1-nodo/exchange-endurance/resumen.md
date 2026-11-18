# Endurance — azure-1-nodo

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-endurance   caso: azure-1-nodo   entorno: azure   target: http://ppqqurpdgg.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-17T07:59:22.649Z
fin UTC: 2026-11-17T08:12:39.898Z
zona horaria: UTC
fases: [{"nombre":"endurance-60","tipo":"endurance","rate":60,"duracion":600},{"nombre":"tramo-120","tipo":"tramo","rate":120,"duracion":180}]
RTT de base (GET /): conexion reutilizada p50 143 ms, p95 144.8 ms; conexion nueva p50 291.1 ms, p95 298 ms
commit: 68ed7c0838957ff910bbb7fb31c6a5c14739277b
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

RTT de base (`GET /`): conexión reutilizada p50 143 ms, p95 144.8 ms · conexión nueva p50 291.1 ms, p95 298 ms (connect p50 148.8 ms).

Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| endurance-60 | 60 | 60 | 60 | 37.1 | 19.2 | 3.7 | 0 / 0 | 0 | 0 | 100 | 0 | 1272 | 1487 | 1572 | 670 | 832 |  |
| tramo-120 | 120 | 120 | 120 | 74.5 | 38.1 | 7.3 | 0 / 0 | 0 | 0 | 100 | 0 | 1275 | 1488 | 1574 | 673 | 825 |  |

Proporciones de ARCA (sobre respuestas): endurance-60: 403 32 %, 503 6.2 % · tramo-120: 403 31.8 %, 503 6.1 %

Motivos de los 503: endurance-60 `{"http_5xx":2194}` · tramo-120 `{"http_5xx":1269}`

## Recursos

Sin muestreo local. En Azure: el nodo en Datadog (horas UTC de meta.txt) y Redis y ARCA en `azure-monitor/`.

## Endurance

- Pendiente del p95 de los 200 en endurance-60: -0.8 ms/min (R² 0.08, 10 minutos).
- Pendiente del p95 de los 200 en tramo-120: 1 ms/min (R² 0.11, 3 minutos).

| minuto | fase | enviados | errores propios | 200 p50 | 200 p95 | app mem (MiB) | redis mem (MiB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | endurance-60 | 3595 | 0 | 1270 | 1490 | — | — |
| 1 | endurance-60 | 3601 | 0 | 1272 | 1485 | — | — |
| 2 | endurance-60 | 3600 | 0 | 1273 | 1482 | — | — |
| 3 | endurance-60 | 3600 | 0 | 1266 | 1484 | — | — |
| 4 | endurance-60 | 3601 | 0 | 1271 | 1491 | — | — |
| 5 | endurance-60 | 3600 | 0 | 1276 | 1504 | — | — |
| 6 | endurance-60 | 3600 | 0 | 1280 | 1491 | — | — |
| 7 | endurance-60 | 3601 | 0 | 1270 | 1484 | — | — |
| 8 | endurance-60 | 3600 | 0 | 1272 | 1475 | — | — |
| 9 | endurance-60 | 3603 | 0 | 1270 | 1479 | — | — |
| 10 | tramo-120 | 7198 | 0 | 1273 | 1489 | — | — |
| 11 | tramo-120 | 7200 | 0 | 1275 | 1485 | — | — |
| 12 | tramo-120 | 7195 | 0 | 1277 | 1491 | — | — |
| 13 | fin | 6 | 0 | 1394 | 1480 | — | — |

## Control contra Artillery

Códigos: `{"http.codes.503":3543,"http.codes.403":18402,"http.codes.200":35655}` · errores: `{}`

`http.response_time` de Artillery (toda la corrida, ms): 2xx `{"n":35655,"p50":1107.9,"p95":1326.4,"p99":1408.4}` · 4xx `{"n":18402,"p50":518.1,"p95":671.9,"p99":727.9}`

Escenarios creados: 57600, fallidos: 0, líneas en pedidos.jsonl: 57600.
