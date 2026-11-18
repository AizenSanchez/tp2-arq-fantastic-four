# Observaciones: E8, carga representativa, 1 nodo B2als_v2

- **Corrida:** 18/11, de 01:32:54 a 01:43:18 UTC, desde la generadora por cable, con
  `perf/tacticas-nginx/correr.sh` y reset antes.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 4 (00815bb).

## Resultado

7.200 usuarios, 21.600 pedidos, 0 errores y 0 usuarios fallidos. `/rates` y `/accounts`: 7.200 200 cada uno.
`/exchange`: 4.404 200, 2.301 403 y 495 503.

| Endpoint (cliente) | mediana | p95 | p99 (ms) |
|---|---|---|---|
| `/rates` | 162,4 | 169 | 172,5 |
| `/accounts` | 162,4 | 169 | 172,5 |
| `/exchange` (todos los códigos) | 1.022,7 | 1.326,4 | 1.408,4 |
| `vusers.session_length` | 3.534,1 | 4.770,6 | 4.867 |

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Errores, timeouts y usuarios fallidos | 0 | 0 | ✓ |
| Mezcla de ARCA (sobre los POST) | 62 / 32 / 6 % ± 3 | 61,2 / 32,0 / 6,9 % | ✓ |
| `/rates` en el cliente | p50 163 ± 3, p95 ≤ 175 ms | 162,4 / 169 ms | ✓ |
| `/accounts` en el cliente | p50 163 ± 3, p95 ≤ 182 ms | 162,4 / 169 ms | ✓ |
| `/exchange` en el cliente | p95 1.300 ± 70 ms | 1.326,4 ms | ✓ |
| `GET.rates` y `GET.accounts` en la app | p95 ≤ 3 ms | `GET.rates` 0,97 ms (máx. 2,97), `GET.accounts` 1,15 ms (máx. 2,46), mediana de las ventanas de 10 s | ✓ |
| `vusers.session_length` | mediana 3.300 ± 500, p95 ≤ 5.000 ms | 3.534 / 4.771 ms | ✓ |
| CPU del proceso | 4 ± 2 % de un núcleo | 4,6 % (3,7 user, 0,9 system) | ✓ |
| Redis | unas 200 op/s, procesador ≤ 16 % | 204 a 237 op/s; procesador **16 a 28 %** | ✓ en op/s, ✗ en procesador |
| Conntrack máximo | 1.400 a 3.000, sin `table full` | 2.502, sin `table full` | ✓ (sin explicar, abajo) |
| Créditos de CPU | suben | de 94,6 a 100,3 | ✓ |

**Procesador de Redis.** El `percentProcessorTime` de `Balanced_B0` no sigue a la carga. Acá estuvo en 16 % a 220
op/s hasta las 01:37 y pasó a 24 a 28 % desde las 01:38 con la misma tasa; en el minuto ocioso antes de la corrida
marcó 36 %. En la corrida de capacidad dio 23 % a 4.650 op/s, y en el pico de 6B con 2 nodos, 13 a 18,5 % a unas
10.400 op/s, 50 veces más que acá. Por eso para Redis miramos la tasa de operaciones y no el procesador.

**Conntrack.** La cuenta da 12 usuarios/s × 120 s = 1.440 entradas, y se midieron 2.502 (1,7 ×). Entraba en el rango
predicho, pero el tope de 3.000 no salía de una cuenta y no sabemos de dónde vienen las entradas de más.

## Qué se lee

A 36 pedidos/s nada se acerca a un límite (proceso al 4,6 %, ARCA en 8 a 9 milicores, conntrack al 4 % de la tabla).
Ninguna de las dos tácticas cambia algo en este escenario.
