# Predicciones del bloque 4: integridad y estado en Redis

> Reglas del enunciado y del plan del grupo:
> - Cada predicción se commitea y pushea **antes** de correr la prueba que contrasta.
> - Una vez commiteada no se edita: si hay que corregir, se agrega una nota al pie con fecha.
> - Los resultados van en otro archivo (`perf/results/`) y en otro commit.
>
> Este archivo es solo del bloque 4. Los otros bloques tienen el suyo en `perf/predicciones/`, para no pisarnos.

## Qué se prueba y por qué hay solo dos escenarios

En el TP 1 este bloque tenía cinco escenarios (carrera corta, carrera larga, reintentos, métricas en un sentido, métricas con rechazos). Se reducen a dos porque miden dos propiedades:

| Escenario | Absorbe | Propiedad |
|---|---|---|
| `exchange-integridad-saldo` | carrera corta + carrera larga | La reserva de saldo es atómica: con mucha concurrencia contra un saldo limitado no se aprueba de más y el saldo nunca queda negativo |
| `exchange-integridad-reintentos` | reintentos | Repetir un pedido con la misma `Idempotency-Key` no opera dos veces, aunque el reintento caiga en otro nodo |

Las métricas de volumen y neto (E15 y E16 del TP 1) no tienen escenario propio: la idea de "los números cierran" la cubre un verificador común que, después de cada corrida, compara lo que respondió el servicio contra el log y los saldos de Redis.

**Se prueba contra el código de `origin/main` tal como está** (`node/app.js`, `node/idempotency.js`, `node/exchange.js`, `node/repository/redis-adapter.js`).

## Por qué las predicciones son sobre invariantes y no sobre "cuántos salen bien"

ARCA responde al azar (medición local con la imagen de la cátedra: ≈ 23 % de HTTP 500 instantáneos y ≈ 38 % de rechazos entre las respuestas 200). La app reintenta una vez ante un 5xx. Entonces, para cualquier pedido:

| Respuesta de ARCA tras el reintento | Proporción | Qué responde el servicio |
|---|---|---|
| no disponible | 0,23² = **5,3 %** | 503 |
| rechaza el DNI | 0,947 × 0,38 = **36,0 %** | 403 |
| aprueba el DNI | 0,947 × 0,62 = **58,7 %** | sigue al cambio: 200, o 422 si no hay saldo |

Esto cambia las cuentas respecto del TP 1: de cada 100 pedidos, solo ≈ 59 llegan a tocar el saldo. Por eso se diseñan los escenarios con **mucho más pedidos que saldo**: así el resultado final (cuántos se aprueban) no depende del azar de ARCA, solo cuántos llegan hasta ahí.

Límites de lo medido: las proporciones de ARCA salen de Docker local y no del contenedor de Azure. Si difieren, solo cambian los conteos "esperados" de 403 y 503; las invariantes (marcadas **exacto**) no dependen de ARCA.

## Cómo se lee `RTT`

Igual que en las demás predicciones: es el viaje de ida y vuelta por internet desde el generador hasta Azure. Se mide aparte con `GET /` y se suma. Los ensayos en local no tienen RTT (≈ 0).

---

## Escenario 1: `exchange-integridad-saldo`

**Montaje.** Antes de empezar: tasa ARS→USD = 0,001 (5.000 ARS = 5 USD exactos) y saldo de USD de arVault = 100 → saldo para **20 cambios**. Después: una ráfaga de 100 pedidos en 1 s, y 30 s a 10 pedidos/s (300 pedidos). **Total 400 pedidos** ARS→USD de 5.000 ARS, cada uno con un DNI al azar. Un sondeo lee los saldos cada 1 s durante toda la prueba.

### Predicción para **1 nodo**

| Qué | Predicción | Tipo |
|---|---|---|
| Cambios aprobados (200) | **20** | **exacto** |
| Saldo final de USD de arVault | **0** | **exacto** |
| Saldo final de ARS de arVault | 120.000.000 + 100.000 = **120.100.000** | **exacto** |
| Saldo mínimo visto por el sondeo | **≥ 0** (nunca negativo) | **exacto** |
| Entradas nuevas en el log | **400** (una por pedido, sea 200, 403, 422 o 503) | **exacto** |
| Entradas del log con `ok: true` | **20** | **exacto** |
| Pedidos que llegan a la reserva (200 + 422) | ≈ 235 (±20) | esperado |
| 422 (sin fondos) | ≈ 215 (±20) | esperado |
| 403 (ARCA rechaza) | ≈ 144 (±18) | esperado |
| 503 (ARCA no disponible) | ≈ 21 (±9) | esperado |
| Dentro de la ráfaga (100 pedidos) | 200: 20 · 422 ≈ 39 (±10) · 403 ≈ 36 (±10) · 503 ≈ 5 (±5) | esperado |
| Latencia de un 200 | mediana ≈ **RTT + 985 ms**, P95 ≈ RTT + 1.190 ms | esperado |
| Latencia de un 422 | mediana ≈ **RTT + 385 ms** (ARCA + unos pocos viajes a Redis; no hay transferencias) | esperado |
| Latencia de un 403 | mediana ≈ RTT + 375 ms (solo ARCA) | esperado |
| CPU del nodo | < 10 % (≈ 10 pedidos/s sostenidos, pico de 100 en 1 s) | esperado |
| Errores propios (5xx que no son 503 de ARCA, timeouts del cliente) | **0** | **exacto** |

**Razonamiento.** (1) La reserva es un script Lua que se ejecuta de una vez en Redis (`RESERVE_SCRIPT` en `node/repository/redis-adapter.js`): lee el saldo y lo descuenta sin que otro pedido se meta en el medio, así que el número de aprobados no puede pasar de saldo ÷ monto = 100 ÷ 5 = 20. (2) Llegan a la reserva ≈ 59 de cada 100 pedidos; en la ráfaga son ≈ 59 ± 5, y la probabilidad de que sean menos de 20 es de 5·10⁻¹⁶: el saldo se agota con seguridad. (3) Después de agotado, todo lo que llega a la reserva recibe 422. (4) En el TP 1 esta misma prueba (carrera corta) dio con el código sin reserva 40 aprobados y saldo en −100; con la reserva, 20 aprobados y saldo 0, que es lo que se predice acá.

### Predicción para **varios nodos (2 nodos)**

**Todo lo exacto es idéntico al de 1 nodo**: 20 aprobados, USD final 0, ARS final 120.100.000, saldo mínimo ≥ 0, 400 entradas, 20 con `ok: true`, 0 errores propios. Lo que cambia es solo:

| Qué | 1 nodo | 2 nodos |
|---|---|---|
| Reparto de los pedidos por nodo | 100 % en el único nodo | ≈ 50 / 50 (±10 puntos). El balanceador reparte por conexión y cada pedido abre una |
| Aprobaciones de cada nodo | 20 | las 20 se reparten entre los dos nodos (por ejemplo 9 y 11), sin importar cuál: la suma es 20 |
| CPU de cada nodo | < 10 % | < 5 % |
| Latencia | igual | igual (±30 ms): la prueba no está limitada por CPU |

**Razonamiento.** La atomicidad la da Redis, que es uno solo y compartido, no el nodo. Por eso dos nodos que compiten por el mismo saldo están igual de protegidos que uno. En el TP 1 el estado vivía en la memoria de cada réplica; con el estado afuera, esta prueba es la que justifica sacarlo. Si en la nube apareciera un aprobado de más (21 o más), sería un hallazgo grave y habría que explicarlo, no una "diferencia menor".

---

## Escenario 2: `exchange-integridad-reintentos`

**Montaje.** Estado inicial de fábrica (reinicio previo). **200 usuarios virtuales** a razón de 10 por segundo durante 20 s. Cada uno manda el **mismo pedido dos veces con la misma `Idempotency-Key`**; el primero lleva `Connection: close` para que el segundo use una **conexión nueva** (con el balanceador de Azure, que reparte por conexión, el reintento puede caer en otro nodo). Pedido: ARS→USD de 1.000 ARS, con un DNI propio por usuario.

### Predicción para **1 nodo**

| Qué | Predicción | Tipo |
|---|---|---|
| Reintentos que devuelven **la misma respuesta con el mismo `id`** (cuando el primero fue 200 o 403) | **100 %** | **exacto** |
| Usuarios cuyo primer pedido terminó en 200 / 403 / 503 | ≈ 117 / 72 / 11 (±14 / ±12 / ±6) | esperado |
| Usuarios con **dos aprobaciones distintas** (duplicado) | **0** | **exacto** |
| Entradas del log con `ok: true` | = cantidad de usuarios con alguna aprobación ≈ **124** (±14) | esperado; la igualdad con el conteo del cliente es **exacta** |
| Entradas totales nuevas en el log | ≈ **211** (±7): una por usuario, más una por cada usuario cuyo primer pedido fue 503 | esperado |
| Variación del saldo de USD | = −(suma de `counterAmount` de las entradas `ok: true`) | **exacto** (tolerancia 10⁻⁶) |
| Variación del saldo de ARS | = +1.000 × cantidad de aprobaciones | **exacto** |
| Latencia del reintento (cuando es repetición guardada) | mediana ≈ **RTT + 5 ms**, sin ARCA ni transferencias | esperado |
| Latencia del primer pedido (200) | mediana ≈ RTT + 985 ms | esperado |
| Reintentos que corren de nuevo (el primero fue 503) | ≈ 11 (5,3 %) | esperado |
| Respuestas 409 (clave en curso) | **0**: el reintento se manda después de recibir la respuesta del primero | **exacto** |
| Reintentos que caen en otro nodo | **0 %** (hay un solo nodo) | **exacto** |

**Razonamiento.** (1) El middleware de idempotencia es lo primero que corre en `POST /exchange` y guarda la respuesta (200, 403, 422 y 400) en Redis con `SET NX`. (2) Francisco cambió el código para que solo se libere la clave ante un 5xx **antes** de que ARCA responda (`res.locals.retryable`): un 503 de ARCA libera la clave y el reintento vuelve a correr (por eso las entradas suman ≈ 211 y no 200); un 200 o un 403 se guardan y se repiten tal cual. (3) El reintento guardado no llama a ARCA ni hace transferencias: un solo viaje a Redis, por eso ≈ 5 ms. (4) En el TP 1: 1.275 usuarios, 1.275 entradas con la táctica contra 2.550 sin ella; acá cada usuario genera una entrada, salvo los de 503.

### Predicción para **varios nodos (2 nodos)**

**Todo lo exacto es idéntico al de 1 nodo**: 100 % de repeticiones idénticas, 0 duplicados, igualdades de log y saldos, 0 respuestas 409. Lo que cambia:

| Qué | 1 nodo | 2 nodos |
|---|---|---|
| Reintentos que caen en otro nodo | 0 % | **≈ 50 %** (±7 puntos, o sea 86 a 114 de 200) |
| Latencia del reintento repetido | RTT + 5 ms | RTT + 5 ms (no depende del nodo: la respuesta guardada está en Redis) |
| Entradas del log | ≈ 211 | ≈ 211 |

**Razonamiento.** La clave de idempotencia y la respuesta guardada viven en Redis, no en el nodo. Entonces da igual si el reintento llega al mismo nodo o a otro. Esto es lo que justificó compartir las claves de idempotencia por Redis en el TP 1. **Riesgo de la predicción:** el 50 % depende de que `Connection: close` realmente fuerce una conexión nueva y de que el balanceador (hash de 5 elementos) la reparta al azar; si da mucho menos que ≈ 43 %, hay que decir en los resultados que el escenario no estaba forzando el cruce entre nodos.

---

## Qué NO se predice acá

- Throughput máximo, punto de quiebre y escalado proporcional: son del bloque 1.
- Comportamiento ante caídas de nodo o de Redis: es del bloque 3.

## Antes de correr en Azure

- [ ] Medir el RTT base (`GET /`) y anotarlo.
- [ ] Confirmar con un smoke de ARCA en Azure las proporciones 5/36/59 %. Si difieren, anotarlo; las invariantes marcadas **exacto** no cambian.
- [ ] Reiniciar el estado (`ansible/reset.sh`) antes de cada escenario y **correr solo uno a la vez**: los escenarios cambian la tasa y el saldo de USD, que son compartidos con los demás bloques.

## Nota al pie (17/11, antes de correr cualquier prueba)

Se corrigieron dos tolerancias que estaban mal calculadas: las entradas totales del log de reintentos pasaron de ±4 a ±7 (con ±4 solo se cubría el 79 % de los casos por puro azar de ARCA) y el cruce entre nodos se expresó como 86 a 114 de 200 (±7 puntos), que es lo que decía el texto. Los valores centrales no cambian.

---

# Ampliación del 17/11 (antes de implementar y de correr nada de esto)

Las predicciones de arriba quedan como están. Esta ampliación agrega cuatro cosas. Las proporciones de ARCA que se usan acá son las **medidas después** de las primeras predicciones (`perf/results/local-arca/medicion.txt`: 24,4 % ± 1,5 de HTTP 500, que con 1 reintento dejan ≈ 6 % de 503, y ≈ 30 % de rechazos entre los que responden, fijos por DNI). Para cualquier pedido: **503 ≈ 6 %, 403 ≈ 30 %, llega a la reserva ≈ 64 %**. Siguen siendo medidas en Docker local: en Azure pueden diferir.

## A. Control negativo: ¿el escenario `saldo` detecta una reserva que no es atómica?

**Para qué.** Hoy todo da OK, y un test que nunca falla no prueba nada. Se corre `saldo` contra una copia temporal de la app donde `reserveBalance` es la del TP 1: **chequea el saldo y lo descuenta recién ~600 ms después**, en lugar de hacerlo de una vez en Redis. Los 600 ms imitan la ventana que había en el TP 1 entre el chequeo y el descuento (las dos transferencias simuladas, 2 × U(200, 400) ms). Es una **simulación del defecto del TP 1**, no el código del TP 1.

| Qué | Predicción |
|---|---|
| Resultado de `correr.mjs` | **INVARIANTE ROTA** (código de salida 1). Es lo que tiene que pasar |
| Comprobación "aprobados = 20" | **falla** |
| Comprobación "el saldo de USD nunca fue negativo" | **falla** |
| Aprobados (200) | ≈ **45** (rango 30 a 65). Más del doble de lo que permite el saldo |
| Saldo final de USD | ≈ **−125** (rango −225 a −50) |
| Comprobación "saldo final = inicial − 5 × aprobados" | **pasa**: cada aprobado descuenta una vez, el problema es que hay de más |
| Con el código real (`origin/main`) | 20 aprobados y USD 0, como ya se midió |

**Razonamiento.** Llegan a la reserva ≈ 49 pedidos por segundo durante la ráfaga (≈ 64 de cada 100, repartidos en ≈ 1,3 s). Todos los chequeos hechos antes de que aterrice el primer descuento (≈ 0,8 s) ven 100 USD y pasan. El saldo recién llega a 0 cuando aterriza el 20.º descuento, ≈ 1,2 s. Hasta ahí, todo chequeo pasa: ≈ 45 a 50. Es la misma forma que dio el TP 1 con la carrera corta (40 aprobados, saldo −100).

**Límite.** Si diera 20 aprobados, el test **no tiene poder** con esta carga, y habría que subir la concurrencia.

## B. Prueba en seco del plugin de Datadog (sin cuenta)

El entorno `azure` de los YAML nunca se ejecutó. Se corre el escenario `reintentos` con `--env azure`, con una clave falsa y `DATADOG_API_HOST` apuntando a un nombre que no existe (para que nada salga de la máquina), y `DEBUG=plugin:publish-metrics:datadog-statsd`.

| Qué | Predicción |
|---|---|
| Artillery acepta el entorno `azure` y arranca | **sí** |
| Los `tags` salen con el valor real: `test:exchange-integridad-reintentos` y `caso:<el caso>` | **sí** (el template `{{ $processEnvironment.CASO }}` funciona dentro de `tags`). Es la duda que dejó anotada el plan |
| El debug muestra `Initializing datadog via HTTPS` y la clave tapada | **sí** |
| La corrida termina igual aunque Datadog no se pueda alcanzar | **sí**, con avisos de error al enviar métricas, sin abortar |
| Que las métricas **lleguen** a Datadog | **no se puede comprobar sin cuenta**: queda para Azure |

## C. `saldo` bajo carga (`exchange-integridad-saldo-carga`)

**Para qué.** La integridad también tiene que valer cuando el sistema está ocupado, no solo con 10 pedidos por segundo. Mismo montaje de saldo (20 cambios), con una ráfaga de 100 y después **100 pedidos por segundo durante 30 s**: **3.100 pedidos** en total.

| Qué | Predicción para 1 nodo y para 2 nodos (local) | Tipo |
|---|---|---|
| Aprobados | **20** | exacta |
| Saldo final de USD / de ARS | **0** / **120.100.000** | exacta |
| Saldo mínimo visto | ≥ 0 | exacta |
| Entradas del log con `ok: true` | **20** | exacta |
| Entradas nuevas del log = pedidos respondidos | **3.100** | exacta |
| Errores propios (timeouts, ECONN, 5xx que no son 503 de ARCA) | **0** | exacta |
| 422 | ≈ 1.960 (±110) | esperada |
| 403 | ≈ 930 (±100) | esperada |
| 503 | ≈ 186 (±45) | esperada |
| Latencia de un 200 | mediana ≈ RTT + 985 ms (sin cambio respecto de 10 req/s) | esperada |
| CPU del nodo | < 15 % (≈ 100 req/s × ≈ 1,2 ms) | esperada |

**En la nube** se espera lo mismo mientras el nodo no se sature: 100 req/s es ≈ 60 % del escalón de 160 req/s que las otras predicciones esperan sin saturar (CPU ≈ 20 %). Si en Azure el nodo se satura y aparecen timeouts del cliente, se esperan **tres cosas a la vez**: (1) fallan las comprobaciones del cliente (respuestas, errores propios), (2) **siguen valiendo las del servidor**: 20 entradas `ok: true` en el log, saldo final de USD 0 y nunca negativo, y (3) el log puede tener **más** entradas que respuestas recibidas (pedidos que el servidor procesó y cuya respuesta el cliente no vio). Por eso `correr.mjs` va a comprobar también las invariantes **solo con el log y los saldos**.

## D. Duplicados concurrentes (`exchange-integridad-duplicados`)

**Para qué.** El escenario de reintentos manda el segundo pedido *después* de recibir la respuesta del primero, así que nunca ejercita el caso "mismo pedido mientras el primero sigue en curso" (la reserva `lease`, que responde 409). Acá cada usuario manda **los dos pedidos a la vez** (con conexiones separadas, y con 2 nodos pueden caer en nodos distintos). **100 pares** a razón de 10 pares por segundo (200 pedidos), y después un tercer pedido secuencial con la misma clave.

| Qué | Predicción | Tipo |
|---|---|---|
| Pares con **exactamente un 409** | **100 de 100** en local | exacta en local; ≥ 95 de 100 en la nube (si la diferencia de llegada supera los ≈ 100 ms que dura la operación, el segundo ya encuentra la respuesta guardada) |
| Pares con dos respuestas que no son 409 y no son iguales | **0** | exacta |
| Entradas nuevas del log = cantidad de pares | **100** (el que pierde con 409 no genera entrada) | exacta |
| Entradas con `ok: true` = pares cuyo ganador fue 200 | igualdad | exacta |
| Pares con dos aprobaciones distintas | **0** | exacta |
| Tercer pedido (cuando el ganador fue 200 o 403) | **misma respuesta y mismo `id`**, 100 % | exacta |
| Ganador: 200 / 403 / 503 | ≈ 64 / 30 / 6 (±12 / ±12 / ±6) de 100 | esperada |
| Latencia del 409 | mediana ≈ **RTT + 5 ms** | esperada |
| Pares cuyos dos pedidos caen en nodos distintos (con 2 nodos) | ≈ 50 (±10) | esperada |

**Razonamiento.** La clave se reserva con un `SET NX` en Redis (`createRedisStore`): de dos pedidos simultáneos, solo uno lo consigue, aunque estén en nodos distintos. El otro encuentra la clave sin respuesta guardada y devuelve 409 con `Retry-After: 1` (`node/idempotency.js`). Mientras el ganador consulta a ARCA pasan ≥ 100 ms (≥ 200 ms si ARCA aprueba), mucho más que la diferencia de llegada en local (unos pocos ms).
