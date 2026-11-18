# Observaciones: E10, lectura de tasas, 1 nodo B2als_v2

- **Corrida:** 18/11, de 01:16:43 a 01:19:34 UTC, desde la generadora por cable, con
  `perf/tacticas-nginx/correr.sh` y reset antes.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 2 (891d9a9).

## Resultado

| Fase (pedidos/s × s) | Pedidos | 200 | 403 | 503 | Sin respuesta | /rates: mediana / p95 (ms) |
|---|---|---|---|---|---|---|
| 12 × 30 | 345 | 317 | 20 | 0 | 0 | 162 / 169 |
| 120 × 120 | 14.415 | 13.354 | 909 | 160 | 0 | 159 / 166 |

En total 14.760 pedidos: 11.836 `GET /rates` y 2.924 `POST /exchange`, 0 errores. El p95 de la tabla es la mediana de
los p95 por ventana de 10 s; el agregado de toda la corrida da 165,7 ms.

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Errores y timeouts | 0 | 0 | ✓ |
| GET /rates en la app, fase de 120 | mediana ≤ 1,2 ms, p95 ≤ 5 ms | mediana 0,60 ms (máx. 0,81), p95 1,06 ms (máx. 1,40) | ✓ |
| GET /rates en el cliente | p50 163 ± 3 ms, p95 ≤ 175 ms | p50 159,2 ms, p95 165,7 ms | ✓ |
| POST, 200 en el cliente | p95 1.350 ± 70 ms en `http.response_time.2xx` | no se puede leer así (abajo) | ✗ métrica mal elegida |
| Mezcla de ARCA (sobre los POST) | 62 / 32 / 6 % ± 3 | 62,8 / 31,8 / 5,5 % | ✓ |
| CPU del proceso, fase de 120 | 10 ± 4 % de un núcleo; /rates cerca de la mitad | 12,2 % (9,4 user, 2,8 system); /rates unos 7,4 puntos (61 %) si el POST cuesta 2,0 ms, entre 51 y 70 % si cuesta de 2,5 a 1,5 ms | ✓ |
| Redis | unas 450 op/s, procesador ≤ 18 % | 417 a 481 op/s, procesador 15 a 16 % | ✓ |
| Conntrack máximo | 9.000 a 14.500, sin `table full` | 12.105, sin `table full` | ✓ |

**Los POST.** El criterio se escribió sobre `http.response_time.2xx`, y en E10 los 2xx mezclan los 11.836 GET (p95
1.176 ms). Lo que sí se puede leer queda dentro de la predicción: `/exchange` con todos sus códigos da p50 1.023 y p95
1.300 ms, y en la app `POST.exchange` da p95 1.149 ms, igual que en la primera fase de E7, sin GET (1.146 a 1.170).

La CPU del proceso cuenta desde el primer contador de Artillery (01:17:01,1). Redis sale de las dos muestras por
minuto con carga (01:19 y 01:20). La VM estuvo en unos 8 % (Datadog), sin steal, y los créditos siguieron subiendo.

## Qué se lee

- El p50 de `/rates` (159,2 ms) es la misma latencia que el RTT de base (162,4) dentro de un balde de Artillery: casi
  toda la latencia es la red. El servidor tarda 1 ms, que es lo máximo que podría ahorrar una caché.
- Ningún criterio de la microcaché se acerca a su umbral; la tabla está en
  [`resultados-tacticas-nginx.md`](../../resultados-tacticas-nginx.md).
