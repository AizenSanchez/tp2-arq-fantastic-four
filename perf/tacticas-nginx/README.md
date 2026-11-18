# Tácticas de nginx que se pierden en Azure (bloque 2)

El nginx del TP 1 tenía dos tácticas que en Azure no están: la microcaché de `GET /rates` y el `limit_req` de
`POST /exchange`. Estos escenarios miden si hace falta reponerlas, con el B del bloque 1 (120 pedidos/s). Las
predicciones están en [`../predicciones/tacticas-nginx.md`](../predicciones/tacticas-nginx.md), una sección por corrida,
cada una commiteada antes de medir. La comparación y la decisión, en
[`../results/resultados-tacticas-nginx.md`](../results/resultados-tacticas-nginx.md).

| Escenario | Carga | TP 1 | Qué mira |
|---|---|---|---|
| `exchange-lectura-tasas` | 12 pedidos/s 30 s y 120 pedidos/s 120 s, 80 % `GET /rates` y 20 % `POST /exchange` | E10 | Lo que cuesta no tener la microcaché |
| `exchange-spike` | 24 pedidos/s 60 s, pico de 2B (240) 20 s, 24 pedidos/s 120 s, solo ARS a USD | E7 | Si el pico degrada a los aceptados sin `limit_req` |
| `exchange-spike-alto` | igual, con un pico de 6B (720) | E7 alto | Lo mismo con un pico por encima del techo de un nodo (unos 570) |
| `exchange-representativa` | 12 usuarios/s 600 s, `/rates`, `/accounts` y `/exchange` por usuario | E8 | Si alguna táctica cambia algo con la carga de todos los días |
| `caracterizacion-get` y `caracterizacion-exchange` | 20 pedidos/s 60 s, un endpoint por corrida | | CPU por pedido y mezcla de ARCA, para las predicciones |

La capacidad del nodo se midió con `perf/capacidad/` del bloque 1, sin cambios.

## Uso

```bash
cd perf && npm ci                                          # una vez
export TARGET=http://$(cat ../node/lb_dns)
read -s DATADOG_API_KEY; export DATADOG_API_KEY            # nunca en un archivo
../ansible/reset.sh                                        # antes de cada corrida: borra el estado de Redis
sh tacticas-nginx/correr.sh exchange-spike-alto azure-1-nodo-b2als/exchange-spike-alto/exchange-spike-alto
python3 tacticas-nginx/tabla-fases.py results/azure-1-nodo-b2als/exchange-spike-alto/exchange-spike-alto.json \
  tacticas-nginx/exchange-spike-alto.yaml --ventanas      # pedidos, códigos y latencia por fase o por ventana de 10 s
```

En cada nodo, antes de la corrida (por SSH a través del jumpbox, como Ansible):

```bash
nohup sh muestreo-cpu.sh $(pm2 pid app) > /tmp/ticks.log 2>&1 &           # CPU del proceso cada 2 s
nohup sh conntrack-muestreo.sh 400 &                                        # conntrack cada 5 s en /tmp/conntrack.log
```

Después de la corrida, con el `inicio` y `fin` de `<corrida>.horario.txt`:

```bash
# del nodo: /tmp/ticks.log, /tmp/conntrack.log, `sudo dmesg | grep -i conntrack` y `nstat -az` (ListenOverflows,
# TCPSynRetrans, Syncookies)
perf/tacticas-nginx/exportar-azure-monitor.sh <carpeta>/azure-monitor <inicio> <fin>
DD_APP_KEY=... node perf/tacticas-nginx/capturar-datadog.mjs <carpeta> <escenario> <inicio> <fin>
DD_APP_KEY=... node perf/tacticas-nginx/datadog-reparto.mjs <inicio> <fin>        # solo con 2 nodos
```

Con 2 nodos, `DD_HOST=tp2vmss000001 DD_SALIDA=datadog-nodo-1` captura el segundo nodo.

## Qué queda en cada carpeta de corrida

- `<escenario>.json` y `.horario.txt`: el crudo de Artillery y la hora UTC de inicio y fin. El escenario es el de
  `perf/tacticas-nginx/` del mismo commit.
- `nodo/` (o `nodo-0/` y `nodo-1/`): `ticks-app.txt`, `conntrack.txt` y `kernel.txt`.
- `azure-monitor/`: Redis, ARCA y la VMSS por minuto. Las series llegan 1 a 2 min tarde y con grano de 1 min no ven
  un pico de 20 s.
- `datadog/` (o `datadog-nodo-0/` y `datadog-nodo-1/`): `series.json` y un PNG por gráfico.
- `observaciones.md`: predicho contra medido y lo que se lee.

## Cómo leer los números

- Las fases se cuentan desde el primer contador de Artillery (`firstCounterAt`), no desde `inicio`: Artillery tarda
  unos segundos en arrancar.
- Los percentiles de Artillery caen en baldes que crecen un 2 % (1.300, 1.326, 1.353, 1.380 ms): una diferencia de un
  balde es "sin cambio".
- `http.response_time.2xx` mezcla todos los endpoints del escenario. Para los POST de E10 se usa
  `/exchange` por endpoint o el timer `POST.exchange` de la app.
