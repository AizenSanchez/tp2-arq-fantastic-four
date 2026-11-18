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

## 4. E8, carga representativa (`perf/tacticas-nginx/exchange-representativa.yaml`)

Escrita con los resultados de las secciones 1 a 3. Carga: 12 usuarios por segundo durante 600 s (7.200 usuarios); cada
uno hace `GET /rates`, espera 1, 2 o 3 s, hace un `POST /exchange` (35 % ARS a USD, 35 % USD a ARS, 10 % ARS a EUR, 10 %
EUR a ARS, 5 % ARS a BRL, 5 % BRL a ARS) y `GET /accounts`, por la misma conexión. Unos 36 pedidos/s (21.600 en total).
Reset antes con `ansible/reset.sh`. Los saldos del banco alcanzan (60.000 USD, 40.000 EUR, 60.000 BRL y 120 M ARS; un
ARS a USD aprobado de 1.000 ARS saca 0,66 USD: en E8 salen unos 1.030 USD y entran unos 1.560).

| Métrica | Predicción | Tipo | Cálculo |
|---|---|---|---|
| Errores, timeouts y usuarios fallidos | 0 | esperado | 36 pedidos/s, un 30 % de B y un 11 % de lo que el nodo atendió |
| Mezcla de ARCA (sobre los POST) | 62 / 32 / 6 % ± 3 | esperado | |
| `/rates` en el cliente | p50 163 ± 3 ms, p95 ≤ 175 ms | esperado | E10 |
| `/accounts` en el cliente | p50 163 ± 3 ms, p95 ≤ 182 ms | esperado | caracterización: 162 / 176 ms |
| `/exchange` en el cliente (todos los códigos) | p95 1.300 ± 70 ms | esperado | E10 |
| `GET.rates` y `GET.accounts` en la app | p95 ≤ 3 ms | esperado | E10: 1,1 ms con el triple de lecturas |
| `vusers.session_length` | mediana 3.300 ± 500 ms, p95 ≤ 5.000 ms | esperado | handshake + GET (≈ 325) + espera media de 2.000 + POST (mediana ≈ 1.000) + GET (≈ 162) |
| CPU del proceso | 4 ± 2 % de un núcleo | esperado | 12 × 2,0 + 24 × 0,6 ms |
| Redis | unas 200 op/s, procesador ≤ 16 % | esperado | 24 lecturas + 12 × 14,5 |
| Conntrack máximo | 1.400 a 3.000, sin `table full` | esperado | 12 conexiones/s × 120 s más las de ARCA, con el factor de E7 (entradas que duran los 120 s) |
| Créditos de CPU | suben | esperado | la VM queda debajo del 30 % de base |

**Lectura que se predice.** La carga representativa no se acerca a ningún límite, así que ninguna de las dos tácticas
cambia algo: sin caché las lecturas tardan lo que tarda la red (≈ 162 ms) y sin limitador no hay nada que rechazar.

## 5. E7 alto, pico por encima del límite del nodo (`perf/tacticas-nginx/exchange-spike-alto.yaml`), 1 nodo

Agregada el 2026-11-18, antes de correrla. E7 a 2B (240) quedó en el 75 % de lo que el nodo atendió en la capacidad,
así que no muestra qué pasa sin `limit_req` cuando el pico sí excede. Misma infraestructura recreada (1 nodo
`Standard_B2als_v2`, Redis `Balanced_B0`, northcentralus), desde la generadora por cable, reset antes con
`ansible/reset.sh`. Carga: solo ARS a USD, 24 req/s durante 60 s, **720 req/s (6B) durante 20 s** y 24 req/s durante
120 s; unos 18.720 pedidos (14.400 en el pico).

**Techo del nodo.** Con la CPU de la capacidad alineada al primer pedido (la tabla de `observaciones.md` empieza
17,6 s antes que Artillery), el proceso usa el 57 % de un núcleo a 320 y el costo marginal es de unos 1,7 ms por POST:
el techo de un núcleo queda en unos 570 req/s. Las corridas a la misma tasa variaron bastante (2,4 contra 3,5 ms a 20),
así que se toma **techo entre 500 y 650**. A 720 eso da ρ entre 1,11 y 1,44.

| Métrica | Predicción | Tipo | Cálculo |
|---|---|---|---|
| CPU del proceso en el pico | 95 a 100 % de un núcleo | esperado | ρ > 1 |
| Cola al final del pico | 2 a 9 s de trabajo | esperado | (ρ − 1) × 20 s |
| p95 de los 200 en las ventanas del pico | **≥ 2,7 s** (más de 2 × los ≈ 1,33 s de antes) | esperado | base de 1,1 s más la espera en el event loop, que crece en el pico |
| 503 por `timeout` de ARCA en el pico | **sube a 20 a 60 % de las respuestas** del pico (antes ≈ 0) | esperado | el `AbortSignal.timeout` de 1 s corre desde que la app llama a ARCA; con el event loop atrasado más de unos 500 ms, la respuesta de ARCA se procesa después de que venció el timer |
| 200 en el pico | bajan de 62 % a 25 a 50 % | esperado | lo que se va a 503 sale de los 200 y de los 403 en proporción |
| Timeouts del cliente (10 s) | 0 a 1 % del pico | esperado | la cola llega a 10 s solo con el techo en 500 |
| CPU del nodo y créditos | VM a 60 a 75 %; créditos bajan menos de 2 | esperado | 1 núcleo de JS más el kernel, 20 s |
| Conntrack máximo | 15.000 a 22.000, sin `table full` | esperado | 14.400 del pico más las de la fase de 24 que siguen vivas |
| Recuperación (`t_rec`, primera ventana de 10 s con el p95 de antes) | 10 a 20 s | esperado | la cola se vacía al 93 % de capacidad libre: entre 2 y 10 s, más la ventana |
| Generadora | crea los 14.400 usuarios del pico (± 1 %) y no avisa CPU alta | condición | si no, la corrida no vale como pico de 6B |

**Criterio para reponer el limitador** (el mismo de `TP2/bloque2-de-cero/plan-bloque2.md`, sección 8, escrito antes de
E7 pero fuera del repo; queda acá antes de esta corrida). Se considera que el exceso degrada a los aceptados si en el
pico o en la recuperación pasa cualquiera de estas: p95 de los 200 en una ventana del pico > 2 × el de la primera fase;
503 > 11 % de las respuestas del pico (6 de base + 5); timeouts o errores del cliente ≥ 1 %; recuperación > 30 s.

**Lo que se predice:** con 1 nodo el criterio **se dispara** (p95 y 503). Que se dispare con 1 nodo no decide todavía:
la sección 6 mide si con 2 nodos el mismo pico entra. Si entra, la respuesta a un pico de 6B es escalar (Increase
Resources, 04, pág. 8) y el limitador queda como protección para lo que excede a N nodos; un limitador en la app
gasta CPU del mismo hilo para rechazar (aceptar la conexión, parsear y contestar 429), así que protege menos que nginx.

## 6. Caso escalado: 2 nodos (E10, E8 y E7 alto)

Agregada el 2026-11-18, antes de escalar. Mismo despliegue con `instances = 2` en `node.tf`, mismo Redis y ARCA, el Load
Balancer de Azure con su regla de siempre (distribución por hash de 5 tuplas: cada conexión nueva cae en un nodo al
azar). Escenarios sin cambios: `exchange-lectura-tasas.yaml`, `exchange-representativa.yaml` y
`exchange-spike-alto.yaml`.

| Escenario | Métrica | Predicción | Tipo | Cálculo |
|---|---|---|---|---|
| todos | Reparto entre nodos | 50 ± 3 % de los pedidos en cada nodo | esperado | hash de 5 tuplas con miles de conexiones |
| E10 | Errores | 0 | esperado | 60 req/s por nodo |
| E10 | `/rates` en el cliente | p50 159 ± 3, p95 ≤ 170 ms | esperado | la latencia la pone la red; igual que con 1 nodo |
| E10 | `GET.rates` en la app | p95 ≤ 1,2 ms | esperado | 1,06 ms con 1 nodo, ahora con la mitad de carga |
| E10 | CPU del proceso | 6 ± 2 % de un núcleo en cada nodo | esperado | la mitad de 11,6 % |
| E10 | Redis | 417 a 481 op/s, igual que con 1 nodo | esperado | la carga total no cambia |
| E10 | Conntrack máximo | 5.000 a 7.000 en cada nodo | esperado | la mitad de 12.105 |
| E8 | Errores | 0 | esperado | |
| E8 | `/rates` y `/accounts` | p50 162 ± 3, p95 ≤ 172 ms | esperado | igual que con 1 nodo |
| E8 | `/exchange` | p95 1.326 ± 70 ms | esperado | idem |
| E8 | `vusers.session_length` | mediana 3.300 a 3.800, p95 ≤ 5.000 ms | esperado | idem |
| E8 | CPU del proceso | 2,3 ± 1,5 % por nodo | esperado | la mitad de 4,6 % |
| E8 | Conntrack máximo | 1.000 a 1.700 por nodo | esperado | la mitad de 2.502 |
| E7 alto | Errores y timeouts | 0 | esperado | 360 req/s por nodo: ρ entre 0,55 y 0,72 |
| E7 alto | p95 de los 200 en el pico | ≤ 1,1 × el de la primera fase | esperado | la espera en el event loop a ρ = 0,7 es de unos milisegundos |
| E7 alto | 503 en el pico | 6 ± 3 %, igual que fuera del pico | esperado | ARCA a 720 req/s: unos 225 de 500 milicores (99 a 320) |
| E7 alto | CPU del proceso en el pico | 55 a 75 % por nodo | esperado | 320 → 57 %, más 40 × 0,17 |
| E7 alto | Conntrack máximo | 8.000 a 11.000 por nodo | esperado | la mitad de la sección 5 |
| E7 alto | Recuperación | 0 s | esperado | no se forma cola |
| E7 alto | Criterio del limitador | no se dispara | esperado | |

**Riesgo que se mira.** En E7 alto, Redis recibe unas 720 × 14,5 = 10.400 op/s durante 20 s, más del doble de lo que
vio en la capacidad (4.650). Azure Monitor tiene grano de 1 minuto y no ve un pico de 20 s, así que Redis se mira por
`POST.exchange` en la app: si su p95 sube más de 10 % con la CPU de los nodos por debajo del 75 %, el límite es Redis o
ARCA (`arca.ms`), no los nodos, y se informa así.

**Decisión que se predice para el bloque: no se repone ninguna táctica de nginx.** La microcaché por lo de las
secciones 2 y 4, que el caso escalado no cambia (la latencia de `/rates` sigue siendo la red). El `limit_req` porque un
pico de 6B, que sí degrada a 1 nodo, entra con 2: la táctica que resuelve el pico es la cantidad de nodos.
