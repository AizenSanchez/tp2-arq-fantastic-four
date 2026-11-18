# Disponibilidad — azure-escalado

Generado por `perf/disponibilidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
caso: azure-escalado   entorno: azure   target: http://gunegfcioh.eastus2.cloudapp.azure.com
inicio UTC: 2026-11-18T02:38:15.395Z
fin UTC: 2026-11-18T02:43:36.864Z
zona horaria: America/Buenos_Aires
carga: 20 pedidos/s durante 300 s   fallas: kill-9@60s pm2-stop@120s pm2-start@150s kill-STOP@210s kill-CONT@240s   nodo: vmss[0]
commit: 240a9518d5684eb51efa4213904bec2799d26cea
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
| 6000 | 5201 (86.7 %) | 333 | 0 | 466 | 1 |

Por estado: `{"200":3433,"400":29,"403":1739,"503":333,"sin respuesta":466}` · por nodo: `{"tp2vmss000000":2403,"tp2vmss000001":3131,"?":466}`

Errores de Artillery: `{"errors.ECONNRESET":14,"errors.ECONNREFUSED":327,"errors.ERR_SOCKET_TIMEOUT":125}`

## Latencia de base (30 `GET /` sin carga, conexión nueva)

mínimo 304 ms · p50 316 ms · p95 324 ms

## Referencia sin fallas (pedidos válidos de los segundos 5 a 30)

| estado | n | mediana (ms) | p95 (ms) |
| --- | --- | --- | --- |
| 200 | 159 | 1297 | 1483 |
| 403 | 74 | 716 | 896 |
| 422 | 0 | — | — |

## Pedidos inválidos (E9, segundos 30 a 40)

- Enviados: 29 (DNI inválido 13, moneda XYZ 16).
- Respuestas a los inválidos: `{"400":29}`. Mediana de un 400: 316 ms (0 ms sobre la base).
- Respuestas a los válidos de la misma ventana: `{"200":106,"403":54,"503":11}`.

## Efecto de cada falla

Segundos desde el inicio de la corrida. t_rec: hasta el primer segundo de 3 seguidos sin fallas propias, contando cada pedido en el segundo en que salió. Primera respuesta: cuándo le vuelve a llegar una respuesta a un pedido que salió después de la falla.

| falla | plan (s) | real (s) | restaurada (s) | fallas propias desde-hasta (s) | t_rec (s) | t_rec desde la restauración (s) | primera respuesta (s) | sin respuestas desde la falla / la restauración (s) | pedidos afectados (perdidos / 5xx) | atendidos > 2 s | latencia máx (ms) | /health no 200 (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| kill-9 | 60 | 76 | — | 75–76 | 1 | — | 77.4 | 0.9 / — | 21 (21 / 0) | 0 | 1613 | 0 |
| pm2-stop | 120 | 126 | 155 | 126–152 | 29 | 0 | 155.5 | 28.9 / 0 | 320 (320 / 0) | 0 | 1690 | 0 |
| kill-STOP | 210 | 215 | 245 | 214–236 | 30 | 0 | 245.7 | 30.2 / 0.1 | 125 (125 / 0) | 48 | 10158 | 0 |

## Errores de Artillery por período (cuándo ocurrió el error, no cuándo salió el pedido)

| período (s) | errores |
| --- | --- |
| 74–84 | `{"errors.ECONNRESET":13,"errors.ECONNREFUSED":8}` |
| 124–134 | `{"errors.ECONNREFUSED":101,"errors.ECONNRESET":1}` |
| 134–144 | `{"errors.ECONNREFUSED":119}` |
| 144–154 | `{"errors.ECONNREFUSED":99}` |
| 214–224 | `{"errors.ERR_SOCKET_TIMEOUT":2}` |
| 224–234 | `{"errors.ERR_SOCKET_TIMEOUT":68}` |
| 234–244 | `{"errors.ERR_SOCKET_TIMEOUT":46}` |
| 244–254 | `{"errors.ERR_SOCKET_TIMEOUT":9}` |

## Cambios de estado del monitor de /health

0 s → 200

## Estado del probe del balanceador por nodo (Azure Monitor, % de probes exitosos por minuto)

| IP del nodo | 02:36 (-135 s) | 02:37 (-75 s) | 02:38 (-15 s) | 02:39 (45 s) | 02:40 (105 s) | 02:41 (165 s) | 02:42 (225 s) | 02:43 (285 s) | 02:44 (345 s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10.0.2.4 | 100 | 45 | 92 | 100 | 100 | 46 | 100 | 100 | 100 |
| 10.0.2.5 | 0 | 0 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

Qué IP es cada nodo: `azure-monitor/LEEME.txt`. El segundo entre paréntesis es el comienzo de cada minuto desde el inicio de la corrida.

## Ventanas de 10 s

| desde (s) | enviados | % atendido | 503 ARCA | otros 5xx | sin respuesta | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | — | 0 | 0 | 0 | — | — |
| 10 | 46 | 95.7 | 2 | 0 | 0 | 1205 | 1452 |
| 20 | 200 | 94.5 | 11 | 0 | 0 | 1234 | 1441 |
| 30 | 200 | 94.5 | 11 | 0 | 0 | 1118 | 1459 |
| 40 | 200 | 96 | 8 | 0 | 0 | 1203 | 1477 |
| 50 | 200 | 94 | 12 | 0 | 0 | 1801 | 5664 |
| 60 | 200 | 92 | 16 | 0 | 0 | 1235 | 1523 |
| 70 | 200 | 85 | 9 | 0 | 21 | 1204 | 1512 |
| 80 | 200 | 93 | 14 | 0 | 0 | 1207 | 1509 |
| 90 | 200 | 94 | 12 | 0 | 0 | 1225 | 1456 |
| 100 | 200 | 97 | 6 | 0 | 0 | 1244 | 1481 |
| 110 | 200 | 93 | 14 | 0 | 0 | 1196 | 1486 |
| 120 | 200 | 76.5 | 8 | 0 | 39 | 1188 | 1478 |
| 130 | 200 | 35 | 3 | 0 | 127 | 1109 | 1457 |
| 140 | 200 | 33 | 6 | 0 | 128 | 1190 | 1467 |
| 150 | 200 | 79 | 16 | 0 | 26 | 1165 | 1444 |
| 160 | 200 | 93.5 | 13 | 0 | 0 | 1171 | 1502 |
| 170 | 200 | 93 | 14 | 0 | 0 | 1211 | 1461 |
| 180 | 200 | 95 | 10 | 0 | 0 | 1206 | 1467 |
| 190 | 200 | 93.5 | 13 | 0 | 0 | 1220 | 1487 |
| 200 | 200 | 94.5 | 11 | 0 | 0 | 1219 | 1493 |
| 210 | 200 | 70 | 15 | 0 | 45 | 1205 | 1463 |
| 220 | 200 | 68 | 4 | 0 | 60 | 1197 | 1469 |
| 230 | 200 | 85.5 | 9 | 0 | 20 | 1185 | 8539 |
| 240 | 200 | 94.5 | 11 | 0 | 0 | 1233 | 3402 |
| 250 | 200 | 89.5 | 21 | 0 | 0 | 1235 | 1626 |
| 260 | 200 | 97 | 6 | 0 | 0 | 1244 | 1532 |
| 270 | 200 | 95.5 | 9 | 0 | 0 | 1214 | 1547 |
| 280 | 200 | 94 | 12 | 0 | 0 | 1210 | 1557 |
| 290 | 200 | 91.5 | 17 | 0 | 0 | 1218 | 1498 |
| 300 | 200 | 95 | 10 | 0 | 0 | 1179 | 1531 |
| 310 | 154 | 93.5 | 10 | 0 | 0 | 1204 | 1462 |
