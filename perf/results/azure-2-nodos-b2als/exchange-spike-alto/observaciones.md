# Observaciones: E7 alto, pico de 6B (720 pedidos/s), 2 nodos B2als_v2

- **Corrida:** 18/11, de 03:47:11 a 03:50:51 UTC (el pico, de 03:48:29 a 03:48:49), desde la generadora por cable,
  con `perf/tacticas-nginx/correr.sh` y reset antes.
- **Despliegue:** el mismo escenario que `azure-1-nodo-b2als/exchange-spike-alto/`, con `instances = 2`.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 6 (e0ab4d3).

## Resultado

| Fase (pedidos/s × s) | Pedidos | 200 | 403 | 503 | Sin respuesta | 2xx: mediana / p95 (ms) |
|---|---|---|---|---|---|---|
| 24 × 60 | 2.595 | 997 | 682 | 143 | 0 | 1.130 / 1.326 |
| 720 × 20 | 13.279 | 8.816 | 4.381 | 829 | 0 | 1.153 / 1.353 |
| 24 × 120 | 2.846 | 1.844 | 862 | 166 | 0 | 1.130 / 1.353 |

En las dos ventanas de 10 s del pico Artillery manda 7.200 y 6.079 pedidos y recibe 7.174 y 6.852 respuestas: el
sistema contesta al ritmo al que le piden. El p95 de los 200 es de 1.353 ms en las dos, el p99 de 1.437 y el máximo de
1.582. En total 18.720 pedidos, 18.720 respuestas, 0 timeouts, 0 429. Reparto: 9.409 `POST /exchange` en
tp2vmss000000 (50,3 %) y 9.311 en tp2vmss000001 (49,7 %).

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Reparto entre nodos | 50 ± 3 % | 50,3 / 49,7 % | ✓ |
| Errores y timeouts | 0 | 0 | ✓ |
| p95 de los 200 en el pico | ≤ 1,1 × el de la primera fase | 1.353 contra 1.326 (un balde de Artillery) | ✓ |
| 503 en el pico | 6 ± 3 % | 5,9 % de las respuestas, todos de la falla inyectada; 0 timeouts a ARCA | ✓ |
| CPU del proceso en el pico (s 60 a 82) | 55 a 75 % por nodo | 73,8 y 72,3 % (user 57,1 y 56,9); muestras de 2 s entre 69 y 86 % | ✓ |
| Conntrack máximo | 8.000 a 11.000 por nodo | 8.155 y 8.141, sin `table full` | ✓ |
| Recuperación | 0 s | la ventana que sigue al pico ya está en 1.353 | ✓ |
| Criterio del limitador | no se dispara | no se dispara | ✓ |

**Cola de `listen`.** `TcpExtListenOverflows` no se movió en ningún nodo: 0 nuevos (tp2vmss000000 arrastra los 17.788
de E7 alto con 1 nodo, ver `../exchange-lectura-tasas/nodo-0/kernel.txt`; tp2vmss000001 está en 0). `TCPSynRetrans`
tampoco: 2.345 y 33 antes y después de la corrida (`../exchange-representativa/nodo-*/kernel.txt`).

**Redis y ARCA.** En la app, `POST.exchange` p95 es de 1.108 a 1.180 ms antes del pico, 1.167 a 1.176 en el pico y
1.124 a 1.211 después en los dos nodos, y `arca.ms` p95 de 490 a 570 en toda la corrida: no sube más de 10 %, que es
el criterio predicho para decir que Redis no limitó. Azure Monitor da 10.406 op/s de Redis como máximo en el minuto del
pico, pero con 1 nodo la misma métrica dio 4.336 para un pico parecido, así que no la usamos para comparar con la
cuenta de 14,5 op por POST. ARCA llega a 123 milicores de 500.

**VM y créditos.** Datadog da 40,8 y 42,5 % de la VM en el pico. Los créditos suben de 88,3 a 89,8 durante la corrida.

## Qué se lee

El mismo pico de 6B que con 1 nodo dispara el criterio, con 2 nodos entra entero: cada proceso recibe 360 pedidos/s,
debajo de su techo de unos 570, y llega al 74 % de un núcleo en el peor caso.
