# Táctica: probe HTTP del balanceador

Ordenado como la sección 9 del informe: problema observado, QA objetivo, predicción, implementación, resultados y
tradeoffs. Todos los números salen de `resumen.md` / `resumen.json` (generados por `perf/disponibilidad/analizar.mjs`) y
de `azure-monitor/` de cada corrida.

| | Línea base | Táctica |
|---|---|---|
| Corrida | `perf/results/azure-escalado/` (18/11 02:38 UTC) | `perf/results/azure-tactica-probe/` (18/11 22:54 UTC) |
| Commit medido | `240a951` | `e0c2c73` |
| Despliegue | `gunegfcioh.eastus2`, 2 × `Standard_F1als_v7`, Redis `Balanced_B0` | el mismo |
| Generador | la misma laptop, por cable | el mismo |
| Latencia de base (`GET /`, conexión nueva, p50) | 316 ms | 309 ms |

## 1. Problema observado

Con 2 nodos y el probe por defecto (TCP al puerto 3000 cada 15 s), cuando se rompe un nodo el balanceador le sigue
mandando su parte de las conexiones nuevas (`resultados-disponibilidad-escalado.md`):

- `pm2 stop`: 320 pedidos perdidos durante ~26 s, hasta que el probe marcó el nodo caído.
- `kill -STOP` (proceso colgado): 125 timeouts y 48 respuestas tardías durante los 30 s enteros. El probe TCP nunca sacó
  al nodo: el sistema operativo sigue completando la conexión aunque el proceso esté congelado. Azure Monitor muestra
  a 10.0.2.4 al 100 % en el minuto con 20 s de congelamiento (`azure-escalado/.../azure-monitor/`).

## 2. QA objetivo

Disponibilidad: detectar antes un nodo que no puede atender y sacarlo del pool, incluido uno colgado (táctica de
detección de fallas, ping/echo, aplicada por el balanceador).

## 3. Predicción

`perf/predicciones/tactica-probe-http.md`, commit `65a710b`, pusheado antes de cambiar la infraestructura (`e0c2c73`) y
de medir. Pedidos perdidos: `kill -9` 21, `pm2 stop` 61, `kill -STOP` ≈ 55, suponiendo que el balanceador saca al nodo
en un intervalo del probe (5 s).

## 4. Implementación

`node.tf`, recurso `azurerm_lb_probe.lb_probe` (commit `e0c2c73`):

```hcl
protocol            = "Http"
request_path        = "/"
interval_in_seconds = 5
```

Para estar sano, el nodo tiene que responder 200 a `GET /` ("Server is up.", sin Redis ni ARCA), en lugar de solo
aceptar la conexión TCP. `probe_threshold` (1) y `number_of_probes` (2) quedan como estaban. Aplicado con `terraform
plan -out` y `apply`: 0 recursos creados ni destruidos, el probe modificado en el lugar, sin reiniciar la app.

## 5. Resultados

Misma corrida (`perf/disponibilidad/`, 300 s a 20 pedidos/s), mismas fallas en `tp2vmss000000` y en los mismos segundos
(`fallas.jsonl`).

| Falla | Línea base | Predicho | Táctica | Ventana con pérdidas (base → táctica) |
|---|---|---|---|---|
| `kill -9` | 21 (13 `ECONNRESET`, 8 `ECONNREFUSED`) | 21 | **10** (8 `ECONNRESET`, 2 `ECONNREFUSED`) | 1 s → 1 s |
| `pm2 stop` 30 s | 320 (`ECONNREFUSED`) | 61 | **129** (`ECONNREFUSED`) | 126–152 s → 126–137 s |
| `kill -STOP` 30 s | 125 timeouts + 48 respuestas tardías | ≈ 55 | **77** timeouts, 0 tardías del nodo congelado | 214–236 s → 214–228 s |

- **`pm2 stop`: −60 %. `kill -STOP`: −38 %**, y el nodo colgado ahora sale del pool: después de los 228 s no se pierde
  ningún pedido. En Azure Monitor, 10.0.2.4 queda por debajo del 100 % de las 22:57 a las 22:59 (50, 42 y 83 %), que
  abarca el `pm2 stop` y el congelamiento; el grano de 1 min y el desfase de esa métrica no permiten separarlos.
- **El monitor de `/health`** (conexión nueva por consulta, válido en esta corrida) ve el `pm2 stop` en 7 s de consultas
  sin 200 (129–136 s) y el `kill -STOP` en 1 s con timeout (218 s). La línea base no tiene este dato válido.
- **Datadog** coincide con los crudos sin diferencias (`azure-tactica-probe/.../datadog/verificacion.md`).

**Por qué la predicción quedó corta en `pm2 stop` y `kill -STOP`.** Se supuso que el balanceador saca al nodo en un
intervalo (5 s); las pérdidas duraron 11 y 14 s, o sea unos dos intervalos. Coincide con `number_of_probes = 2`, que
sigue configurado: con 15 s eran 2 × 15 ≈ 30 s (se midieron 26 a 29) y con 5 s son 2 × 5 = 10 s, más hasta un
intervalo de desfase y, en el proceso colgado, la espera hasta que vence el probe HTTP. **No verificado** en la
documentación de Azure: es la explicación consistente con las dos corridas.

**Por qué `kill -9` dio 10 y no 21.** El nodo vuelve en ~1 s y ningún probe llega a verlo, TCP o HTTP. Lo que se pierde
son los pedidos en curso en ese nodo en el instante del `kill` (8 contra 13), que dependen del azar de qué conexiones
tenía abiertas. No es un efecto de la táctica.

## 6. Tradeoffs

- **`GET /` no mira Redis.** Un nodo que no puede hablar con Redis sigue en el pool y falla los cambios. Se eligió así
  porque con `/health` (que consulta Redis) un problema de Redis sacaría a todos los nodos a la vez y el cliente vería
  timeouts en lugar de errores rápidos.
- **Un probe más agresivo saca nodos ocupados.** Con un nodo saturado (el bloque 2 vio llenarse la cola de `listen` del
  kernel a 6B con 1 nodo) el probe también puede fallar y el balanceador sacaría un nodo que todavía atiende,
  cargando más al resto. `number_of_probes = 2` lo amortigua, a costa de los ~10 s de detección medidos.
- **No cubre lo que ya está en curso.** El balanceador de capa 4 no reintenta: los pedidos en curso en un nodo que muere
  se pierden igual (el `kill -9`). Haría falta un proxy de capa 7 que reintente, descartado por costo (bloque 2).
- **Un apagado planificado sigue perdiendo ~10 s de tráfico.** Lo resolvería que la app deje de responder 200 antes de
  cerrar el puerto (drenado); quedó fuera de esta táctica.

## Límites

- **E9 no se ejecutó** en la corrida de la táctica: Artillery tardó 44 s en arrancar (17 s en la línea base) y la
  ventana de pedidos inválidos (30–40 s) pasó sin carga. Era el control, sin predicción; las fallas sí cayeron en los
  mismos segundos que en la línea base.
- **La línea base es del 18/11 a las 02:38 UTC** y la táctica de las 22:54 UTC: no se repitió la base el mismo día. La
  latencia de base fue parecida (316 y 309 ms).
- **Las 30 respuestas de más de 2 s** de la corrida de la táctica están repartidas entre 254 y 336 s en los dos nodos:
  ruido de fondo, no del `kill -STOP`.
- Una sola corrida por caso: diferencias del orden de la del `kill -9` (10 contra 21) no se separan del azar.
- Los eventos de Datadog que marcan cada falla dieron 403 (API v1 no habilitada): la hora de cada falla está en
  `fallas.jsonl`.
