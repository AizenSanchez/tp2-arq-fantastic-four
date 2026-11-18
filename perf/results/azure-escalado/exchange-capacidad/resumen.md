# Capacidad — azure-escalado

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-capacidad   caso: azure-escalado   entorno: azure   target: http://aqvautmvnv.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-18T14:32:05.420Z
fin UTC: 2026-11-18T14:43:25.386Z
zona horaria: UTC
fases: [{"nombre":"escalon-10","tipo":"escalon","rate":10,"duracion":60},{"nombre":"escalon-20","tipo":"escalon","rate":20,"duracion":60},{"nombre":"escalon-40","tipo":"escalon","rate":40,"duracion":60},{"nombre":"escalon-80","tipo":"escalon","rate":80,"duracion":60},{"nombre":"escalon-120","tipo":"escalon","rate":120,"duracion":60},{"nombre":"escalon-160","tipo":"escalon","rate":160,"duracion":60},{"nombre":"escalon-200","tipo":"escalon","rate":200,"duracion":60},{"nombre":"escalon-240","tipo":"escalon","rate":240,"duracion":60},{"nombre":"escalon-320","tipo":"escalon","rate":320,"duracion":60},{"nombre":"bajada-20","tipo":"bajada","rate":20,"duracion":120}]
RTT de base (GET /): conexion reutilizada p50 143.8 ms, p95 149.6 ms; conexion nueva p50 298.9 ms, p95 317.2 ms
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

RTT de base (`GET /`): conexión reutilizada p50 143.8 ms, p95 149.6 ms · conexión nueva p50 298.9 ms, p95 317.2 ms (connect p50 153.8 ms).

Las latencias de este resumen salen de `pedidos.jsonl`: desde antes de abrir la conexión hasta el fin de la respuesta (incluyen el handshake TCP, porque Artillery abre una conexión por pedido). El `http.response_time` de Artillery y Datadog es más corto: solo desde que terminó de salir el pedido hasta el primer byte.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| escalon-10 | 10 | 10 | 10 | 5.9 | 3.5 | 0.6 | 0 / 0 | 0 | 0 | 100 | 0 | 1277 | 1504 | 2306 | 679 | 804 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-20 | 20 | 20 | 20 | 12.6 | 6.1 | 1.3 | 0 / 0 | 0 | 0 | 100 | 0 | 1284 | 1506 | 2234 | 679 | 827 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-40 | 40 | 40 | 40 | 24.4 | 12.8 | 2.8 | 0 / 0 | 0 | 0 | 100 | 0 | 1276 | 1495 | 1598 | 675 | 848 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-80 | 80 | 80 | 80 | 48.7 | 25.8 | 5.5 | 0 / 0 | 0 | 0 | 100 | 0 | 1273 | 1490 | 1656 | 673 | 824 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-120 | 120 | 120 | 120 | 73.9 | 38.3 | 7.8 | 0 / 0 | 0 | 0 | 100 | 0 | 1273 | 1492 | 1578 | 673 | 828 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-160 | 160 | 160 | 160 | 98.5 | 51.8 | 9.7 | 0 / 0 | 0 | 0 | 100 | 0 | 1284 | 1500 | 1597 | 683 | 852 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-200 | 200 | 200 | 192.6 | 120.1 | 60.9 | 11.7 | 0 / 0 | 7.4 | 0 | 96.3 | 3.7 | 1339 | 1766 | 1986 | 732 | 1136 | ✗ (err ✗, resp ✓, lat ✓) |
| escalon-240 | 240 | 240 | 140.1 | 86.6 | 45 | 8.6 | 0 / 0 | 99.9 | 0 | 58.4 | 41.6 | 7223 | 10496 | 11154 | 6522 | 9857 | ✗ (err ✗, resp ✗, lat ✗) |
| escalon-320 | 320 | 320 | 0 | 0 | 0 | 0 | 0 / 0 | 320 | 0 | 0 | 100 | — | — | — | — | — | ✗ (err ✗, resp ✗, lat ✗) |
| bajada-20 | 20 | 20 | 17.7 | 11.1 | 5.5 | 1.1 | 0 / 0 | 2.3 | 0 | 88.3 | 11.7 | 1292 | 6619 | 10488 | 673 | 5928 |  |

Proporciones de ARCA (sobre respuestas): escalon-10: 403 34.5 %, 503 6 % · escalon-20: 403 30.3 %, 503 6.5 % · escalon-40: 403 31.9 %, 503 7.1 % · escalon-80: 403 32.2 %, 503 6.9 % · escalon-120: 403 31.9 %, 503 6.5 % · escalon-160: 403 32.4 %, 503 6.1 % · escalon-200: 403 31.6 %, 503 6.1 % · escalon-240: 403 32.1 %, 503 6.1 % · escalon-320: 403 — %, 503 — % · bajada-20: 403 31.2 %, 503 6.1 %

Motivos de los 503: escalon-10 `{"http_5xx":32}` · escalon-20 `{"http_5xx":69}` · escalon-40 `{"http_5xx":151}` · escalon-80 `{"http_5xx":293}` · escalon-120 `{"http_5xx":415}` · escalon-160 `{"http_5xx":514}` · escalon-200 `{"http_5xx":618}` · escalon-240 `{"http_5xx":454}` · escalon-320 `{}` · bajada-20 `{"http_5xx":121}`

## Recursos

Sin muestreo local. En Azure: los nodos en Datadog (`datadog/`, horas UTC de meta.txt) y Redis, ARCA y el balanceador en `azure-monitor/`.

## Reparto por nodo (header `X-Node`)

Sobre las respuestas HTTP (los timeouts y errores de conexión no traen nodo). Latencias de los 200 en ms.

| fase | tp2vmss000000 respuestas (%) | tp2vmss000000 200 p50 | tp2vmss000000 200 p95 | tp2vmss000001 respuestas (%) | tp2vmss000001 200 p50 | tp2vmss000001 200 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| escalon-10 | 249 (47 %) | 1278 | 1521 | 281 (53 %) | 1276 | 1481 |
| escalon-20 | 499 (47.1 %) | 1276 | 1523 | 561 (52.9 %) | 1290 | 1500 |
| escalon-40 | 1024 (48.3 %) | 1277 | 1486 | 1096 (51.7 %) | 1274 | 1498 |
| escalon-80 | 2143 (50.5 %) | 1277 | 1497 | 2097 (49.5 %) | 1270 | 1486 |
| escalon-120 | 3166 (49.8 %) | 1272 | 1498 | 3195 (50.2 %) | 1274 | 1486 |
| escalon-160 | 4138 (48.8 %) | 1283 | 1500 | 4343 (51.2 %) | 1284 | 1500 |
| escalon-200 | 5169 (50.6 %) | 1338 | 1757 | 5041 (49.4 %) | 1339 | 1773 |
| escalon-240 | 3679 (49.5 %) | 7272 | 10515 | 3748 (50.5 %) | 7184 | 10481 |
| escalon-320 | 0 (— %) | — | — | 0 (— %) | — | — |
| bajada-20 | 958 (48 %) | 1288 | 6731 | 1038 (52 %) | 1294 | 6272 |

## Throughput sostenido

- **B = 160 pedidos/s** (p95 de referencia del primer escalón: 1504 ms; tope de latencia: 3008 ms).
- Primer escalón que no cumple: 200 pedidos/s (errores ✗, respuestas ✓, latencia ✓).

## Recuperación (bajada)

Bajada a 20 pedidos/s. Umbral: p95 de los 200 ≤ 1804.8 ms y sin errores propios en una ventana de 5 s.

**Recuperación: 30 s.**

| desde la bajada (s) | enviados | errores propios | p95 200 (ms) |
| --- | --- | --- | --- |
| 0 | 100 | 100 | — |
| 5 | 100 | 100 | — |
| 10 | 100 | 100 | — |
| 15 | 100 | 64 | 11097 |
| 20 | 100 | 0 | 9381 |
| 25 | 100 | 0 | 4681 |
| 30 | 100 | 0 | 1447 |
| 35 | 100 | 0 | 1450 |
| 40 | 100 | 0 | 1487 |
| 45 | 100 | 0 | 1448 |
| 50 | 100 | 0 | 1487 |
| 55 | 100 | 0 | 1473 |
| 60 | 100 | 0 | 1532 |
| 65 | 100 | 0 | 1537 |
| 70 | 100 | 0 | 1472 |
| 75 | 100 | 0 | 1478 |
| 80 | 100 | 0 | 1484 |
| 85 | 100 | 0 | 1481 |
| 90 | 100 | 0 | 1466 |
| 95 | 100 | 0 | 1456 |
| 100 | 100 | 0 | 1445 |
| 105 | 100 | 0 | 1478 |
| 110 | 100 | 0 | 1484 |
| 115 | 96 | 0 | 1450 |

## Control contra Artillery

Códigos: `{"http.codes.200":29705,"http.codes.403":15377,"http.codes.503":3048}` · errores: `{"errors.ERR_SOCKET_TIMEOUT":25670}`

`http.response_time` de Artillery (toda la corrida, ms): 2xx `{"n":29705,"p50":1130.2,"p95":1326.4,"p99":1408.4}` · 4xx `{"n":15377,"p50":518.1,"p95":671.9,"p99":727.9}`

Escenarios creados: 73800, fallidos: 25670, líneas en pedidos.jsonl: 73800.

## Observaciones (de `observaciones.md`, escritas a mano)

Anotadas el 2026-11-18, después de la corrida. Fuentes: `datadog/series.json` (cada nodo, cada ≈ 15 s),
`azure-monitor/` (grano 1 min) y `pedidos.jsonl`. No cambian B: B = 160 pedidos/s según el criterio commiteado.

1. **Los nodos no fueron el límite.** La CPU de cada nodo (user + system) fue de ≈ 7–8 % a 120 pedidos/s, ≈ 10–11 % a
   160, ≈ 12 % a 200 y ≈ 13 % a 240. El reparto fue 50/50 en todos los escalones (de 47/53 a 51/49). En el escalón de
   320 los dos nodos bajan a ≈ 3 % de CPU.
2. **Los pedidos que vencen no llegan a Azure.** `SYNCount` entrante del balanceador (`azure-monitor/lb-trafico.json`,
   promedio por segundo en cada minuto; Azure Monitor va ≈ 2 min corrido respecto de la carga) fue ≈ 10, 20, 41, 80,
   121, 160 y 195 SYN/s en los escalones de 10 a 200: una conexión por pedido, como se ofrecía. En el escalón de 240
   llegaron **≈ 142 SYN/s** de 240 ofrecidos, y en el de 320, **≈ 0**. Los bytes recibidos por cada nodo (Datadog)
   muestran lo mismo: ≈ 180 KB/s en 200 y en 240, y ≈ 56 KB/s en 320. El probe del balanceador marcó los dos nodos al
   100 % todo el tiempo (`lb-probe.json`).
3. **Los timeouts llegan en ráfagas**, con la misma firma que la pausa del caso 1 nodo. En el escalón de 200, todos
   los timeouts están en los segundos 395–399 y 408–411 (ninguno hasta el 394), con la CPU de los nodos en ≈ 12 %.
4. **Redis no fue el límite.** No hubo `Redis error`, `unhandled` ni pedidos fallidos en los logs de pm2 de los dos
   nodos, y pm2 registró 0 reinicios (consultado con Ansible antes del destroy). Redis hizo ≈ 14,6 operaciones por
   pedido, igual que con 1 nodo.
5. **Conclusión:** el cuello de botella está **antes del balanceador de Azure**, en la red de la generadora (wifi,
   router de la casa o proveedor), que deja de entregar conexiones nuevas a partir de ≈ 200 por segundo. Es la fila
   "la red de la generadora" de la tabla de hipótesis de la predicción.
6. **B: 160 contra 120 con 1 nodo.** La diferencia no viene de la CPU, que estaba sobrada en los dos casos. Con 1 nodo,
   el escalón de 160 falló por una sola pausa de ≈ 8 s (1,2 % de timeouts contra un tope de 1 %). Acá ese escalón
   salió limpio y el primero en fallar fue el de 200, por ráfagas del mismo tipo. Se lee como variación de la red
   entre corridas, no como escalado: B_escalado / B_1 nodo = 1,33, dentro de la tolerancia predicha (1,0 a 1,33).
