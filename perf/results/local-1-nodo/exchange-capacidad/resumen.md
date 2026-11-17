# Capacidad — local-1-nodo

Generado por `perf/capacidad/analizar.mjs` a partir de los crudos de esta carpeta. No editar a mano.

```
corrida: exchange-capacidad   caso: local-1-nodo   entorno: local   target: http://localhost:3000
inicio UTC: 2026-11-17T06:35:57.323Z
fin UTC: 2026-11-17T06:48:03.351Z
zona horaria: UTC
fases: [{"nombre":"escalon-10","tipo":"escalon","rate":10,"duracion":60},{"nombre":"escalon-20","tipo":"escalon","rate":20,"duracion":60},{"nombre":"escalon-40","tipo":"escalon","rate":40,"duracion":60},{"nombre":"escalon-80","tipo":"escalon","rate":80,"duracion":60},{"nombre":"escalon-120","tipo":"escalon","rate":120,"duracion":60},{"nombre":"escalon-160","tipo":"escalon","rate":160,"duracion":60},{"nombre":"escalon-240","tipo":"escalon","rate":240,"duracion":60},{"nombre":"escalon-320","tipo":"escalon","rate":320,"duracion":60},{"nombre":"escalon-480","tipo":"escalon","rate":480,"duracion":60},{"nombre":"escalon-640","tipo":"escalon","rate":640,"duracion":60},{"nombre":"bajada-20","tipo":"bajada","rate":20,"duracion":120}]
RTT de base (GET /): p50 1.5 ms, p95 2.6 ms
commit: 5dadd5c5c9b8c6183ac41f37c823eb0b100d120a
git status --porcelain (sin perf/results):
M perf/root.yaml
artillery: Artillery: 2.0.34
node: v24.22.3   maquina: DESKTOP-BV02RG7 (8 CPU, 8 GiB)   conexion: local
codigo de salida de artillery: 0
```

RTT de base (20 × `GET /`): p50 1.5 ms, p95 2.6 ms.

## Por fase (por hora de salida, sin los primeros 5 s ni los últimos 2 s de cada fase)

Tasas en pedidos/s. «otros» = otros 4xx / otros 5xx. Latencias en ms.

| fase | nominal | enviados/s | respuestas/s | 200/s | 403/s | 503/s | otros/s | timeout/s | conexión/s | % resp. de lo ofrecido | % errores propios | 200 p50 | 200 p95 | 200 p99 | 403 p50 | 403 p95 | cumple B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| escalon-10 | 10 | 10 | 10 | 6 | 3.3 | 0.8 | 0 / 0 | 0 | 0 | 100 | 0 | 966 | 1169 | 1282 | 385 | 551 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-20 | 20 | 20 | 20 | 12.3 | 6.4 | 1.4 | 0 / 0 | 0 | 0 | 100 | 0 | 984 | 1196 | 1260 | 373 | 542 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-40 | 40 | 40 | 40 | 25.3 | 12.5 | 2.2 | 0 / 0 | 0 | 0 | 100 | 0 | 981 | 1191 | 1276 | 381 | 532 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-80 | 80 | 80 | 80 | 48.5 | 26.2 | 5.3 | 0 / 0 | 0 | 0 | 100 | 0 | 979 | 1188 | 1260 | 373 | 544 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-120 | 120 | 120 | 120 | 74.2 | 38.5 | 7.4 | 0 / 0 | 0 | 0 | 100 | 0 | 976 | 1190 | 1262 | 378 | 540 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-160 | 160 | 160 | 160 | 98 | 51.5 | 10.5 | 0 / 0 | 0 | 0 | 100 | 0 | 979 | 1194 | 1267 | 376 | 527 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-240 | 240 | 240 | 240 | 149.9 | 76.2 | 13.9 | 0 / 0 | 0 | 0 | 100 | 0 | 1384 | 2330 | 2542 | 647 | 1657 | ✓ (err ✓, resp ✓, lat ✓) |
| escalon-320 | 320 | 320.1 | 40.7 | 24.3 | 13.6 | 2.8 | 0 / 0 | 279.4 | 0 | 12.7 | 87.3 | 7102 | 9357 | 9863 | 6636 | 9352 | ✗ (err ✗, resp ✗, lat ✗) |
| escalon-480 | 480 | 480.1 | 0 | 0 | 0 | 0 | 0 / 0 | 475.1 | 5 | 0 | 100 | — | — | — | — | — | ✗ (err ✗, resp ✗, lat ✗) |
| escalon-640 | 640 | 640.1 | 6.8 | 3 | 3.1 | 0.8 | 0 / 0 | 615.6 | 17.6 | 1.1 | 98.9 | 16753 | 17043 | 17087 | 16162 | 17012 | ✗ (err ✗, resp ✗, lat ✗) |
| bajada-20 | 20 | 20 | 20 | 12.3 | 6.4 | 1.3 | 0 / 0 | 0 | 0 | 100 | 0 | 997 | 6803 | 9065 | 384 | 4811 |  |

Proporciones de ARCA (sobre respuestas): escalon-10: 403 32.8 %, 503 7.5 % · escalon-20: 403 31.9 %, 503 6.8 % · escalon-40: 403 31.3 %, 503 5.4 % · escalon-80: 403 32.7 %, 503 6.7 % · escalon-120: 403 32.1 %, 503 6.1 % · escalon-160: 403 32.2 %, 503 6.5 % · escalon-240: 403 31.8 %, 503 5.8 % · escalon-320: 403 33.3 %, 503 7 % · escalon-480: 403 — %, 503 — % · escalon-640: 403 45 %, 503 11.6 % · bajada-20: 403 31.9 %, 503 6.6 %

Motivos de los 503: escalon-10 `{"http_5xx":40}` · escalon-20 `{"http_5xx":72}` · escalon-40 `{"http_5xx":114}` · escalon-80 `{"http_5xx":283}` · escalon-120 `{"http_5xx":390}` · escalon-160 `{"http_5xx":555}` · escalon-240 `{"http_5xx":736}` · escalon-320 `{"http_5xx":150}` · escalon-480 `{}` · escalon-640 `{"http_5xx":42}` · bajada-20 `{"http_5xx":150}`

## Recursos (docker stats cada 1 s; CPU en % de un núcleo)

| fase | app CPU máx | app CPU media | app mem máx (MiB) | redis CPU máx | redis CPU media | redis mem máx (MiB) | arca CPU máx | arca CPU media |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| escalon-10 | 9.6 | 5.5 | 87.4 | 3.2 | 1.3 | 5.2 | 4.8 | 1.8 |
| escalon-20 | 12.7 | 8.3 | 114.6 | 4.2 | 1.7 | 4.8 | 6.6 | 2.2 |
| escalon-40 | 18.6 | 12.9 | 116.8 | 5.3 | 2.4 | 5.8 | 4.3 | 2.6 |
| escalon-80 | 31.3 | 25.1 | 125.8 | 7.5 | 4.8 | 8.2 | 7.6 | 5.4 |
| escalon-120 | 47.5 | 39.1 | 138.5 | 11.5 | 7.2 | 11.9 | 10.7 | 8.8 |
| escalon-160 | 55.8 | 49.1 | 151.1 | 13.3 | 9.3 | 16.7 | 15.2 | 12.1 |
| escalon-240 | 116.1 | 94.8 | 176 | 19.1 | 10.7 | 24.3 | 37.1 | 25.8 |
| escalon-320 | 154.8 | 111.7 | 176.6 | 26.7 | 11.2 | 30.2 | 44.4 | 28.8 |
| escalon-480 | 159.7 | 101.3 | 176.8 | 42.8 | 11.5 | 38.7 | 42.8 | 27.8 |
| escalon-640 | 104.8 | 86.9 | 178.5 | 21.8 | 10.2 | 47.4 | 36 | 24 |
| bajada-20 | 92.2 | 14.4 | 179.8 | 13.6 | 2.6 | 53 | 26 | 3.6 |

## Throughput sostenido

- **B = 240 pedidos/s** (p95 de referencia del primer escalón: 1169 ms; tope de latencia: 2338 ms).
- Primer escalón que no cumple: 320 pedidos/s (errores ✗, respuestas ✗, latencia ✗).

## Recuperación (bajada)

Bajada a 20 pedidos/s. Umbral: p95 de los 200 ≤ 1402.8 ms y sin errores propios en una ventana de 5 s.

**Recuperación: 20 s.**

| desde la bajada (s) | enviados | errores propios | p95 200 (ms) |
| --- | --- | --- | --- |
| 0 | 100 | 19 | 11804 |
| 5 | 100 | 0 | 9166 |
| 10 | 100 | 0 | 6690 |
| 15 | 100 | 0 | 1814 |
| 20 | 100 | 0 | 1209 |
| 25 | 100 | 0 | 1151 |
| 30 | 100 | 0 | 1181 |
| 35 | 100 | 0 | 1179 |
| 40 | 100 | 0 | 1181 |
| 45 | 100 | 0 | 1205 |
| 50 | 100 | 0 | 1204 |
| 55 | 100 | 0 | 1229 |
| 60 | 100 | 0 | 1208 |
| 65 | 100 | 0 | 1094 |
| 70 | 100 | 0 | 1192 |
| 75 | 100 | 0 | 1199 |
| 80 | 100 | 0 | 1168 |
| 85 | 100 | 0 | 1154 |
| 90 | 100 | 0 | 1156 |
| 95 | 100 | 0 | 1147 |
| 100 | 100 | 0 | 1191 |
| 105 | 100 | 0 | 1170 |
| 110 | 100 | 0 | 1187 |
| 115 | 95 | 0 | 1212 |

## Control contra Artillery

Códigos: `{"http.codes.403":15271,"http.codes.503":2964,"http.codes.200":28930}` · errores: `{"errors.ERR_SOCKET_TIMEOUT":80557,"errors.ECONNRESET":1278}`

Escenarios creados: 129000, fallidos: 81835, líneas en pedidos.jsonl: 129000.
