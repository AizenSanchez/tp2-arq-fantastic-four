# Disponibilidad — azure-tactica-probe

Generado por `perf/disponibilidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
caso: azure-tactica-probe   entorno: azure   target: http://gunegfcioh.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-18T22:54:07.029Z
fin UTC: 2026-11-18T22:59:55.136Z
zona horaria: America/Buenos_Aires
carga: 20 pedidos/s durante 300 s   fallas: kill-9@60s pm2-stop@120s pm2-start@150s kill-STOP@210s kill-CONT@240s   nodo: vmss[0]
commit: e0c2c7373805c6fd02cf4cc3a1414c1d176d471c
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
| 6000 | 5411 (90.2 %) | 373 | 0 | 216 | 1 |

Por estado: `{"200":3533,"403":1878,"503":373,"sin respuesta":216}` · por nodo: `{"tp2vmss000001":3390,"tp2vmss000000":2394,"?":216}`

Errores de Artillery: `{"errors.ECONNRESET":9,"errors.ECONNREFUSED":130,"errors.ERR_SOCKET_TIMEOUT":77}`

## Latencia de base (30 `GET /` sin carga, conexión nueva)

mínimo 298 ms · p50 309 ms · p95 328 ms

## Referencia sin fallas (pedidos válidos de los segundos 5 a 30)

| estado | n | mediana (ms) | p95 (ms) |
| --- | --- | --- | --- |
| 200 | 0 | — | — |
| 403 | 0 | — | — |
| 422 | 0 | — | — |

## Pedidos inválidos (E9, segundos 30 a 40)

- Enviados: 0 (DNI inválido 0, moneda XYZ 0).
- Respuestas a los inválidos: `{}`. Mediana de un 400: null ms (— ms sobre la base).
- Respuestas a los válidos de la misma ventana: `{}`.

## Efecto de cada falla

Segundos desde el inicio de la corrida. t_rec: hasta el primer segundo de 3 seguidos sin fallas propias, contando cada pedido en el segundo en que salió. Primera respuesta: cuándo le vuelve a llegar una respuesta a un pedido que salió después de la falla.

| falla | plan (s) | real (s) | restaurada (s) | fallas propias desde-hasta (s) | t_rec (s) | t_rec desde la restauración (s) | primera respuesta (s) | sin respuestas desde la falla / la restauración (s) | pedidos afectados (perdidos / 5xx) | atendidos > 2 s | latencia máx (ms) | /health no 200 (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kill-9 | 60 | 74 | — | 73–74 | 1 | — | 75 | 0.6 / — | 10 (10 / 0) | 0 | 1656 | 0 |
| pm2-stop | 120 | 126 | 155 | 126–137 | 29 | 0 | 155.6 | 28.9 / 0 | 129 (129 / 0) | 0 | 1649 | 7 (129–136) |
| kill-STOP | 210 | 215 | 245 | 214–228 | 30 | 0 | 245.6 | 30.1 / 0.1 | 77 (77 / 0) | 30 | 6456 | 1 (218–218) |

## Errores de Artillery por período (cuándo ocurrió el error, no cuándo salió el pedido)

| período (s) | errores |
| --- | --- |
| 72–82 | `{"errors.ECONNRESET":8,"errors.ECONNREFUSED":2}` |
| 122–132 | `{"errors.ECONNREFUSED":80,"errors.ECONNRESET":1}` |
| 132–142 | `{"errors.ECONNREFUSED":48}` |
| 222–232 | `{"errors.ERR_SOCKET_TIMEOUT":58}` |
| 232–242 | `{"errors.ERR_SOCKET_TIMEOUT":19}` |

## Cambios de estado del monitor de /health

0 s → 200 · 129.1 s → ECONNREFUSED · 131.1 s → 200 · 132.1 s → ECONNREFUSED · 137.1 s → 200 · 218.1 s → TimeoutError · 219.1 s → 200

## Estado del probe del balanceador por nodo (Azure Monitor, % de probes exitosos por minuto)

| IP del nodo | 22:52 (-127 s) | 22:53 (-67 s) | 22:54 (-7 s) | 22:55 (53 s) | 22:56 (113 s) | 22:57 (173 s) | 22:58 (233 s) | 22:59 (293 s) | 23:00 (353 s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10.0.2.5 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| 10.0.2.4 | 100 | 100 | 100 | 100 | 100 | 50 | 42 | 83 | 100 |

Qué IP es cada nodo: `azure-monitor/LEEME.txt`. El segundo entre paréntesis es el comienzo de cada minuto desde el inicio de la corrida.

## Ventanas de 10 s

| desde (s) | enviados | % atendido | 503 ARCA | otros 5xx | sin respuesta | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | — | 0 | 0 | 0 | — | — |
| 10 | 0 | — | 0 | 0 | 0 | — | — |
| 20 | 0 | — | 0 | 0 | 0 | — | — |
| 30 | 0 | — | 0 | 0 | 0 | — | — |
| 40 | 125 | 94.4 | 7 | 0 | 0 | 1184 | 1512 |
| 50 | 200 | 93 | 14 | 0 | 0 | 1222 | 1507 |
| 60 | 200 | 90.5 | 19 | 0 | 0 | 1205 | 1481 |
| 70 | 200 | 88.5 | 13 | 0 | 10 | 1199 | 1512 |
| 80 | 200 | 94.5 | 11 | 0 | 0 | 1218 | 1472 |
| 90 | 200 | 95 | 10 | 0 | 0 | 1219 | 1494 |
| 100 | 200 | 93.5 | 13 | 0 | 0 | 1186 | 1468 |
| 110 | 200 | 92.5 | 15 | 0 | 0 | 1158 | 1483 |
| 120 | 200 | 73.5 | 8 | 0 | 45 | 1151 | 1480 |
| 130 | 200 | 54.5 | 7 | 0 | 84 | 1193 | 1513 |
| 140 | 200 | 95.5 | 9 | 0 | 0 | 1202 | 1482 |
| 150 | 200 | 92 | 16 | 0 | 0 | 1143 | 1483 |
| 160 | 200 | 92 | 16 | 0 | 0 | 1211 | 1469 |
| 170 | 200 | 96.5 | 7 | 0 | 0 | 1208 | 1508 |
| 180 | 200 | 92.5 | 15 | 0 | 0 | 1205 | 1463 |
| 190 | 200 | 88 | 24 | 0 | 0 | 1192 | 1476 |
| 200 | 200 | 92.5 | 15 | 0 | 0 | 1159 | 1469 |
| 210 | 200 | 74.5 | 6 | 0 | 45 | 1218 | 1455 |
| 220 | 200 | 78 | 12 | 0 | 32 | 1249 | 1452 |
| 230 | 200 | 93 | 14 | 0 | 0 | 1174 | 1488 |
| 240 | 200 | 93.5 | 13 | 0 | 0 | 1228 | 1474 |
| 250 | 200 | 95 | 10 | 0 | 0 | 1222 | 1600 |
| 260 | 200 | 97.5 | 5 | 0 | 0 | 1256 | 1634 |
| 270 | 200 | 94.5 | 11 | 0 | 0 | 1237 | 1618 |
| 280 | 200 | 94.5 | 11 | 0 | 0 | 1222 | 1602 |
| 290 | 200 | 92 | 16 | 0 | 0 | 1234 | 1568 |
| 300 | 200 | 90.5 | 19 | 0 | 0 | 1257 | 1621 |
| 310 | 200 | 92 | 16 | 0 | 0 | 1238 | 1512 |
| 320 | 200 | 97 | 6 | 0 | 0 | 1202 | 1483 |
| 330 | 200 | 95 | 10 | 0 | 0 | 1223 | 1526 |
| 340 | 75 | 93.3 | 5 | 0 | 0 | 1165 | 1517 |
