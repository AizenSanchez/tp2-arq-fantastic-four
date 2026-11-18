# Caracterización del nodo Standard_B2als_v2 (18/11, UTC)

Desde la generadora por cable, un endpoint por corrida.

| corrida | pedidos | códigos | http.response_time p50 / p95 / p99 (ms) |
|---|---|---|---|
| GET / a 1 pedidos/s, 60 s (latencia de base) | 60 | 200: 60 | 162,4 / 169 / 169 |
| GET /rates a 20 pedidos/s, 60 s | 1.200 | 200: 1.200 | 162,4 / 169 / 172,5 |
| GET /accounts a 20 pedidos/s, 60 s | 1.200 | 200: 1.200 | 162,4 / 175,9 / 179,5 |
| POST /exchange ARS a USD a 20 pedidos/s, 60 s | 1.200 | 200: 749 (62 %), 403: 379 (32 %), 503: 72 (6 %) | 1.022,7 / 1.326,4 / 1.408,4 |

- GET /rates y GET /accounts quedan a menos de 10 ms de la latencia de base: el servidor no se nota a 20 pedidos/s.
- CPU por pedido en `cpu-por-pedido.txt`: POST unos 3,5 ms, GET unos 0,9 ms.
- Red y conntrack del nodo en `evidencia/tacticas-nginx/nodo-red.txt`: `nf_conntrack_max` 65.536. Es el valor que el
  kernel da a una VM de más de 1 GiB, así que el F1als_v7 de 2 GiB del bloque 1 tendría el mismo (no se midió allá).
