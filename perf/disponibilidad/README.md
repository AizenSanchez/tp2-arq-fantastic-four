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
- `.../salud.jsonl`: el monitor de `/health`.
- `.../fallas.jsonl`: cada falla con la hora del nodo y la salida del comando.
- `.../pm2-antes.json`, `pm2-despues.json` y `pm2-log-arranques.txt` (solo Azure): reinicios, `kill_timeout` y las líneas de arranque y apagado.
- `.../meta.txt`: inicio y fin UTC, commit, `git status`, versiones, máquina y conexión.
- `.../resumen.md` y `resumen.json`: los genera `analizar.mjs` solo a partir de los archivos anteriores.

## Dashboard de Datadog

`perf/datadog/dashboard-disponibilidad.json` se crea o actualiza por API, sin tocar la web:

```bash
read -s DD_API_KEY; export DD_API_KEY
read -s DD_APP_KEY; export DD_APP_KEY      # Organization Settings -> Application Keys
node perf/datadog/crear-dashboard.mjs perf/datadog/dashboard-disponibilidad.json
node perf/datadog/crear-dashboard.mjs --metricas artillery.   # después de una corrida: confirma los nombres
```

Cada falla aparece como una marca vertical en los gráficos: `correr.mjs` publica un evento con la API key de Artillery.
