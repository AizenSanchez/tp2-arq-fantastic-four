# Pruebas de integridad (bloque 4)

Dos escenarios que juntan los cinco del TP 1 (carrera corta, carrera larga, reintentos, métricas en un sentido y con rechazos).
Las predicciones están en [`../predicciones/integridad.md`](../predicciones/integridad.md) y se commitearon **antes** de medir.

| Escenario | Qué prueba | Archivo |
|---|---|---|
| `saldo` | Con saldo para 20 cambios y 400 pedidos, se aprueban exactamente 20 y el saldo nunca es negativo | `exchange-integridad-saldo.yaml` |
| `saldo-carga` | Lo mismo con 3.100 pedidos (100 por segundo durante 30 s): la integridad vale con el nodo ocupado | `exchange-integridad-saldo-carga.yaml` |
| `reintentos` | Repetir un pedido con la misma `Idempotency-Key` devuelve la misma respuesta y no opera dos veces, aunque caiga en otro nodo | `exchange-integridad-reintentos.yaml` |
| `duplicados` | Dos pedidos iguales **a la vez** con la misma clave: uno opera, el otro recibe 409, y un tercero repite la respuesta (lanzador propio, no Artillery) | dentro de `correr.mjs` |

Otros scripts: `control-negativo.mjs` (comprueba que `saldo` **detecta** una reserva que no es atómica) y `medir-arca.mjs` (caracteriza las fallas y rechazos de ARCA).

`correr.mjs` hace todo: reinicia el estado, prepara el escenario, lanza Artillery, vigila el saldo cada segundo y al final
verifica las invariantes contra `/accounts` y `/log`. Solo usa HTTP. Termina con código 1 si se rompe una invariante **exacta**
(las **esperadas** solo se informan). El crudo de Artillery queda en `perf/results/<caso>/` junto con la evidencia.

## Local (ensayo de los scripts)

```bash
cd perf && npm ci && cd ..                                    # una vez
docker compose -f docker-compose.local.yml --profile dos-nodos up -d --build

node perf/integridad/correr.mjs saldo local-1-nodo
node perf/integridad/correr.mjs saldo-carga local-1-nodo
node perf/integridad/correr.mjs reintentos local-1-nodo
node perf/integridad/correr.mjs duplicados local-1-nodo
node perf/integridad/control-negativo.mjs                     # tiene que terminar con "OK": detecta el defecto
# dos nodos: no hay balanceador en local, el script elige el nodo al azar en cada conexion
TARGETS=http://localhost:3000,http://localhost:3001 node perf/integridad/correr.mjs saldo local-2-nodos
TARGETS=http://localhost:3000,http://localhost:3001 node perf/integridad/correr.mjs reintentos local-2-nodos
```

## Azure (lo corre quien mide, en el lugar fijo)

Antes: `GET /` para el RTT base, y **un escenario a la vez**: cambian la tasa y el saldo de USD, que son compartidos con los demás bloques.

```bash
export DATADOG_API_KEY=...            # sin escribirla en ningun archivo
export RTT_MS=<RTT base medido>       # para comparar latencias con la prediccion
export CONEXION=cable                 # o wifi (queda en meta.txt)
# el reinicio es ansible/reset.sh (lo hace correr.mjs); el target sale de node/lb_dns
node perf/integridad/correr.mjs saldo 1-nodo --env azure
node perf/integridad/correr.mjs reintentos 1-nodo --env azure
# subir node_instances a 2, ansible/setup.sh, ansible/deploy.sh, y repetir con el caso "escalado"
node perf/integridad/correr.mjs saldo escalado --env azure
node perf/integridad/correr.mjs reintentos escalado --env azure
# opcionales: saldo-carga y duplicados, con ambos casos
```

**Antes de la corrida oficial, con la clave real, una prueba corta** (por ejemplo `reintentos` con un caso de prueba como `prueba-seca`) y mirar que las métricas lleguen al dashboard: una clave inválida o una falla de Datadog al arrancar hace caer Artillery **antes de medir** (ver `perf/results/resultados-integridad-local.md`, sección B). Y **no dejar `DEBUG=plugin:publish-metrics:datadog-statsd` prendido** (lo exporta `perf/run.sh`): imprime la clave en claro.

## Qué queda en `perf/results/<caso>/`

- `exchange-integridad-<escenario>.json`: reporte crudo de Artillery.
- `exchange-integridad-<escenario>/pedidos.jsonl`: una línea por pedido (estado, id, nodo, latencia).
- `.../saldos.jsonl`: saldo de USD y ARS cada segundo.
- `.../antes.json` y `despues.json`: cuentas y entradas nuevas del log.
- `.../informe.json`: cada comprobación, exacta o esperada, con su resultado.
- `.../meta.txt`: inicio y fin UTC, commit, `git status`, versiones, máquina, tipo de conexión.

## Diferencias de local con Azure (importan al comparar)

- En local el reparto entre nodos lo hace el script (al azar por conexión); en Azure lo hace el balanceador L4 (hash de la conexión).
- En local no hay latencia de red: `RTT_MS` queda en 0.
- Redis local no tiene TLS ni red de por medio; el de Azure sí.
