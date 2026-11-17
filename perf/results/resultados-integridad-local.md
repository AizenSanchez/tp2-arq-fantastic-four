# Resultados de los ensayos locales del bloque 4 (integridad)

Predicciones: [`../predicciones/integridad.md`](../predicciones/integridad.md), commiteadas **antes** de estas corridas.

## Qué son y qué no son

Son **ensayos en local** con `docker-compose.local.yml`: sirven para comprobar que los scripts funcionan y que las propiedades de integridad se cumplen con la app tal como está en `main`. **No son los casos de la nube** (1 nodo y escalado en Azure): esos se corren después, con los mismos scripts, y se comparan con las mismas predicciones.

Cada corrida se hizo con el árbol de git limpio (`meta.txt` lo registra en `git status`). Código: commit `84475e5`.

| Caso | Escenario | Evidencia |
|---|---|---|
| `local-1-nodo` | saldo | `local-1-nodo/exchange-integridad-saldo.json` y carpeta del mismo nombre |
| `local-1-nodo` | reintentos | `local-1-nodo/exchange-integridad-reintentos.json` y carpeta |
| `local-2-nodos` | saldo | `local-2-nodos/exchange-integridad-saldo.json` y carpeta |
| `local-2-nodos` | reintentos | `local-2-nodos/exchange-integridad-reintentos.json` y carpeta |
| ARCA | medición | `local-arca/medicion.txt` (la reproduce `perf/integridad/medir-arca.mjs`) |

## 1. Lo principal: las invariantes exactas se cumplen en los cuatro casos

**Saldo** (400 pedidos, saldo para 20 cambios):

| | 1 nodo | 2 nodos | Predicción |
|---|---|---|---|
| Cambios aprobados | **20** | **20** | 20 |
| Saldo final de USD | **0** | **0** | 0 |
| Saldo final de ARS | **120.100.000** | **120.100.000** | 120.100.000 |
| Saldo de USD mínimo visto | 0 (40 lecturas) | 0 (40 lecturas) | ≥ 0 |
| Entradas nuevas en el log | 400 | 400 | 400 |
| Aprobados por nodo | 20 / 0 | 10 / 10 | cualquier reparto que sume 20 |
| Pedidos por nodo | 400 / 0 | 212 / 188 | ≈ 50 / 50 con 2 nodos |

**Reintentos** (200 usuarios, cada uno manda el pedido dos veces con la misma clave):

| | 1 nodo | 2 nodos | Predicción |
|---|---|---|---|
| Reintentos idénticos (misma respuesta y mismo `id`) | **187 de 187** | **184 de 184** | 100 % |
| Usuarios con dos aprobaciones distintas | **0** | **0** | 0 |
| Respuestas 409 | 0 | 0 | 0 |
| Log: `ok:true` = aprobaciones distintas | 138 = 138 | 133 = 133 | igualdad exacta |
| Log: entradas nuevas | 213 | 216 | ≈ 211 (±7) |
| Reintentos que cruzaron a otro nodo | 0 | **96 de 200 (48 %)** | 0 % y ≈ 50 % (86 a 114) |
| Mediana de un reintento repetido | 6 ms | 6 ms | ≈ 5 ms |

Las 39 comprobaciones exactas de los cuatro casos (8 + 8 + 12 + 11) dieron OK (detalle en cada `informe.json`).

## 2. Diferencias con la predicción y su causa

Solo hubo diferencias en los valores **esperados** (los que dependen del azar de ARCA), y solo en la corrida de saldo con 1 nodo:

| Valor | Predicho | Observado | Estado |
|---|---|---|---|
| 403 (ARCA rechaza) | ≈ 144 (126 a 162) | 122 | fuera, por 4 |
| Llegan a la reserva (200 + 422) | ≈ 235 (215 a 255) | 259 | fuera, por 4 |
| 422 | ≈ 215 (195 a 235) | 239 | fuera, por 4 |

**Causa verificada.** Estimé que ARCA rechaza el 38 % de los DNI. La medición de `medir-arca.mjs` sobre 600 DNI al azar dio **29,7 % ± 3,7** (`local-arca/medicion.txt`). Juntando esa muestra con otra anterior de 600 DNI (35 %, que no quedó guardada como evidencia, así que solo la medición de `medir-arca.mjs` es citable), el rechazo ronda el 32 %: de 400 pedidos se esperan ≈ 120 a 130 rechazos y no 144, y eso explica los tres valores a la vez (si rechaza menos, llegan más a la reserva y sobran más 422). Los casos de 2 nodos y de reintentos, con otros DNI al azar, quedaron dentro del rango.

Dos cosas que descubrí al investigar, que **no estaban en las predicciones**:

1. **El rechazo de ARCA es fijo por DNI.** Un DNI rechazado sigue rechazado: 0 de 30 rechazados y 0 de 30 aprobados cambiaron de respuesta al repetirlos 5 veces. No sigue ningún patrón por último dígito, resto ni rango. Lo que sí es al azar por llamada son los HTTP 500.
2. **Las fallas de ARCA son 24,4 % ± 1,5**, algo más que el 23 % que usé. La falla residual con 1 reintento es entonces ≈ 6,0 % y no 5,3 %. Los 503 observados (19, 26, 13 y 16 en cuatro corridas de 400 pedidos) están todos dentro de lo esperable para ese valor.

Consecuencia para la comparación con Azure: las proporciones 5 / 36 / 59 % (503 / 403 / 200) de las predicciones pasan a ser, con las mediciones nuevas, ≈ 6 / 30 / 64 %. Las invariantes exactas no cambian.

## 3. Qué se cumplió de lo predicho y con cuánta precisión

- Latencia de un 200 (saldo, 1 nodo): mediana **992 ms** contra 985 predicho. Con 2 nodos 921 ms (rango 865 a 1.105, en el rango).
- Latencia de un 422: **390 ms** contra 385 predicho (2 nodos: 387).
- Reintento repetido: mediana **6 ms** contra 5 predicho, P95 11 ms. Es la diferencia más grande entre una operación nueva (≈ 985 ms) y un reintento guardado, y confirma que el reintento no llama a ARCA.
- Cruce de nodos con 2 nodos: **48 %** contra 50 % predicho, aunque en local lo hace el script, no un balanceador.

## 4. Límites de estos resultados (lo que NO prueban)

- Son locales: no hay red entre el generador y el servicio (`RTT = 0`), Redis no tiene TLS ni latencia, y ARCA no tiene el límite de 0,5 vCPU. Las latencias de la nube van a ser más altas y hay que compararlas sumando el RTT.
- Con 2 nodos, **no hay balanceador**: el reparto lo hace `procesadores.cjs` al azar en cada conexión. El Azure Load Balancer reparte por hash de la conexión; queda **sin verificar** que `Connection: close` fuerce una conexión nueva que además caiga en otro nodo con ≈ 50 % de probabilidad.
- Cada caso se corrió una sola vez. Las diferencias menores al azar de ARCA no se pueden separar del ruido con una corrida.
- La carga es baja a propósito (≤ 100 pedidos en 1 s): no pone a prueba CPU ni Redis. Eso es del bloque 1.

## 5. Qué se hace en la nube

1. Medir el RTT base y poner `RTT_MS`.
2. Un escenario a la vez, con `ansible/reset.sh` antes (lo hace `correr.mjs`): comparten tasa y saldo de USD con los demás bloques.
3. `1-nodo` y `escalado`, con los mismos dos escenarios. Si en la nube aparece **un solo aprobado de más** (21 o más) o **un reintento con respuesta distinta**, es un hallazgo grave: hay que explicarlo y no tratarlo como una diferencia menor.

---

# Ampliación del 17/11: control negativo, plugin de Datadog, saldo bajo carga y duplicados

Predicciones: sección "Ampliación del 17/11" de [`../predicciones/integridad.md`](../predicciones/integridad.md), commiteada antes de implementar y de correr esto (commit `7278141`).

## A. Control negativo: el escenario de saldo detecta una reserva no atómica

`perf/integridad/control-negativo.mjs` corre `saldo` contra una copia temporal de la app cuya reserva chequea y descuenta ~600 ms después, como el TP 1 (es una **simulación** del defecto, no el código del TP 1). Evidencia: `local-control-negativo/`.

| | Predicción | Resultado | Con la reserva real |
|---|---|---|---|
| Resultado de la verificación | INVARIANTE ROTA | **INVARIANTE ROTA** (2 exactas rotas) | INVARIANTES OK |
| Aprobados | ≈ 45 (30 a 65) | **58** | 20 |
| Saldo final / mínimo de USD | ≈ −125 (−225 a −50) | **−190** | 0 |
| "saldo final = inicial − 5 × aprobados" | pasa | **pasa** (−190 = 100 − 5 × 58) | pasa |

El defecto se detecta, y las dos comprobaciones que se predijeron como rotas se rompieron (aprobados = 20 y saldo nunca negativo). El valor central de aprobados quedó por encima de lo predicho (58 contra ≈ 45, aunque dentro del rango): el modelo subestimó cuánto tarda en aterrizar el descuento número 20 con ventanas de 400 a 800 ms.

**Lo que descubrió el control sobre mis propios scripts.** La primera corrida dio INVARIANTES OK, o sea que **no** detectó el defecto. La causa verificada: el `target` del entorno `local` de los YAML estaba fijo en `localhost:3000` y le ganaba a `TARGET`, así que el tráfico iba al contenedor del compose y no a la copia (el campo `por nodo` mostraba el id del contenedor). Se corrigió en `80e78d3`. Los ensayos locales anteriores no se ven afectados: los de 1 nodo apuntaban a ese puerto a propósito, y los de 2 nodos reparten por URL absoluta (aparecen dos `X-Node` distintos).

## B. Prueba en seco del plugin de Datadog (sin cuenta)

Evidencia: `local-datadog-seco/salida.txt` (clave falsa y host inexistente).

| Predicción | Resultado |
|---|---|
| Artillery acepta el entorno `azure` y arranca | **Cumplida** |
| Los tags salen con el valor real (`test:…`, `caso:…`) | **Cumplida**: `tags: ['test:exchange-integridad-reintentos', 'caso:local-datadog-seco']`. El template funciona dentro de `tags` |
| El debug muestra "Initializing datadog via HTTPS" y la clave tapada | **A medias**: aparece "Initializing datadog via HTTPS", pero la clave sale **sin tapar** |
| La corrida termina igual aunque Datadog no se pueda alcanzar | **Falló**: el plugin cae con `TypeError: Cannot read properties of null (reading 'status')` y no se genera ningún reporte |
| Que las métricas lleguen a Datadog | No se pudo comprobar sin cuenta |

Causas verificadas leyendo `artillery-plugin-publish-metrics/lib/datadog.js`: (1) la línea que tapa la clave hace `Object.assign({ apiKey: sanitize(...) }, config)` y `config` pisa el valor tapado con el original, así que el debug la imprime en claro (una vez por proceso, 8 veces en la salida); (2) el callback de la llamada que crea el evento de inicio de Artillery en Datadog accede a `res.status` sin comprobar que `res` no sea nulo (línea 188).

Consecuencias para el grupo:
- `perf/run.sh` exporta `DEBUG=plugin:publish-metrics:datadog-statsd`: con una clave real **la imprime en la terminal**, y la tapa solo si el debug está apagado. No guardar ni commitear la salida de esa terminal, y mejor sacar el `export DEBUG` antes de la corrida oficial.
- Una clave inválida, o una falla de Datadog al arrancar, **tira abajo toda la corrida** antes de medir nada. Antes de la corrida oficial hay que hacer una prueba corta con la clave real y mirar que llegue al dashboard.
- Sin verificar: `apiHost` figura como deprecado en `datadog-metrics` (pide `site`). Funciona en esta versión, pero conviene comprobar con una clave real que `app.datadoghq.com` (lo que dice el plan) sea aceptado.

## C. Saldo bajo carga (3.100 pedidos, 100 por segundo sostenidos)

| | 1 nodo | 2 nodos | Predicción |
|---|---|---|---|
| Aprobados / USD final / ARS final | 20 / 0 / 120.100.000 | 20 / 0 / 120.100.000 | 20 / 0 / 120.100.000 |
| Saldo mínimo visto | 0 | 0 | ≥ 0 |
| Entradas nuevas del log | 3.100 | 3.100 | 3.100 |
| Comprobaciones solo del servidor | OK | OK | OK |
| 422 / 403 / 503 | 1.910 / 977 / 193 | 1.906 / 998 / 176 | ≈ 1.960 / 930 / 186 |
| Mediana de un 200 / de un 422 | 963 / 372 ms | 957 / 385 ms | ≈ 985 / 385 ms |
| Pedidos por nodo | 3.100 / 0 | 1.563 / 1.537 | ≈ 50 / 50 |

Las 22 comprobaciones exactas y todas las esperadas se cumplieron. Con las proporciones de ARCA ya medidas, las predicciones esperadas cayeron en el rango (con las primeras, 36 % de rechazo, no lo habrían hecho). **No se midió CPU**: la predicción de CPU < 15 % queda para Azure.

## D. Duplicados concurrentes (100 pares de pedidos simultáneos, más un tercero)

| | 1 nodo | 2 nodos | Predicción |
|---|---|---|---|
| Pares con exactamente un 409 | **100 de 100** | **100 de 100** | 100 de 100 (en local) |
| Todo 409 con `Retry-After: 1` | 100 de 100 | 100 de 100 | sí |
| El tercer pedido repite la respuesta del ganador (mismo `id`) | 98 de 98 | 93 de 93 | 100 % |
| Aprobaciones en el log = aprobaciones distintas | 68 = 68 | 68 = 68 | igualdad |
| Entradas nuevas = respuestas distintas + 503 | 102 | 107 | igualdad |
| Ganador 200 / 403 / 503 | 67 / 31 / 2 | 62 / 31 / 7 | ≈ 64 / 30 / 6 |
| Mediana de un 409 | 6 ms | 7 ms | ≈ 5 ms |
| Pares con los dos pedidos en nodos distintos | 0 | **50** | 0 y ≈ 50 |

Con 2 nodos el 409 sigue siendo exacto en los 100 pares aunque los dos pedidos caigan en nodos distintos, lo que confirma que la clave en Redis (`SET NX`) coordina entre nodos. Aún hay que ver qué pasa en la nube, donde la diferencia de llegada entre los dos pedidos puede superar la duración de la operación (≈ 100 ms): ahí la predicción es ≥ 95 de 100, no 100.

## Lo que sigue sin probarse

- El control negativo cubre `saldo` (reserva atómica). Para `reintentos` y `duplicados` no se hizo una variante sin idempotencia en este TP; el TP 1 ya tiene la comparación del caso base (2.550 entradas en el log contra 1.275 con la táctica).
- Todo es local: faltan RTT, TLS en Redis, ARCA con 0,5 vCPU y el balanceador real.
