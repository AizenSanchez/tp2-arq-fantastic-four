# Observaciones: E8, carga representativa, 2 nodos B2als_v2

- **Corrida:** 18/11, de 03:33:27 a 03:43:50 UTC, desde la generadora por cable, con
  `perf/tacticas-nginx/correr.sh` y reset antes.
- **Despliegue:** el mismo de E10 con 2 nodos (`../exchange-lectura-tasas/`).
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 6 (e0ab4d3).

## Resultado

| Fase | Pedidos | 200 | 403 | 503 | Sin respuesta | /rates: mediana / p95 | /accounts: mediana / p95 | /exchange: mediana / p95 (ms) |
|---|---|---|---|---|---|---|---|---|
| 12 usuarios/s × 600 s | 21.600 | 18.835 | 2.309 | 456 | 0 | 162 / 169 | 162 / 169 | 1.023 / 1.326 |

`vusers.session_length`: mediana 3.534, p95 4.676 ms; 7.200 usuarios completos, 0 fallidos. Con 1 nodo dio los mismos
percentiles salvo el p95 de la sesión (4.771).

Reparto (`perf/tacticas-nginx/datadog-reparto.mjs`): 3.654 pedidos de cada ruta en tp2vmss000000 (50,8 %) y 3.546 en
tp2vmss000001 (49,3 %). Las tres rutas dan la misma cuenta en cada nodo porque cada usuario hace sus tres pedidos por
la misma conexión y el Load Balancer reparte por conexión: una sesión entera cae en un nodo.

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Reparto entre nodos | 50 ± 3 % | 50,8 / 49,3 % | ✓ |
| Errores | 0 | 0 | ✓ |
| `/rates` y `/accounts` | p50 162 ± 3, p95 ≤ 172 ms | 162 / 169 las dos | ✓ |
| `/exchange` | p95 1.326 ± 70 ms | 1.326 | ✓ |
| `vusers.session_length` | mediana 3.300 a 3.800, p95 ≤ 5.000 ms | 3.534 / 4.676 | ✓ |
| CPU del proceso (s 30 a 590) | 2,3 ± 1,5 % por nodo | 2,7 y 2,8 % | ✓ |
| Conntrack máximo | 1.000 a 1.700 por nodo | 1.465 y 1.418 (desde las 03:35:30; antes quedan las entradas de E10) | ✓ |

En la app, por nodo (mediana de las ventanas de 10 s): `GET.rates` p95 1,23 y 1,59 ms, `POST.exchange` p95 1.151 y
1.145 ms, `arca.ms` p95 522 y 529 ms, 0 timeouts a ARCA. Redis de 200 a 229 op/s (promedio por minuto), lo mismo que
con 1 nodo, con el procesador en 12 a 14 % salvo los dos últimos minutos (22 y 30 %) a la misma tasa.

## Qué se lee

Con la carga representativa el segundo nodo no cambia nada que vea el cliente: la latencia es la de la red más la de
ARCA, y ninguna de las dos depende de cuántos nodos haya. Cada nodo queda casi vacío (menos del 3 % de un núcleo).
