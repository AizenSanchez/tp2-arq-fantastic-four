# Predicciones del bloque 2: tácticas de nginx que se pierden (E7, E8, E10)

> Mismas reglas que `perf/predicciones/capacidad.md` (bloque 1): cada predicción se commitea antes de la corrida que
> la contrasta y no se edita después; las correcciones van como nota al pie con fecha. Los resultados van en otro
> commit.

## Pregunta

En el TP 1 nginx tenía dos tácticas que en Azure no están: la microcaché de `GET /rates` (P99 de 18 a 1 ms y CPU de
11,8 a 7,5 %, TP 1 p. 34 y 35) y el `limit_req` de `POST /exchange` (en el spike del integrado rechazó con 429 el
21,9 %, 13.314 de 60.800, TP 1 p. 45 y 47). Sin ellas, ¿se degrada algún QA en la lectura de tasas (E10), en un pico
de cambios (E7) o en la carga representativa (E8)?

## Datos de partida

| Dato | Valor | Fuente |
|---|---|---|
| B del bloque 1 | **120 pedidos/s** con 1 nodo `Standard_F1als_v7` (1 vCPU, 2 GiB), eastus2, Redis `Balanced_B0`, desde wifi | `perf/results/azure-1-nodo/exchange-capacidad/` (rama `perf/capacidad`) |
| Nodo de este bloque | **1 nodo `Standard_B2als_v2`** (2 vCPU EPYC 7763 con SMT, 3,8 GiB, burstable), northcentralus, Redis `Balanced_B0` | `evidencia/tacticas-nginx/nodo-red.txt` |
| Por qué otro SKU | la suscripción de este bloque solo admite northcentralus, southafricanorth, brazilsouth, canadacentral y chilecentral, y en todas la cuota de la familia Falsv7 es 0 (el pedido de cuota fue rechazado). El B2als_v2 es el que tiene el mismo `nf_conntrack_max` (65.536): el B2ats_v2 de 1 GiB tiene 7.168 y mediría conntrack en vez de la táctica | `az vm list-usage`, `nodo-red.txt` |
| App | la misma de main (1 proceso pm2 en `fork_mode`) | `nodo-red.txt` |
| Generadora | fuera de Azure, por cable | |
| Latencia de base (GET / a 1 req/s) | p50 162,4 ms, p95 169 ms | `perf/results/caracterizacion-b2als/` |
| CPU por pedido | POST unos 3,5 ms (2,8 de user), GET /rates 0,93 ms, GET /accounts 0,91 ms | `caracterizacion-b2als/cpu-por-pedido.txt` |
| POST a 20 req/s | 62 / 32 / 6 % de 200 / 403 / 503; p50 1.023 ms, p95 1.326 ms (`http.response_time`, 1 viaje) | idem |
| Créditos de CPU | 72 y subiendo unos 0,5 por minuto con la VM quieta | `caracterizacion-b2als/creditos-cpu.txt` |

**La diferencia de CPU importa.** En el bloque 1 el nodo F1als_v7 usó el 21 % de su vCPU a 160 pedidos/s, unos
1,3 ms por POST contando el kernel (`observaciones.md` de la corrida de capacidad). Acá un POST cuesta unos 3,5 ms
solo en el proceso: el techo del proceso de un hilo es de unos 285 POST/s. Por eso antes de los escenarios se repite
la corrida de capacidad del bloque 1 sobre este nodo: los escenarios usan B = 120, el del grupo, pero hay que saber si
en este nodo 120 sigue estando por debajo del límite y qué límite es.

## 1. Corrida de confirmación de capacidad (antes de E7, E8 y E10)

`perf/capacidad/correr.mjs capacidad azure-1-nodo-b2als --env azure` de la rama del bloque 1, sin cambios, desde la
generadora con `ESCALONES=10,20,40,80,120,160,200,240,320` (los mismos del bloque 1), `CONEXION=cable` y el reset
hecho antes con `ansible/reset.sh` (en la generadora `RESET_CMD=true`). Azure Monitor se exporta aparte, porque la
generadora no tiene `az`. Mismo criterio de B que el bloque 1 (errores propios < 1 %, respuestas ≥ 95 %, p95 de los 200
≤ 2 × el del primer escalón).

| Métrica | Predicción | Tipo | Cálculo |
|---|---|---|---|
| Escalones de 10 a 160 | cumplen, 0 errores propios | esperado | ρ del proceso ≤ 160 × 3,5 ms = 0,56 |
| Mezcla de ARCA | 62 / 32 / 6 % ± 3 en todos los escalones con respuestas | esperado | igual que en el bloque 1 y en la caracterización |
| p95 de los 200 en el primer escalón (`pedidos.jsonl`, con handshake) | 1.500 ± 150 ms | esperado | 1.480 en el bloque 1 con RTT_nueva de 294 ms; desde la generadora RTT_nueva ≈ 2 × 162 |
| p95 de los 200 a 240 | menos de 1,1 × el del primer escalón | esperado | ρ = 0,84: la espera en el event loop es de decenas de ms (M/D/1: ρS / 2(1−ρ) ≈ 9 ms de media) contra 1,5 s |
| **B** | **240 pedidos/s** (200 si el costo real del POST es de 4,2 ms o más) | esperado | 240 × 3,5 = 0,84 de un núcleo |
| Primer escalón que no cumple | **320**, por latencia: el p95 de los 200 crece durante el escalón y pasa de 2 × | esperado | ρ = 1,12: la cola crece 0,12 s por segundo, unos 7 s al final del escalón; los timeouts de 10 s recién aparecen al final |
| CPU del proceso a 320 | ≈ 100 % de un núcleo, la VM cerca del 55 % (`system.cpu` de Datadog) | esperado | un hilo de JS, más el kernel en el otro núcleo |
| Conntrack máximo | ≈ 34.000, sin `table full` | esperado | (240 + 320) × 60 conexiones en los últimos 120 s, más unas 150 |
| Recuperación en la bajada a 20 | menos de 15 s | esperado | la cola de unos 7 s de trabajo se vacía al 93 % de capacidad libre |
| Créditos de CPU | bajan menos de 10 | esperado | por encima del 30 % de la VM solo unos 4 min |

**Qué se lee si falla.** Si en este nodo se repite lo del bloque 1 (timeouts a 160 o 200 con la CPU del nodo baja, y un
minuto sin tráfico en la sobrecarga), el límite que midió el bloque 1 no es el nodo: es algo entre la generadora y el
balanceador o Redis, y se busca con `system.net.bytes_rcvd` del nodo y el log de pm2. Si B da 240, el B = 120 del bloque
1 queda como el de aquel nodo y aquella red; los escenarios siguen con 120 porque es el B que el grupo usa en el
informe, y la diferencia se anota en los resultados.

Las predicciones de E10, E7 y E8 van en un commit aparte, antes de cada corrida, con el resultado de esta.
