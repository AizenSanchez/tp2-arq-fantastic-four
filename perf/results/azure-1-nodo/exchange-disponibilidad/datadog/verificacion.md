# Datadog contra los crudos — azure-1-nodo

Generado por `perf/disponibilidad/verificar-datadog.mjs` el 2026-11-18T20:28:40.181Z. Rango: 2026-11-18T01:49:40.000Z a 2026-11-18T01:55:32.000Z (la corrida de `meta.txt` con 60 s de margen).

Datadog agrega cada 10 s y las métricas del servidor viajan por UDP: una diferencia chica es esperable; una grande, no.

| qué | crudo | de dónde | Datadog | diferencia | % |
| --- | --- | --- | --- | --- | --- |
| Artillery errors.ECONNREFUSED | 556 | exchange-disponibilidad.json | 556 | 0 | 0 |
| Artillery errors.ECONNRESET | 23 | exchange-disponibilidad.json | 23 | 0 | 0 |
| Artillery errors.ERR_SOCKET_TIMEOUT | 156 | exchange-disponibilidad.json | 156 | 0 | 0 |
| Artillery http.codes.200 | 1981 | exchange-disponibilidad.json | 1981 | 0 | 0 |
| Artillery http.codes.400 | 32 | exchange-disponibilidad.json | 32 | 0 | 0 |
| Artillery http.codes.403 | 1034 | exchange-disponibilidad.json | 1034 | 0 | 0 |
| Artillery http.codes.503 | 218 | exchange-disponibilidad.json | 218 | 0 | 0 |
| POST /exchange atendidos por tp2vmss000000 | 3265 | pedidos.jsonl, total (sin X-Node) | 3265 | 0 | 0 |

Consultas:

- Artillery errors.ECONNREFUSED: `sum:artillery.errors.ECONNREFUSED{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- Artillery errors.ECONNRESET: `sum:artillery.errors.ECONNRESET{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- Artillery errors.ERR_SOCKET_TIMEOUT: `sum:artillery.errors.ERR_SOCKET_TIMEOUT{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.200: `sum:artillery.http.codes.200{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.400: `sum:artillery.http.codes.400{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.403: `sum:artillery.http.codes.403{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.503: `sum:artillery.http.codes.503{caso:azure-1-nodo,test:exchange-disponibilidad}.as_count()`
- POST /exchange atendidos por tp2vmss000000: `sum:arvault.exchange.http.POST.exchange.count{host:tp2vmss000000}.as_count()`
