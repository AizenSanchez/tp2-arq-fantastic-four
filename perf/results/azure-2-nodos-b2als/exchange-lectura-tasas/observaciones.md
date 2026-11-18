# Observaciones: E10, lectura de tasas, 2 nodos B2als_v2

- **Corrida:** 18/11, de 03:29:22 a 03:32:13 UTC, desde la generadora por cable, con
  `perf/tacticas-nginx/correr.sh` y reset antes.
- **Despliegue:** el mismo de `azure-1-nodo-b2als/` con `instances = 2` (332e386); evidencia en
  `evidencia/tacticas-nginx-2-nodos/`.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 6 (e0ab4d3).

## Resultado

| Fase (pedidos/s × s) | Pedidos | 200 | 403 | 503 | Sin respuesta | /rates: mediana / p95 (ms) |
|---|---|---|---|---|---|---|
| 12 × 30 | 393 | 332 | 20 | 5 | 0 | 162 / 169 |
| 120 × 120 | 14.367 | 13.285 | 935 | 183 | 0 | 159 / 162 |

En total 14.760 pedidos, 0 errores. El p95 de la tabla es la mediana de los p95 por ventana de 10 s; el agregado de
toda la corrida da 165,7 ms, igual que con 1 nodo.

Reparto entre nodos, contado por la app en cada uno (`perf/tacticas-nginx/datadog-reparto.mjs`):

| Ruta | tp2vmss000000 | tp2vmss000001 | Total |
|---|---|---|---|
| GET.rates | 5.972 (50,6 %) | 5.838 (49,4 %) | 11.810 |
| POST.exchange | 1.417 (48,0 %) | 1.533 (52,0 %) | 2.950 |
| todo | 7.389 (50,1 %) | 7.371 (49,9 %) | 14.760 |

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Reparto entre nodos | 50 ± 3 % | 50,1 / 49,9 % | ✓ |
| Errores | 0 | 0 | ✓ |
| `/rates` en el cliente | p50 159 ± 3, p95 ≤ 170 ms | 159,2 / 162,4 ms | ✓ |
| `GET.rates` en la app | p95 ≤ 1,2 ms | 1,31 y 1,69 ms (mediana de las ventanas de 10 s; máximo 1,80 y 2,88) | ✗ |
| CPU del proceso, fase de 120 | 6 ± 2 % por nodo | 7,0 y 8,0 % | ✓ |
| Redis | 417 a 481 op/s | 474 y 445 op/s | ✓ |
| Conntrack máximo | 5.000 a 7.000 por nodo | 6.320 y 6.255, sin `table full` | ✓ |

**`GET.rates`.** Con 2 nodos el tiempo de servidor de `/rates` es 0,2 a 0,6 ms mayor que con 1, acá y en E8 (1,23 y
1,59 contra 0,97), con cargas muy distintas: sigue al despliegue, no a la tasa. No sabemos por qué; igual está muy
lejos del umbral de 17 ms.

## Qué se lee

Duplicar los nodos parte la carga en dos y no cambia nada de lo que ve el cliente: `/rates` sigue en la latencia de la
red. La CPU por nodo baja a 7 y 8 %, el conntrack a la mitad y Redis queda igual porque la carga total es la misma.
