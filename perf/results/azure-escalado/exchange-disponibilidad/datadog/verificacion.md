# Datadog contra los crudos — azure-escalado

Generado por `perf/disponibilidad/verificar-datadog.mjs` el 2026-11-18T20:28:43.164Z. Rango: 2026-11-18T02:37:15.000Z a 2026-11-18T02:44:37.000Z (la corrida de `meta.txt` con 60 s de margen).

Datadog agrega cada 10 s y las métricas del servidor viajan por UDP: una diferencia chica es esperable; una grande, no.

| qué | crudo | de dónde | Datadog | diferencia | % |
| --- | --- | --- | --- | --- | --- |
| Artillery errors.ECONNREFUSED | 327 | exchange-disponibilidad.json | 327 | 0 | 0 |
| Artillery errors.ECONNRESET | 14 | exchange-disponibilidad.json | 14 | 0 | 0 |
| Artillery errors.ERR_SOCKET_TIMEOUT | 125 | exchange-disponibilidad.json | 125 | 0 | 0 |
| Artillery http.codes.200 | 3433 | exchange-disponibilidad.json | 3433 | 0 | 0 |
| Artillery http.codes.400 | 29 | exchange-disponibilidad.json | 29 | 0 | 0 |
| Artillery http.codes.403 | 1739 | exchange-disponibilidad.json | 1739 | 0 | 0 |
| Artillery http.codes.503 | 333 | exchange-disponibilidad.json | 333 | 0 | 0 |
| POST /exchange atendidos por tp2vmss000000 | 2403 | pedidos.jsonl, por X-Node | 2403 | 0 | 0 |
| POST /exchange atendidos por tp2vmss000001 | 3131 | pedidos.jsonl, por X-Node | 3131 | 0 | 0 |

Consultas:

- Artillery errors.ECONNREFUSED: `sum:artillery.errors.ECONNREFUSED{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- Artillery errors.ECONNRESET: `sum:artillery.errors.ECONNRESET{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- Artillery errors.ERR_SOCKET_TIMEOUT: `sum:artillery.errors.ERR_SOCKET_TIMEOUT{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.200: `sum:artillery.http.codes.200{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.400: `sum:artillery.http.codes.400{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.403: `sum:artillery.http.codes.403{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.503: `sum:artillery.http.codes.503{caso:azure-escalado,test:exchange-disponibilidad}.as_count()`
- POST /exchange atendidos por tp2vmss000000: `sum:arvault.exchange.http.POST.exchange.count{host:tp2vmss000000}.as_count()`
- POST /exchange atendidos por tp2vmss000001: `sum:arvault.exchange.http.POST.exchange.count{host:tp2vmss000001}.as_count()`
