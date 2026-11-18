# Datadog contra los crudos — azure-tactica-probe

Generado por `perf/disponibilidad/verificar-datadog.mjs` el 2026-11-18T23:05:11.256Z. Rango: 2026-11-18T22:53:07.000Z a 2026-11-18T23:00:56.000Z (la corrida de `meta.txt` con 60 s de margen).

Datadog agrega cada 10 s y las métricas del servidor viajan por UDP: una diferencia chica es esperable; una grande, no.

| qué | crudo | de dónde | Datadog | diferencia | % |
| --- | --- | --- | --- | --- | --- |
| Artillery errors.ECONNREFUSED | 130 | exchange-disponibilidad.json | 130 | 0 | 0 |
| Artillery errors.ECONNRESET | 9 | exchange-disponibilidad.json | 9 | 0 | 0 |
| Artillery errors.ERR_SOCKET_TIMEOUT | 77 | exchange-disponibilidad.json | 77 | 0 | 0 |
| Artillery http.codes.200 | 3533 | exchange-disponibilidad.json | 3533 | 0 | 0 |
| Artillery http.codes.403 | 1878 | exchange-disponibilidad.json | 1878 | 0 | 0 |
| Artillery http.codes.503 | 373 | exchange-disponibilidad.json | 373 | 0 | 0 |
| POST /exchange atendidos por tp2vmss000000 | 2394 | pedidos.jsonl, por X-Node | 2394 | 0 | 0 |
| POST /exchange atendidos por tp2vmss000001 | 3390 | pedidos.jsonl, por X-Node | 3390 | 0 | 0 |

Consultas:

- Artillery errors.ECONNREFUSED: `sum:artillery.errors.ECONNREFUSED{caso:azure-tactica-probe,test:exchange-disponibilidad}.as_count()`
- Artillery errors.ECONNRESET: `sum:artillery.errors.ECONNRESET{caso:azure-tactica-probe,test:exchange-disponibilidad}.as_count()`
- Artillery errors.ERR_SOCKET_TIMEOUT: `sum:artillery.errors.ERR_SOCKET_TIMEOUT{caso:azure-tactica-probe,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.200: `sum:artillery.http.codes.200{caso:azure-tactica-probe,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.403: `sum:artillery.http.codes.403{caso:azure-tactica-probe,test:exchange-disponibilidad}.as_count()`
- Artillery http.codes.503: `sum:artillery.http.codes.503{caso:azure-tactica-probe,test:exchange-disponibilidad}.as_count()`
- POST /exchange atendidos por tp2vmss000000: `sum:arvault.exchange.http.POST.exchange.count{host:tp2vmss000000}.as_count()`
- POST /exchange atendidos por tp2vmss000001: `sum:arvault.exchange.http.POST.exchange.count{host:tp2vmss000001}.as_count()`
