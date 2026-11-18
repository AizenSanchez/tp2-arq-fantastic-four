# Pruebas de disponibilidad (bloque 3)

Una sola corrida que junta los escenarios de fallas del TP 1. La carga es constante y las fallas se inyectan en el
nodo a tiempos fijos. Las predicciones están en [`../predicciones/disponibilidad.md`](../predicciones/disponibilidad.md)
y se commitean **antes** de medir.

| Segundo | Qué pasa | Escenario del TP 1 | Qué prueba |
|---|---|---|---|
| 30–40 | El 12,5 % de los pedidos lleva un DNI inválido o la moneda `XYZ` | E9 | La validación responde 400 sin llamar a ARCA y sin tumbar nada |
| 60 | `kill -9` al proceso de la app | E3 | pm2 lo relanza; cuántos pedidos se pierden |
| 120 → 150 | `pm2 stop app` y `pm2 start app` a los 30 s | E4 | Apagado ordenado (o no) y caída larga |
| 210 → 240 | `kill -STOP` y `kill -CONT` a los 30 s | E18 | Proceso colgado con el socket abierto: el probe TCP del balanceador lo sigue viendo vivo |
| todo | `GET /health` cada 1 s contra el balanceador | E14 | Qué ve un monitor de salud externo |

E17 (Redis detenido) no se corre: Azure Managed Redis no se puede detener, y cortar la red a mano no sería reproducible.

## Uso

```bash
cd perf && npm ci && cd ..                                         # una vez

# ensayo de los scripts contra docker-compose.local.yml (las fallas se aproximan con docker: no es evidencia)
docker compose -f docker-compose.local.yml up -d --build
RATE=5 DURACION=270 node perf/disponibilidad/correr.mjs prueba-local-disponibilidad

# Azure (con la predicción del caso ya pusheada)
read -s DATADOG_API_KEY; export DATADOG_API_KEY                   # nunca en un archivo
export CONEXION=cable                                              # o wifi, queda en meta.txt
DURACION=200 node perf/disponibilidad/correr.mjs 1-nodo --env azure   # E9, E3 y E4 (sin E18: ver predicciones)
node perf/disponibilidad/correr.mjs escalado --env azure              # 2 nodos, línea completa; rompe solo vmss[0] (NODO=...)
```

Variables: `RATE` (pedidos/s, 20), `DURACION` (s, 300), `NODO` (patrón de Ansible, `vmss[0]`), `SIN_FALLAS=1`,
`DATADOG_API_HOST` (por defecto `us5.datadoghq.com`, el sitio de `ansible/vmss_setup.yml`).

Si la corrida se corta con Ctrl+C, el script manda `kill -CONT` y `pm2 start` para no dejar el nodo congelado o detenido.

## Qué queda en `perf/results/<caso>/`

- `exchange-disponibilidad.json`: el reporte crudo de Artillery.
- `exchange-disponibilidad/pedidos.jsonl`: una línea cuando sale cada pedido y otra cuando vuelve (sin la segunda, se perdió).
- `.../base.json`: 30 `GET /` sin carga antes de empezar, con conexión nueva (la latencia de red de base).
- `.../salud.jsonl`: el monitor de `/health`.
- `.../fallas.jsonl`: cada falla con la hora del nodo y la salida del comando.
- `.../terraform-state-list.txt`, `terraform-output.txt` y `vmss-list-instances.txt` (solo Azure): la infraestructura desplegada al empezar.
- `.../pm2-antes.json`, `pm2-despues.json` y `pm2-log-arranques.txt` (solo Azure): reinicios y las líneas de arranque y apagado.
- `.../azure-monitor/` (solo Azure): estado del probe del balanceador por nodo y minuto, y qué IP es cada nodo. Lo baja `exportar-probe.mjs` 3 min después de terminar (`ESPERA_MONITOR_S`), sin ids ni suscripción.
- `.../meta.txt`: inicio y fin UTC, commit, `git status`, versiones, máquina y conexión.
- `.../resumen.md` y `resumen.json`: los genera `analizar.mjs` solo a partir de los archivos anteriores.

## Datadog

Después de cada corrida en Azure se bajan las series y los gráficos de Datadog y se comparan con los crudos (hace falta
además una Application key):

```bash
DATADOG_API_KEY=... DD_APP_KEY=... node perf/capacidad/capturar-datadog.mjs <caso> disponibilidad
DATADOG_API_KEY=... DD_APP_KEY=... node perf/disponibilidad/verificar-datadog.mjs perf/results/<caso>
```

Quedan en `perf/results/<caso>/exchange-disponibilidad/datadog/`: `series.json`, un PNG por gráfico y `verificacion.md`
(códigos y errores de Artillery y `POST /exchange` por nodo, Datadog contra los crudos).

Los eventos que publica `correr.mjs` en cada falla usan la API v1, que la organización no tiene habilitada (HTTP 403):
la hora de cada falla está en `fallas.jsonl`.
