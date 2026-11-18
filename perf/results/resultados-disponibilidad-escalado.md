# Disponibilidad con 2 nodos: resultados contra la predicción

- **Predicción:** [`perf/predicciones/disponibilidad.md`](../predicciones/disponibilidad.md), caso escalado, commit `77d5f4c`, pusheado antes de escalar (`240a951`) y de medir.
- **Corrida:** `perf/results/azure-escalado/exchange-disponibilidad/`, 18/11 de 02:38:15 a 02:43:36 UTC. Mismo despliegue y mismo generador que el caso de 1 nodo (`gunegfcioh.eastus2.cloudapp.azure.com`, laptop por cable), con 2 instancias `Standard_F1als_v7` (`terraform-output.txt`, `vmss-list-instances.txt`).
- **Fallas:** solo en `vmss[0]` = `tp2vmss000000` (10.0.2.4, `azure-monitor/LEEME.txt`); `tp2vmss000001` (10.0.2.5) siguió sano. `kill -9` a los 76,5 s, `pm2 stop` a los 126,6 s, `pm2 start` a los 155,5 s, `kill -STOP` a los 215,4 s y `kill -CONT` a los 245,6 s (`fallas.jsonl`, reloj del nodo).
- **Números:** todos salen de `resumen.md` / `resumen.json`, que genera `perf/disponibilidad/analizar.mjs` a partir de los crudos.
- **Latencia de base:** `GET /` con conexión nueva, p50 316 ms (`base.json`).

## Comparación

| Falla | Predicho | Medido | |
|---|---|---|---|
| E9 (control) | — | 29 inválidos, todos 400, mediana 316 ms (= base) | igual que con 1 nodo |
| `kill -9` | 0 perdidos | 21: 13 `ECONNRESET` y 8 `ECONNREFUSED`, todos en el período 74–84 s | ✗ |
| `pm2 stop` → `start` | 0 perdidos | 320, todos `ECONNREFUSED` (y 1 `ECONNRESET`), salidos entre 126 y 152 s; después, 0 | ✗ |
| `kill -STOP` → `kill -CONT` | 0 perdidos, el probe saca el nodo | 125 timeouts, salidos entre 214 y 236 s, y 48 respuestas de más de 2 s (máximo 10.158 ms); el nodo no salió del pool | ✗ |

Contra 1 nodo (`resultados-disponibilidad-1-nodo.md`), el segundo nodo reduce las pérdidas pero no las elimina: `kill -9` de 26 a 21 y `pm2 stop` de 709 a 320.

## Explicación de las diferencias

**`kill -9`.** El balanceador no reintenta: un pedido que ya fue al nodo roto no vuelve al balanceador para que lo mande al otro. Se pierden los que estaban en curso en ese nodo (los 13 `ECONNRESET`) y los que el balanceador le mandó en el segundo que tardó pm2 en relanzar la app (los 8 `ECONNREFUSED`). Fue tan corto que el probe no lo registró: 10.0.2.4 figura al 100 % en Azure Monitor en ese minuto.

**`pm2 stop`.** Lo mismo durante los primeros ~26 s: el balanceador siguió mandándole al nodo detenido su parte de las conexiones nuevas y el nodo las rechazó. Las pérdidas terminan a los 152 s, cuando el probe marcó el nodo caído (con 1 nodo tardó ~29 s); desde ahí el balanceador mandó todo al otro nodo y no se perdió ningún pedido más, tampoco al volver con el `pm2 start`. No hubo cortes de pedidos en curso porque `pm2 stop` es un apagado ordenado (`SIGINT received, shutting down` en `pm2-log-arranques.txt`).

**`kill -STOP`.** El probe es TCP: comprueba que se pueda abrir una conexión al puerto 3000, no que la app responda. Con el proceso congelado el sistema operativo sigue completando esas conexiones y las deja en cola, así que para el probe el nodo está sano y el balanceador le siguió mandando tráfico los 30 s. Los pedidos que salieron entre 214 y 236 s esperaron más de los 10 s de Artillery y fueron timeout; los que salieron después esperaron menos de 10 s hasta el `kill -CONT` y se respondieron tarde (las 48 respuestas lentas). Azure Monitor muestra a 10.0.2.4 al 100 % en el minuto que cubre los segundos 225 a 284, con 20 s del congelamiento.

## Límites

- **El monitor de `/health` (E14) no vale en esta corrida.** Reutilizaba la conexión y el balanceador la mandó siempre al nodo sano: las 322 consultas fueron a `tp2vmss000001` y todas dieron 200. Corregido en `40c0fc2` (conexión nueva en cada consulta) después de esta corrida.
- **"Primera respuesta" no aplica con 2 nodos:** el nodo sano responde todo el tiempo. Lo que mide la recuperación son los segundos con pedidos perdidos.
- **Estado del probe:** Azure Monitor lo da por minuto y no queda claro si la etiqueta es el comienzo o el final del minuto. La caída al 46 % de 10.0.2.4 queda cerca del `pm2 stop`, pero no se puede ubicar con más precisión. La conclusión del `kill -STOP` no depende de eso: el minuto con 20 s de congelamiento da 100 % con cualquiera de las dos lecturas, y los timeouts siguieron durante todo el congelamiento.
- **Eventos de Datadog:** volvieron a dar 403 (API v1), como en 1 nodo.

## Qué sugiere para la táctica

El balanceador tarda ~26 s en dejar de mandar tráfico a un nodo caído y nunca detecta uno colgado, porque su probe es TCP. Un probe HTTP sobre `/health`, con un intervalo más corto, atacaría las dos cosas: un proceso congelado no responde HTTP, y un intervalo menor acorta la ventana en la que se pierden pedidos.
