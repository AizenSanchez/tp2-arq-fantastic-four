# Observaciones: E7, pico de 2B, 1 nodo B2als_v2

- **Corrida:** 18/11, de 01:23:24 a 01:27:05 UTC (el pico, de 01:24:41 a 01:25:01), desde la generadora por cable,
  con `perf/tacticas-nginx/correr.sh` y reset antes.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 3 (709c7c1).

## Resultado

| Fase (pedidos/s × s) | Pedidos | 200 | 403 | 503 | Sin respuesta | 2xx: mediana / p95 (ms) |
|---|---|---|---|---|---|---|
| 24 × 60 | 1.418 | 843 | 455 | 97 | 0 | 1.130 / 1.326 |
| 240 × 20 | 4.652 | 2.675 | 1.436 | 299 | 0 | 1.130 / 1.353 |
| 24 × 120 | 3.050 | 2.127 | 996 | 192 | 0 | 1.153 / 1.353 |

Por ventanas de 10 s (`tabla-fases.py --ventanas`) el p95 de los 200 va de 1.300 a 1.380 ms en todas, con y sin pico.
En total 9.120 pedidos, 0 errores, 0 429.

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Errores, timeouts y sin respuesta | 0 | 0 | ✓ |
| 429 | 0 (ausencia de la táctica) | 0 | |
| p95 de los 200 en el pico | ≤ 1,05 × el de la primera fase | 1.353 contra 1.326 ms (un balde de Artillery: sin cambio) | ✓ |
| `POST.exchange` en la app | p95 sin escalón (± 5 %) | 1.146 a 1.170 ms antes y durante el pico, 1.163 a 1.197 después | ✓ |
| Mezcla de ARCA | 62 / 32 / 6 % ± 3 también en el pico | pico 60,7 / 32,6 / 6,8 % de las respuestas de la fase; total 61,9 / 31,7 / 6,4 % | ✓ |
| CPU del proceso en el pico | 41 ± 5 % de un núcleo | 46 % (de 42 a 49 cada 2 s) | ✓, en el borde |
| Conntrack máximo | 3.700 a 5.800, sin `table full` | **8.377** (01:26:41), sin `table full` | ✗ |
| Recuperación | 0 s | 0 s: ninguna ventana después del pico sale del rango de antes | ✓ |

**Conntrack.** El factor de 0,5 a 0,8 salió de la meseta de la corrida de capacidad, que quedó limitada por los puertos
de la generadora (ver `exchange-capacidad/observaciones.md`). En un pico corto no hay meseta: cada conexión deja una
entrada y nada vence antes de los 120 s. A las 01:26:41 conviven las de la primera fase (24 × 60 = 1.440), las del
pico (4.800) y las de los 100 s siguientes (2.400): 8.640, contra 8.377 medidas. Las de ARCA no suman, porque van por
un pool con keep-alive. Las entradas se van en tandas, unos 150 s después de creadas. 8.377 es el 13 % de la tabla.

ARCA: p95 de `arca.ms` entre 502 y 558 ms antes, durante y después del pico, sin timeouts. Redis: Azure Monitor no ve
un pico de 20 s (667 op/s como máximo en el minuto); lo que muestra que Redis no frenó el pico es `POST.exchange`, que
incluye sus viajes a Redis y no se movió.

## Qué se lee

El pico a 2B entra entero: 0 rechazos y el mismo p95. El proceso llega al 46 % de un núcleo y ni `POST.exchange` ni
ARCA cambian, así que el criterio del limitador no se dispara. Este pico no supera al nodo; eso se mide en
`exchange-spike-alto/`.
