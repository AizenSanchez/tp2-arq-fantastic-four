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

## 2. E10, lectura de tasas (`perf/tacticas-nginx/exchange-lectura-tasas.yaml`)

Escrita con el resultado de la sección 1 (`perf/results/azure-1-nodo-b2als/exchange-capacidad/`): B ≥ 320 en este nodo,
y el costo por pedido medido con la tasa (1,7 a 2,0 ms por POST a 120 o más, contra los 3,5 de la caracterización a
20). GET /rates es un solo `HGETALL` a Redis.

Carga: 12 req/s durante 30 s y 120 req/s durante 120 s; 80 % `GET /rates` (96/s) y 20 % `POST /exchange` (24/s, mitad
ARS a USD y mitad USD a ARS). En total unos 14.760 pedidos: 11.800 GET y 2.950 POST. Reset antes con `ansible/reset.sh`.

| Métrica | Predicción | Tipo | Cálculo |
|---|---|---|---|
| Errores y timeouts | 0 | esperado | 120 req/s es menos de la mitad de lo que el nodo atendió sin errores |
| GET /rates en la app (`arvault.exchange.http.GET.rates`) | mediana ≤ 1,2 ms, p95 ≤ 5 ms | esperado | 0,84 / 1,2 ms a 20 req/s en la caracterización; con ρ del proceso ≈ 0,1 la espera en el event loop es de décimas de ms |
| GET /rates en el cliente (`/rates`, `http.response_time`) | p50 163 ± 3 ms, p95 ≤ 175 ms | esperado | base de 162 / 169 ms más el servidor |
| POST, 200 en el cliente (`http.response_time.2xx` de toda la corrida) | p95 1.350 ± 70 ms | esperado | 1.353 ms en la corrida de capacidad |
| Mezcla de ARCA | 62 / 32 / 6 % ± 3 | esperado | |
| CPU del proceso en la fase de 120 | 10 ± 4 % de un núcleo; /rates cerca de la mitad | esperado | 24 × 2,0 ms + 96 × 0,55 ms (0,55 = 2,0 × 0,93 / 3,5, la razón GET/POST de la caracterización) |
| Redis | unas 450 operaciones/s, procesador ≤ 18 % | esperado | 96 + 24 × 14,5 (14,5 operaciones por POST en la corrida de capacidad); 13 % quieto y 23 % a 4.650 op/s |
| Conntrack máximo | 9.000 a 14.500, sin `table full` | esperado | hasta 120 conexiones/s durante 120 s; en la capacidad se midió entre 0,65 y 0,9 de esa cuenta |

**Decisión que se predice: no se repone la microcaché.** Ninguno de los criterios del plan se dispara: p95 de GET /rates
en la app por debajo de 17 ms; /rates cerca del 50 % de la CPU del proceso, pero con el proceso al 10 % (el criterio
pide más del 70 %); el p95 de los 200 de POST no pasa de 1,1 × (1.488 ms); Redis lejos del 50 %. Lo máximo que
ahorraría una caché es el tiempo de servidor de /rates, ≤ 5 ms de 169 (≤ 3 %). Contra el TP 1: allá la caché bajó el
P99 de 18 a 1 ms porque el proceso de la notebook atendía 800 req/s; acá el tiempo de /rates lo pone la red.

## 3. E7, corrida cambiaria (`perf/tacticas-nginx/exchange-spike.yaml`)

Escrita con los resultados de las secciones 1 y 2. Carga: solo ARS a USD, 24 req/s durante 60 s, **240 req/s (2B)
durante 20 s** y 24 req/s durante 120 s; unos 9.120 pedidos (4.800 en el pico). Reset antes con `ansible/reset.sh`.

| Métrica | Predicción | Tipo | Cálculo |
|---|---|---|---|
| Errores, timeouts y sin respuesta | 0 en las tres fases | esperado | el escalón de 240 de la corrida de capacidad duró 60 s sin errores |
| 429 | 0 | **no es predicción** | no hay limitador: es la ausencia de la táctica |
| p95 de los 200 en el pico (`perf/tacticas-nginx/tabla-fases.py`, `http.response_time`) | ≤ 1,05 × el de la primera fase | esperado | a 240 el proceso usó el 41 % de un núcleo y el p95 no se movió (1.511 contra 1.513 ms) |
| `POST.exchange` en la app | p95 sin escalón en el pico (± 5 %) | esperado | idem |
| Mezcla de ARCA | 62 / 32 / 6 % ± 3 también en el pico | esperado | ARCA usó 99 de 500 milicores a 320 |
| CPU del proceso en el pico | 41 ± 5 % de un núcleo | esperado | escalón de 240 de la capacidad |
| Conntrack máximo | 3.700 a 5.800, sin `table full` | esperado | 24 × 100 + 240 × 20 = 7.200 conexiones en 120 s, por 0,5 a 0,8 (lo medido en la capacidad y en E10) |
| Recuperación (`t_rec`) | 0 s: la primera ventana de 10 s después del pico ya tiene el p95 de antes | esperado | no se forma cola |

**Decisión que se predice: no se repone el `limit_req`.** El plan pide un rate limit solo si el exceso degrada a los
pedidos aceptados a través de un recurso de la app. A 2B no se degrada nada: el pico entra entero. En el TP 1 el
integrado rechazó con 429 el 21,9 % del pico (13.314 de 60.800); acá se predice 0 % rechazado y el mismo p95. Un
limitador a 2B solo rechazaría pedidos que el nodo atiende bien.
