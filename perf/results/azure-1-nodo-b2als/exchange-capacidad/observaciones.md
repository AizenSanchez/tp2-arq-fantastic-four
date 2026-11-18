# Observaciones: capacidad del nodo B2als_v2, 1 nodo

- **Corrida:** 18/11, de 00:56:43 a 01:08:04 UTC, desde la generadora por cable, con `perf/capacidad/` de la
  rama `perf/capacidad` (4cf76f6) sin cambios.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 1 (38ecc34).
- **`meta.txt` incompleto:** la generadora tiene solo la carpeta `perf/` (sin `.git`, sin el estado de Terraform y sin
  `az`), por eso `meta.txt` tiene `?` en commit y Terraform. Los valores son: commit 38ecc34 (la predicción),
  `vmss_instances = 1`, `vmss_sku = "Standard_B2als_v2"`, `redis_sku = "Balanced_B0"`, y `azure-monitor/` exportado
  con `perf/tacticas-nginx/exportar-azure-monitor.sh` en el mismo rango.

## Resultado

Los 9 escalones cumplen, incluido 320: 73.800 pedidos, 0 errores, p95 de los 200 entre 1.501 y 1.555 ms en todos.
**B ≥ 320 pedidos/s.**

CPU del proceso por escalón (`nodo/ticks-app.txt`, sin los primeros 5 s ni los últimos 2 s de cada escalón), contando
desde el primer pedido de `pedidos.jsonl` (00:57:01,2), no desde el inicio de `meta.txt`:

| Escalón (pedidos/s) | 10 | 20 | 40 | 80 | 120 | 160 | 200 | 240 | 320 |
|---|---|---|---|---|---|---|---|---|---|
| % de un núcleo | 3,1 | 5,3 | 9,7 | 18,8 | 25,6 | 29,8 | 35,2 | 43,1 | 57,0 |
| ms por pedido | 3,06 | 2,65 | 2,43 | 2,36 | 2,13 | 1,86 | 1,76 | 1,79 | 1,78 |
| de eso, user | 2,63 | 2,22 | 1,99 | 1,91 | 1,71 | 1,42 | 1,34 | 1,36 | 1,36 |

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| Escalones de 10 a 160 | cumplen, 0 errores | cumplen, 0 errores | ✓ |
| Mezcla de ARCA | 62 / 32 / 6 % ± 3 | 61 a 63 / 30,5 a 32,5 / 5,7 a 6,8 % | ✓ |
| p95 de los 200 en el primer escalón | 1.500 ± 150 ms | 1.513 ms | ✓ |
| p95 de los 200 a 240 | < 1,1 × el primero | 1.511 ms (1,00 ×) | ✓ |
| **B** | **240** | **≥ 320** | ✗ |
| Primer escalón que no cumple | 320, por latencia | ninguno | ✗ |
| CPU del proceso a 320 | ≈ 100 % de un núcleo | 57,0 % | ✗ |
| CPU de la VM a 320 | ≈ 55 % | 37 a 39 % (Azure Monitor y Datadog) | ✗ |
| Conntrack máximo | ≈ 34.000, sin `table full` | 23.015, sin `table full` | ✗ (igual lejos de llenar la tabla) |
| Recuperación en la bajada a 20 | < 15 s | 0 s | ✓ |
| Créditos de CPU | bajan menos de 10 | no bajan: de 77,9 a 81,2 | ✓ |

**Por qué falló B.** La predicción usó 3,5 ms por POST, medidos en un solo punto a 20 pedidos/s y con el tiempo de
sistema estimado. El mismo escalón acá da 2,65 ms, y el costo en reposo (cerca de 1 ms por segundo) no explica la
diferencia; no la investigamos más. Con más tasa el costo baja a 1,8 ms por pedido (1,70 ms marginal entre 160 y 320),
así que el techo del proceso queda en unos 570 pedidos/s (500 a 650), no en 285. Faltó medir la CPU por pedido a más
de una tasa.

**Créditos.** B2als_v2 es burstable, con una línea base del 30 % de la VM. A 320 la VM estuvo al 37 a 39 % y los
créditos no bajaron porque la corrida fue corta. Con los créditos agotados, a unos 2,3 ms de CPU de la VM por POST, lo
sostenible es unos 260 pedidos/s. Los 2 vCPU además son los dos hilos de un mismo núcleo físico.

**Conntrack.** El máximo (23.015) quedó limitado por los puertos de la generadora, que se reutilizan antes de que venza
la entrada, así que no sirve para estimar cuánto vive una entrada. Es el 35 % de la tabla: no fue un límite.

## Qué se lee

- No se repite nada del bloque 1: ni los timeouts a 160 y 200 ni el minuto sin tráfico. A 320 nada estuvo cerca de un
  límite: proceso al 57 %, Redis al 23 % de procesador, ARCA en 99 milicores de 500, `TcpExtListenOverflows` = 0.
- El B = 120 del bloque 1 no parece venir de la app; esto apoya lo que ya sospechaban sus observaciones, la red de la
  generadora (wifi). No lo prueba: cambiaron nodo, región y generadora a la vez.
- Los escenarios siguen con **B = 120**, el del grupo. El techo del nodo se prueba con el pico de 6B (720 pedidos/s) en
  `exchange-spike-alto/`.
