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

## Azure (cada uno en su propia cuenta)

Prerrequisitos y orden completo: ver `perf/integridad/SETUP-AZURE.md`.

Con la infra desplegada (`terraform apply` y `ansible/setup.sh` + `ansible/deploy.sh`), y **un escenario a la vez** (cambian la tasa y el saldo de USD, que son estado compartido):

```bash
read -s DATADOG_API_KEY; export DATADOG_API_KEY     # nunca en un archivo
export DATADOG_API_HOST=us5.datadoghq.com           # el sitio de TU cuenta de Datadog (por defecto us5, como ansible/vmss_setup.yml)
export CONEXION=cable                               # o wifi (queda en meta.txt)
# el reinicio es ansible/reset.sh y el target sale de node/lb_dns; ambos los resuelve correr.mjs
node perf/integridad/correr.mjs saldo azure-1-nodo --env azure
node perf/integridad/correr.mjs reintentos azure-1-nodo --env azure
node perf/integridad/correr.mjs saldo-carga azure-1-nodo --env azure      # opcional
node perf/integridad/correr.mjs duplicados azure-1-nodo --env azure      # opcional
# escalar a 2 nodos (terraform apply -var node_instances=2, ansible/setup.sh, ansible/deploy.sh) y repetir con azure-2-nodos
```

Con `--env azure`, antes de cargar `correr.mjs` mide el RTT de base (`rtt.json`, y lo usa como `RTT_MS` si no se pasa uno) y guarda
`terraform state list`, `terraform output` y `az vmss list-instances` en `evidencia/<caso>/`. Al terminar exporta las métricas de
Redis y de ARCA de Azure Monitor a `azure-monitor/` (espera 3 minutos a que Azure las publique; `AZURE_MONITOR_ESPERA_S=saltear` evita todo el paso).

**Antes de la corrida oficial, con la clave real, una prueba corta** (por ejemplo `reintentos` con un caso `prueba-seca`, que no se commitea) y mirar que las
métricas lleguen al dashboard. Y **no dejar `DEBUG=plugin:publish-metrics:datadog-statsd` prendido** (lo exporta `perf/run.sh`): imprime la clave en claro.

## Qué queda en `perf/results/<caso>/`

- `exchange-integridad-<escenario>.json`: reporte crudo de Artillery.
- `exchange-integridad-<escenario>/pedidos.jsonl`: una línea por pedido (estado, id, nodo, latencia).
- `.../saldos.jsonl`: saldo de USD y ARS cada segundo.
- `.../antes.json` y `despues.json`: cuentas y entradas nuevas del log.
- `.../informe.json`: cada comprobación, exacta o esperada, con su resultado.
- `.../rtt.json`: las 20 + 20 muestras de `GET /` (conexión reutilizada y nueva) con su mediana y P95.
- `.../azure-monitor/` (solo Azure): Redis y ARCA de Azure Monitor, para ver que no se saturan.
- `.../meta.txt`: inicio y fin UTC, commit, `git status`, versiones, máquina, tipo de conexión, RTT y, en Azure, las salidas de `terraform output`.

## Diferencias de local con Azure (importan al comparar)

- En local el reparto entre nodos lo hace el script (al azar por conexión); en Azure lo hace el balanceador L4 (hash de la conexión).
- En local no hay latencia de red: `RTT_MS` queda en 0 (el RTT se mide igual y queda en `rtt.json`).
- Redis local no tiene TLS ni red de por medio; el de Azure sí.
