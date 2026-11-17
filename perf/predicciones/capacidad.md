# Predicciones del bloque 1: capacidad y endurance (1 nodo)

> Reglas del enunciado y del plan del grupo:
> - Cada predicción se commitea y pushea **antes** de correr la prueba que contrasta.
> - Una vez commiteada no se edita: si hay que corregir, se agrega una nota al pie con fecha.
> - Los resultados van en `perf/results/azure-1-nodo/exchange-<corrida>/` y en otro commit.

## Qué se prueba

Dos corridas con `perf/capacidad/` (detalle de fases en su README) contra 1 nodo `Standard_F1als_v7` (1 vCPU,
2 GiB) detrás del balanceador L4, con Azure Managed Redis `Balanced_B0` (TLS) y ARCA en ACI (0,5 vCPU):

| Corrida | Fases | Escenarios del TP 1 |
|---|---|---|
| A. capacidad | escalones de 10, 20, 40, 80, 120, 160, **200**, 240 y 320 pedidos/s × 60 s, y bajada a 20 pedidos/s × 120 s (`ESCALONES=10,20,40,80,120,160,200,240,320`) | E1 breakpoint, E2 stress |
| B. endurance | 0,5 · B durante 600 s y B durante 180 s | E5, E6 |

Cada pedido es un `POST /exchange` con el mix de disponibilidad (ARS↔USD 35/35, ARS↔EUR 10/10, ARS↔BRL 5/5), un DNI al
azar y sin `Idempotency-Key`.

Los escalones de Azure no son los de la corrida local (10 a 640, sin 200). Se agrega **200** para afinar B entre 160
y 240, y se cortan **480 y 640**: en local ya no respondían nada, y en la nube obligarían a sostener miles de conexiones
a la vez a través del router de la casa.

**Fuentes de los recursos en Azure**: el nodo, en Datadog (`system.cpu.*`, `system.mem.used`). Redis administrado y
ARCA en ACI no tienen agente de Datadog: sus métricas salen de **Azure Monitor**, que `correr.mjs` exporta a
`azure-monitor/` con grano de 1 min (Redis: `usedmemory`, `operationsPerSecond`, `percentProcessorTime`; ARCA:
`CpuUsage` en milicores y `MemoryUsage`).

## Definiciones

**Throughput sostenido B** (lo calcula `perf/capacidad/analizar.mjs`, por hora de salida del pedido, sin los primeros
5 s ni los últimos 2 s de cada escalón): el escalón más alto que cumple las tres condiciones:
1. errores propios (timeouts, errores de conexión y 5xx que no son el 503 de ARCA) < 1 % de lo enviado;
2. respuestas HTTP (de cualquier estado) ≥ 95 % de lo ofrecido (tasa nominal × segundos);
3. p95 de los 200 ≤ 2 × el p95 de los 200 del primer escalón.

Un 403 (ARCA rechaza el DNI) y un 503 de ARCA son respuestas correctas del servicio, no errores propios.

**Recuperación**: desde el inicio de la bajada hasta la primera ventana de 5 s con p95 de los 200 ≤ 1,2 × el del
primer escalón y sin errores propios.

**Cómo se lee `RTT`.** Es la ida y vuelta por internet desde la laptop hasta el balanceador, medida con `GET /` (no toca
ARCA ni Redis) antes de cada corrida. Se mide de dos maneras y cada latencia usa la suya:

| Latencia | Qué mide | RTT que se suma |
|---|---|---|
| la de `pedidos.jsonl` y `resumen.md` | desde antes de abrir la conexión hasta el fin de la respuesta | **RTT_nueva**: `GET /` con una conexión nueva (handshake TCP + pedido ≈ 2 viajes). Artillery abre una conexión por pedido |
| `http.response_time` de Artillery y `artillery.http.response_time.*` en Datadog | desde que terminó de salir el pedido hasta el primer byte (fase `firstByte` de got) | **RTT_reutilizada**: `GET /` por una conexión ya abierta (1 viaje) |

En local las dos dan ≈ 1–2 ms. Desde Buenos Aires hasta `eastus2` se espera RTT_reutilizada ≈ 150 ms y
RTT_nueva ≈ 300 ms. **No se predice el RTT: se mide y se suma.**

**Tipos de predicción**: *exacto* (si no se cumple, algo está mal en el sistema o en la medición) o *esperado*
(un valor con tolerancia).

## Base de las predicciones

**Corridas locales** (`perf/results/local-1-nodo/`, docker con app 1 CPU / 2 GiB y arca 0,5 CPU, commits `b607c80` y
`23f24a2`):

| Medido en local | Valor |
|---|---|
| B | **240 pedidos/s**, al límite: el p95 de los 200 dio 2.330 ms contra un tope de 2.338. El de 320 no cumple nada (87 % timeouts) |
| Latencia de un 200 (escalones de 10 a 160) | p50 ≈ 980 ms, p95 ≈ 1.190 ms, plana |
| Latencia de un 403 | p50 ≈ 375 ms, p95 ≈ 540 ms |
| Proporciones de ARCA | 403 ≈ 32 %, 503 ≈ 6,5 % (todos `http_5xx`), 200 ≈ 61 % |
| CPU de la app por pedido | ≈ **3,1 ms** (estable de 40 a 160 pedidos/s): una CPU se llena a ≈ 320 pedidos/s |
| CPU de ARCA | ≈ 0,06 % por llamada/s: con 0,5 CPU se llenaría a ≈ 830 llamadas/s ≈ 670 pedidos/s |
| Por encima de B | timeouts de 10 s (`ERR_SOCKET_TIMEOUT`), sin 5xx propios; la app no se reinició |
| Recuperación | 20 s |
| Endurance 120 → 240 pedidos/s | p95 plano (0,8 ms/min, R² 0,13); app ≈ 179 MiB fija; Redis +0,45 KiB por pedido; el tramo a 240 se sostuvo 3 min (p95 1.508 ms) |

**TP 1**: B = 800 pedidos/s con la api en 1 CPU detrás de nginx, P95 base ≈ 757 ms (dos transferencias simuladas de
U(200, 400) ms cada una, sin ARCA). Hoy cada pedido cuesta bastante más CPU (≈ 3 ms contra < 1,25 ms): una llamada a
ARCA con `fetch` (1,24 en promedio, por el reintento), ≈ 10 comandos a Redis y una línea JSON de log por validación.

**ARCA** (Trezeguet, `perf/results/local-arca/medicion.txt` en `origin/perf/integridad`): 24,4 % de HTTP 500, que con
un reintento dejan ≈ 6 % de 503; ≈ 30 % de rechazos (403); ≈ 64 % llega a la reserva.

**Trabajo por pedido** (de `node/app.js`, `exchange.js` y `repository/redis-adapter.js`):

| Respuesta | Comandos a Redis | Viajes secuenciales a Redis | Otros |
|---|---|---|---|
| 200 | 13 (5 de validación, 5 para leer tasas y cuentas, reserva, crédito y log) | 7 | ARCA + 2 transferencias simuladas de U(200, 400) ms (solo `setTimeout`, sin CPU) |
| 403 o 503 | 6 (validación y log) | 4 | ARCA |

Con el mix (64 % de 200), son ≈ 10,5 comandos y 1,24 llamadas a ARCA por pedido.

---

## Corrida A — capacidad, 1 nodo

| Qué | Predicción | Tolerancia | Tipo |
|---|---|---|---|
| B | **160 pedidos/s** | 120 a 200 | esperado |
| Escalón de 200 pedidos/s | **no cumple**: falla la condición de latencia (p95 de los 200 > 2 × ref), con la CPU del nodo ≈ 95 % | — | esperado |
| Componente que satura primero | **CPU del nodo** | — | esperado |
| Condición que falla primero por encima de B | latencia (p95 de los 200 > 2 × ref) | — | esperado |
| Latencia de un 200 en los escalones de 10 a 80, `pedidos.jsonl` | p50 ≈ **RTT_nueva + 990 ms**, p95 ≈ RTT_nueva + 1.200 ms | ± 60 ms (p50), ± 100 ms (p95) | esperado |
| Ídem, `http.response_time.2xx` de Artillery/Datadog | p50 ≈ **RTT_reutilizada + 990 ms** | ± 60 ms | esperado |
| Latencia de un 403 en los mismos escalones, `pedidos.jsonl` | p50 ≈ RTT_nueva + 380 ms | ± 50 ms | esperado |
| 403 entre las respuestas, por escalón hasta B | 31 % | ± 4 puntos | esperado |
| 503 de ARCA entre las respuestas, por escalón hasta B | 6,5 % | ± 2,5 puntos | esperado |
| Motivo de los 503 hasta B | todos `http_5xx` (ninguno `timeout`) | — | esperado |
| 5xx que no son el 503 de ARCA, en toda la corrida | **0** | — | **exacto** |
| Líneas en `pedidos.jsonl` = usuarios creados por Artillery | **iguales** | — | **exacto** |
| Por encima de B | timeouts de 10 s: > 50 % de lo enviado desde el escalón de 320; 503 de ARCA sigue ≈ 6 % de lo que responde | — | esperado |
| Recuperación en la bajada | **25 s** | 10 a 60 s | esperado |
| CPU del nodo (Datadog, `system.cpu.user + system`) a 10 / 20 / 40 / 80 / 120 / 160 / 200 pedidos/s | ≈ 17 / 21 / 28 / 45 / 64 / 78 / 95 % | ± 15 puntos | esperado |
| CPU del nodo desde 240 pedidos/s | ≈ 100 % | ≥ 90 % | esperado |
| CPU de ARCA en B (Azure Monitor, `CpuUsage` del container group, promedio por minuto) | ≈ **120 milicores** de 500 | ± 80 milicores | esperado |
| Operaciones de Redis en B (Azure Monitor, `operationsPerSecond`, máximo por minuto) | ≈ **1.700 ops/s** | ± 30 % | esperado |
| CPU de Redis en B (Azure Monitor, `percentProcessorTime`, máximo por minuto) | < 20 % | — | esperado |

**Razonamiento.**

1. **Quién satura.** En local la app gasta ≈ 3,1 ms de CPU por pedido, así que con 1 CPU el techo teórico es ≈ 320 pedidos/s,
   y efectivamente se cayó en 320 con B = 240 (justo en el límite). En Azure el mismo pedido cuesta más CPU en el nodo:
   - TLS hacia Redis (en local, TCP plano);
   - el adaptador `statsd` y `connect-datadog`, con varias métricas UDP por pedido (en local, `METRICS_ADAPTER=null`);
   - el agente de Datadog, que procesa esas métricas en la misma vCPU;
   - pm2, que captura el stdout de la app (una línea JSON por validación de ARCA) en la misma vCPU (en local lo hace
     el daemon de docker, fuera del límite de 1 CPU).

   Además, el nodo ya gasta **9,6 % de CPU sin carga** (medido en Datadog), así que para los pedidos queda ≈ 90 % de
   la vCPU. Estimando un 30 a 60 % más por pedido (≈ 4 a 5 ms), el techo es 0,90 / (4 a 5 ms) ≈ **180 a 225
   pedidos/s**. A 200 pedidos/s la CPU estaría en ≈ 95 % (punto 8): el event loop empieza a encolar y el p95 de los
   200 pasa el doble del de referencia, igual que pasó en local a 240 (al 95 % de CPU, p95 2.330 contra un tope de
   2.338). Por eso **el escalón de 200 falla y B = 160**. Si el sobrecosto fuera menor al 20 %, 200 cumpliría (límite
   alto de la tolerancia); si fuera más del doble, fallaría también 160 (límite bajo).
2. **Por qué no satura ARCA.** A 160 pedidos/s llegan ≈ 200 llamadas/s. En local eso costó ≈ 12 % de una CPU, o sea
   ≈ 120 milicores, lejos de los 500 de ACI. Si ACI fuera mucho más lento que un núcleo de la laptop, se vería como 503
   con motivo `timeout` (el cliente de ARCA corta a los 1.000 ms) y `CpuUsage` cerca de 500 milicores: sería una
   predicción fallada.
3. **Por qué no satura Redis.** A 160 pedidos/s son ≈ 1.700 comandos/s, muy poco para Redis. Lo que sí agrega es
   latencia: 7 viajes secuenciales por cada 200, a ≈ 1 ms cada uno dentro de la región, ≈ +7 ms (incluidos en el
   +990 contra los 980 locales).
4. **Por qué no satura el cliente.** En local Artillery envió la tasa nominal exacta en todos los escalones, hasta
   640 pedidos/s (320,1, 480,1 y 640,1 enviados/s), aunque el servidor ya no respondiera. Pero ver el riesgo de la sección de diferencias.
5. **Latencia en los escalones bajos.** Para un 200, ARCA (≈ 370 ms) + 2 transferencias (media 600 ms) + Redis, todo
   del lado del servidor; la red se suma según la tabla de RTT. Un 403 no tiene transferencias: ARCA + el log.
6. **Por encima de B**, con la CPU llena el event loop atiende cada vez más tarde: el p95 sube a segundos y desde ≈ 2 × B
   casi todo termina en el timeout de 10 s del cliente, como en local. Los 503 de ARCA siguen siendo una proporción
   fija de lo que se responde, porque dependen del azar de ARCA y no de la carga.
7. **Recuperación.** Al bajar a 20 pedidos/s el nodo tiene que vaciar lo acumulado (incluidos pedidos cuyo cliente ya
   cortó por timeout). En local tardó 20 s; con más CPU por pedido se espera algo más lento.
8. **CPU por escalón.** La CPU media de la app en local (5,5 / 8,3 / 12,9 / 25,1 / 39,1 / 49,1 % de 10 a 160
   pedidos/s) × ≈ 1,4 por el sobrecosto del punto 1, más los **9,6 % de base** del nodo sin carga medidos en Datadog
   (sistema, agente de Datadog y pm2). Para 200, que no se corrió en local, se interpola 49,1 × 200 / 160 ≈ 61 %, que
   da 61 × 1,4 + 9,6 ≈ 95 %. Datadog promedia cada ≈ 15 s, así que los picos de un segundo no se ven.

---

## Corrida B — endurance, 1 nodo

Se corre con `RATE_ENDURANCE` = 0,5 · B y `RATE_TRAMO` = B, con el B medido en la corrida A de Azure (si B = 160,
80 y 160 pedidos/s).

| Qué | Predicción | Tolerancia | Tipo |
|---|---|---|---|
| Errores propios en todo el endurance (0,5 · B) | **0** | < 0,1 % | esperado |
| Pendiente del p95 de los 200 durante el endurance | **≈ 0 ms/min** | \|pendiente\| < 5 ms/min | esperado |
| p95 de los 200 en el tramo a B | ≤ 2 × el p95 del primer escalón de la corrida A | — | esperado |
| Errores propios en el tramo a B | < 1 % | — | esperado |
| Memoria del nodo (Datadog, `system.mem.used`), que es como se mide la de la app en Azure | **plana**: lo del minuto 1 ± 10 % hasta el final | ± 10 % | esperado |
| Memoria de Redis (Azure Monitor, `usedmemory`, máximo por minuto) | crece **lineal**, ≈ 0,45 KiB por pedido: ≈ 0,21 · B MiB en toda la corrida (≈ 34 MiB si B = 160) | ± 50 % | esperado |
| CPU de ARCA (Azure Monitor, `CpuUsage`) | ≈ 120 milicores × (tasa / 160): ≈ 60 en el endurance y ≈ 120 en el tramo, si B = 160 | ± 80 milicores | esperado |

**Razonamiento.**

1. **El p95 ya no crece con el tiempo.** En el TP 1 crecía porque el log de transacciones vivía en la memoria del
   proceso. Ahora cada entrada es un `XADD` a un stream de Redis más un `SET` del hash anterior (`APPEND_SCRIPT`),
   ambos O(1). En local, 10 min a 120 pedidos/s dieron 0,8 ms/min con R² 0,13, es decir, sin tendencia.
2. **La memoria de la app no crece** por la misma razón: el proceso no acumula nada por pedido. En local se quedó en
   ≈ 179 MiB de principio a fin. En Azure no hay una métrica por proceso: se mide con `system.mem.used` del nodo, que
   además incluye el sistema, pm2 y el agente de Datadog. Ninguno de ellos acumula por pedido, así que también tiene
   que quedar plana. Un crecimiento sostenido sería una fuga en la app (o en el buffer de logs de pm2).
3. **La de Redis sí**: el stream `log` no tiene `MAXLEN` y suma una entrada por pedido (200, 403 y 503). En local fue
   ≈ 0,45 KiB por pedido: (300 · B + 180 · B) pedidos × 0,45 KiB ≈ 0,21 · B MiB. La tolerancia es amplia porque
   `docker stats` (local, memoria del contenedor) y `usedmemory` de Azure Monitor (memoria de los datos) no miden lo
   mismo. Con `Balanced_B0` no se llega a llenar: tiene 0,5 GB, de los que quedan ≈ 400 MB útiles (ver
   «Incertidumbres y verificaciones»), y ≈ 34 MiB son < 10 % de eso.
4. **El tramo a B se sostiene** si B se midió bien: en local, 3 min a 240 después de 10 min de carga dieron
   p95 1.508 ms, sin errores.

---

## Diferencias esperadas entre local y nube

| Qué cambia | Local | Azure | Causa |
|---|---|---|---|
| Latencia de un 200 | ≈ 980 ms | ≈ RTT_nueva + 990 ms (`pedidos.jsonl`) | la red de internet y ≈ 7 viajes a Redis con TLS |
| Tope de latencia del criterio de B | 2 × 1.170 ≈ 2.340 ms | 2 × (RTT_nueva + 1.200) ≈ 3.000 ms | el RTT infla el p95 de referencia: en la nube el criterio de latencia es **más permisivo** en términos absolutos |
| B | 240 | 160 | más CPU por pedido en el nodo (TLS a Redis, métricas a statsd, agente de Datadog, pm2 con los logs) |
| Errores por encima de B | timeouts de 10 s | timeouts de 10 s, y quizás errores de conexión | además del nodo, el router de la casa y la conexión wifi tienen que sostener miles de conexiones TCP abiertas a la vez (por encima de B, hasta ≈ 10 s × la tasa) |
| Recuperación | 20 s | ≈ 25 s | el nodo vacía lo acumulado más lento |
| Proporciones de ARCA | 32 % / 6,5 % | iguales | dependen del azar de ARCA, no del lugar. Si ACI difiere, cambian solo los 403 y 503 |
| Resolución de CPU | `docker stats` cada 1 s | nodo en Datadog, ≈ 15 s; Redis y ARCA en Azure Monitor, 1 min | los picos cortos quedan promediados; con 1 min, un escalón de 60 s queda en uno o dos puntos |
| CPU de ARCA | % de un núcleo (`docker stats`) | milicores (`CpuUsage`) | 100 % de un núcleo = 1.000 milicores |
| Memoria de la app | la del contenedor (`docker stats`) | `system.mem.used` de todo el nodo | en Azure no hay métrica por proceso: se suman el sistema, pm2 y el agente, con un valor de base más alto |
| Memoria de Redis | contenedor sin límite (`docker stats`, incluye caché de páginas del RDB) | `usedmemory` de Azure Monitor | se compara la pendiente, no el valor absoluto |

## Incertidumbres y verificaciones

- [x] **Escalones en Azure**: `10,20,40,80,120,160,200,240,320` (decidido en la revisión).
- [x] **Memoria de `Balanced_B0`**: 0,5 GB, según la documentación de Azure Managed Redis (el tier Balanced va de 0,5 a
  960 GB). Microsoft reserva ≈ 20 % como buffer, así que quedan ≈ 400 MB útiles. Los ≈ 34 MiB que suma el endurance
  (si B = 160) son < 10 % de eso: la memoria de Redis no limita ninguna de las dos corridas.
- **Incertidumbre declarada: el sobrecosto de CPU por pedido en el nodo** (30 a 60 % más que en local; TLS a Redis,
  métricas a statsd, agente de Datadog y pm2). Es la principal fuente de incertidumbre de B y no se ajusta antes de
  medir: si es menor al 20 %, B sería 200; si es más del doble, 120.
- [ ] **Verificación del paso 7**: anotar el RTT medido (`rtt.json`, conexión reutilizada y conexión nueva) antes de
  leer las latencias.
