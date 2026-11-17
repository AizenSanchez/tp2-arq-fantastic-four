# Pruebas de integridad (bloque 4)

Dos escenarios que juntan los cinco del TP 1 (carrera corta, carrera larga, reintentos, métricas en un sentido y con rechazos).
Las predicciones están en [`../predicciones/integridad.md`](../predicciones/integridad.md) y se commitearon **antes** de medir.

| Escenario | Qué prueba | Archivo |
|---|---|---|
| `saldo` | Con saldo para 20 cambios y 400 pedidos, se aprueban exactamente 20 y el saldo nunca es negativo | `exchange-integridad-saldo.yaml` |
| `reintentos` | Repetir un pedido con la misma `Idempotency-Key` devuelve la misma respuesta y no opera dos veces, aunque caiga en otro nodo | `exchange-integridad-reintentos.yaml` |

`correr.mjs` hace todo: reinicia el estado, prepara el escenario, lanza Artillery, vigila el saldo cada segundo y al final
verifica las invariantes contra `/accounts` y `/log`. Solo usa HTTP. Termina con código 1 si se rompe una invariante **exacta**
(las **esperadas** solo se informan). El crudo de Artillery queda en `perf/results/<caso>/` junto con la evidencia.

## Local (ensayo de los scripts)

```bash
cd perf && npm ci && cd ..                                    # una vez
docker compose -f docker-compose.local.yml --profile dos-nodos up -d --build

node perf/integridad/correr.mjs saldo local-1-nodo
node perf/integridad/correr.mjs reintentos local-1-nodo
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
```

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
