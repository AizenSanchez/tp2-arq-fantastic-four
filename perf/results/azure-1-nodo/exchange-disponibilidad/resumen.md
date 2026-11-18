# Disponibilidad — azure-1-nodo

Generado por `perf/disponibilidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
caso: azure-1-nodo   entorno: azure   target: http://gunegfcioh.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-18T01:50:40.350Z
fin UTC: 2026-11-18T01:54:31.044Z
zona horaria: America/Buenos_Aires
carga: 20 pedidos/s durante 200 s   fallas: kill-9@60s pm2-stop@120s pm2-start@150s   nodo: vmss[0]
commit: 124070173bf1d8ee4fb0edc9b06e7e8c40f5f837
git status --porcelain (sin perf/results):
?? "Plan TP 2 \342\200\224 arVault en Azure (por integrante).pdf"
?? "Plan TP 2 \342\200\224 versi\303\263n ag\303\251ntica (delegar en Claude).pdf"
?? catalogo_tp1_a_tp2.md
artillery: Artillery: 2.0.34
node: v24.22.3   maquina: aizen-OMEN-by-HP-Laptop-16-b0xxx   conexion: cable
codigo de salida de artillery: 0
```

## Totales

| enviados | atendidos (2xx/4xx) | 503 de ARCA | otros 5xx | sin respuesta | reinicios de pm2 |
| --- | --- | --- | --- | --- | --- |
| 4000 | 3047 (76.2 %) | 218 | 0 | 735 | 1 |

Por estado: `{"200":1981,"400":32,"403":1034,"503":218,"sin respuesta":735}` · por nodo: `{"?":4000}`

Errores de Artillery: `{"errors.ECONNRESET":23,"errors.ECONNREFUSED":556,"errors.ERR_SOCKET_TIMEOUT":156}`

## Latencia de base (30 `GET /` sin carga, conexión nueva)

mínimo 300 ms · p50 314 ms · p95 328 ms

## Referencia sin fallas (pedidos válidos de los segundos 5 a 30)

| estado | n | mediana (ms) | p95 (ms) |
| --- | --- | --- | --- |
| 200 | 42 | 1296 | 1537 |
| 403 | 21 | 655 | 840 |
| 422 | 0 | — | — |

## Pedidos inválidos (E9, segundos 30 a 40)

- Enviados: 32 (DNI inválido 14, moneda XYZ 18).
- Respuestas a los inválidos: `{"400":32}`. Mediana de un 400: 315 ms (1 ms sobre la base).
- Respuestas a los válidos de la misma ventana: `{"200":112,"403":44,"503":12}`.

## Efecto de cada falla

Segundos desde el inicio de la corrida. t_rec: hasta el primer segundo de 3 seguidos sin fallas propias, contando cada pedido en el segundo en que salió. Primera respuesta: cuándo le vuelve a llegar una respuesta a un pedido que salió después de la falla.

| falla | plan (s) | real (s) | restaurada (s) | fallas propias desde-hasta (s) | t_rec (s) | t_rec desde la restauración (s) | primera respuesta (s) | sin respuestas desde la falla / la restauración (s) | pedidos afectados (perdidos / 5xx) | atendidos > 2 s | latencia máx (ms) | /health no 200 (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kill-9 | 60 | 69 | — | 68–70 | 2 | — | 70.9 | 1 / — | 26 (26 / 0) | 0 | 1824 | 1 (70–70) |
| pm2-stop | 120 | 126 | 155 | 126–161 | 36 | 7 | 169.2 | 43.1 / 13.8 | 709 (709 / 0) | 134 | 8754 | 43 (127–169) |

## Errores de Artillery por período (cuándo ocurrió el error, no cuándo salió el pedido)

| período (s) | errores |
| --- | --- |
| 69–79 | `{"errors.ECONNRESET":23,"errors.ECONNREFUSED":3}` |
| 119–129 | `{"errors.ECONNREFUSED":65}` |
| 129–139 | `{"errors.ECONNREFUSED":203}` |
| 139–149 | `{"errors.ECONNREFUSED":200}` |
| 149–159 | `{"errors.ECONNREFUSED":85}` |
| 159–169 | `{"errors.ERR_SOCKET_TIMEOUT":118}` |
| 169–179 | `{"errors.ERR_SOCKET_TIMEOUT":38}` |

## Cambios de estado del monitor de /health

0 s → 200 · 70 s → UND_ERR_SOCKET · 71 s → 200 · 127 s → ECONNREFUSED · 155.1 s → TimeoutError · 170.1 s → 200

## Ventanas de 10 s

| desde (s) | enviados | % atendido | 503 ARCA | otros 5xx | sin respuesta | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | — | 0 | 0 | 0 | — | — |
| 10 | 0 | — | 0 | 0 | 0 | — | — |
| 20 | 69 | 91.3 | 6 | 0 | 0 | 1214 | 1531 |
| 30 | 200 | 94 | 12 | 0 | 0 | 1146 | 1485 |
| 40 | 200 | 94.5 | 11 | 0 | 0 | 1156 | 1485 |
| 50 | 200 | 94 | 12 | 0 | 0 | 1182 | 1457 |
| 60 | 200 | 81 | 13 | 0 | 25 | 1194 | 1499 |
| 70 | 200 | 94 | 11 | 0 | 1 | 1212 | 1475 |
| 80 | 200 | 91.5 | 17 | 0 | 0 | 1217 | 1498 |
| 90 | 200 | 95 | 10 | 0 | 0 | 1236 | 1477 |
| 100 | 200 | 92.5 | 15 | 0 | 0 | 1203 | 1474 |
| 110 | 200 | 94 | 12 | 0 | 0 | 1182 | 1448 |
| 120 | 200 | 55.5 | 9 | 0 | 80 | 1109 | 1468 |
| 130 | 200 | 0 | 0 | 0 | 200 | — | — |
| 140 | 200 | 0 | 0 | 0 | 200 | — | — |
| 150 | 200 | 0 | 0 | 0 | 200 | — | — |
| 160 | 200 | 79 | 13 | 0 | 29 | 4413 | 8514 |
| 170 | 200 | 95.5 | 9 | 0 | 0 | 1189 | 1455 |
| 180 | 200 | 94 | 12 | 0 | 0 | 1200 | 1473 |
| 190 | 200 | 91 | 18 | 0 | 0 | 1140 | 1462 |
| 200 | 200 | 93 | 14 | 0 | 0 | 1205 | 1486 |
| 210 | 200 | 92.5 | 15 | 0 | 0 | 1180 | 1502 |
| 220 | 131 | 93.1 | 9 | 0 | 0 | 1210 | 1480 |
