# Disponibilidad con 1 nodo: resultados contra la predicción

- **Predicción:** [`perf/predicciones/disponibilidad.md`](../predicciones/disponibilidad.md), commit `2d25945`, pusheado antes de medir.
- **Corrida:** `perf/results/azure-1-nodo/exchange-disponibilidad/`, 18/11 de 01:50:40 a 01:54:31 UTC. Despliegue `gunegfcioh.eastus2.cloudapp.azure.com`, 1 instancia `Standard_F1als_v7` (`terraform-output.txt`, `vmss-list-instances.txt`). Generador en una laptop por cable (`meta.txt`).
- **Números:** todos salen de `resumen.md` / `resumen.json`, que genera `perf/disponibilidad/analizar.mjs` a partir de los crudos de esa carpeta.
- **Latencia de base:** `GET /` con conexión nueva, p50 314 ms (`base.json`).

Los segundos son desde el inicio de la corrida. Artillery tardó unos 20 s en empezar a mandar carga, así que las fallas cayeron más tarde que en el plan: `kill -9` a los 69,8 s, `pm2 stop` a los 126,1 s y `pm2 start` a los 155,4 s (`fallas.jsonl`, reloj del nodo).

## Comparación

| Falla | Qué | Predicho | Medido | |
|---|---|---|---|---|
| E9 | Inválidos enviados | 25 | 32 | ≈ (12,5 % al azar) |
| E9 | Código | 400 | 400 en los 32 | ✓ |
| E9 | Latencia de un 400 | ≈ `GET /`, ~370 ms menos que un 403 | 315 ms (base + 1 ms); el 403 tarda 655 ms | ✓ |
| E9 | 5xx propios o sin respuesta en la ventana | 0 | 0 | ✓ |
| `kill -9` | Vuelve a responder | 7 s | 1 s (primera respuesta a los 70,9 s) | ✗ |
| `kill -9` | Pedidos perdidos | 160 | 26 | ✗ |
| `kill -9` | Segundos sin 200 en `/health` | ≥ 7 | 1 | ✗ |
| `kill -9` | Cómo los ve el cliente | timeout | 23 `ECONNRESET` y 3 `ECONNREFUSED` | ✗ |
| `pm2 stop/start` | Vuelve a responder, desde el `start` | 7 s | 13,8 s (primera respuesta a los 169,2 s) | ✗ |
| `pm2 stop/start` | Pedidos perdidos | ≈ 760 | 709 | ✓ |
| `pm2 stop/start` | Cómo los ve el cliente | timeout | 553 `ECONNREFUSED` y después 156 timeouts | ✗ |

El t_rec "desde la restauración" del analizador da 7 s para el `pm2 start`, igual que la predicción, pero cuenta los pedidos por el segundo en que salieron: los que salieron desde los 162 s se atendieron, pero la respuesta les llegó recién a partir de los 169,2 s. Para el cliente el servicio volvió 13,8 s después del `start`, y esa es la cifra que se compara.

## Explicación de las diferencias

**`kill -9`: 1 s y no 7.** El 7 venía del TP 1, donde Docker volvía a levantar el contenedor. Acá pm2 relanza solo el proceso de node dentro de la misma VM. El monitor de `/health` falla un solo segundo (70 s → error, 71 s → 200) y pm2 pasa de 0 a 1 reinicio (`pm2-antes.json`, `pm2-despues.json`). Con 1 s caído se pierden los ~20 pedidos en curso más los pocos que llegan en ese segundo: 26, no 160.

**Los pedidos en curso se pierden con `kill -9` y no con `pm2 stop`.** `kill -9` no se puede atrapar: el proceso muere en el acto y el sistema operativo corta las conexiones abiertas (los 23 `ECONNRESET`, todos en el período 69–79 s). `pm2 stop` manda SIGINT, que la app atrapa: deja de aceptar conexiones, espera a que terminen las abiertas y sale (`SIGINT received, shutting down` en `pm2-log-arranques.txt`). Un pedido dura ~1,2 s y pm2 espera hasta 1,6 s antes de matar el proceso, así que terminaron: en el `stop` no hay ningún `ECONNRESET`. El apagado ordenado del TP 1 se trasladó a la nube.

**Rechazo y no timeout.** El balanceador de Azure es de capa 4: reenvía la conexión TCP al nodo y no espera a la app. Con la app caída, el sistema operativo del nodo rechaza la conexión al instante (`ECONNREFUSED`): así es todo el `kill -9` y todo el `stop` hasta los 159 s.

**Los 156 timeouts salen del probe, no de conexiones ya abiertas.** Aparecen solo en los períodos 159–169 y 169–179 s, o sea en pedidos que salieron a partir de ~150 s. El monitor de `/health` pasa de `ECONNREFUSED` a timeout a los 155,1 s, unos 29 s después del `stop`: dos consultas del probe (cada 15 s) marcaron el nodo caído y desde ahí el balanceador descartó las conexiones en silencio en lugar de dejar que el nodo las rechazara.

**13,8 s después del `start`.** La app volvió a escuchar, pero el balanceador solo le manda tráfico de nuevo cuando el probe la ve sana, y el probe consulta cada 15 s: `/health` vuelve a 200 a los 170,1 s y la primera respuesta llega a los 169,2 s. Los pedidos que salieron entre 161 y 169 s no se perdieron porque el cliente reintenta la conexión (1, 3 y 7 s): por eso 134 tardaron más de 2 s, con un máximo de 8.754 ms. Los que salieron antes agotaron los reintentos dentro de los 10 s y fueron timeout.

## Qué dice esto para el caso de 2 nodos

Con 1 nodo, el probe del balanceador alarga la caída: tarda ~29 s en marcar el nodo caído y hasta 15 s en marcarlo sano de nuevo. Con 2 nodos esos mismos tiempos deciden cuánto tráfico sigue yendo al nodo roto antes de que el balanceador lo saque del pool.

## Errores de las herramientas en esta corrida (para la sección de IA)

- **Eventos de Datadog:** `correr.mjs` publicaba cada falla con la API v1 de eventos y la organización respondió 403: `This organization is not enabled for the v1 events API. Submit events with POST /api/v2/events instead.` La hora de cada falla está igual en `fallas.jsonl`.
- **Analizador:** la primera versión contaba solo los pedidos que salieron después de la falla y no los que estaban en curso: informaba 19 perdidos en el `kill -9` en lugar de 26. Corregido en `de1f7f0` antes de commitear los resultados.
- **t_rec:** contar por segundo de salida hacía parecer que el `pm2 start` se recuperaba en 7 s. Se agregó "primera respuesta" al analizador.
