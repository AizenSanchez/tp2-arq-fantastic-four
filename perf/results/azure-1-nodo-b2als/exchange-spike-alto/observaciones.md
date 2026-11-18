# Observaciones: E7 alto, pico de 6B (720 pedidos/s), 1 nodo B2als_v2

- **Corrida:** 18/11, de 02:57:23 a 03:01:04 UTC (el pico, de 02:58:39 a 02:58:59), desde la generadora por cable,
  con `perf/tacticas-nginx/correr.sh`, la infraestructura recreada y reset antes.
- **Predicción:** `perf/predicciones/tacticas-nginx.md`, sección 5 (e0ab4d3), con el criterio del limitador escrito
  antes de correr.

## Resultado

| Fase (pedidos/s × s) | Pedidos | 200 | 403 | 503 | Sin respuesta | 2xx: mediana / p95 (ms) |
|---|---|---|---|---|---|---|
| 24 × 60 | 1.577 | 874 | 456 | 86 | 0 | 1.153 / 1.353 |
| 720 × 20 | 14.260 | 7.490 | 3.926 | 764 | 4 | 2.060 / 3.262 |
| 24 × 120 | 2.883 | 3.158 | 1.615 | 309 | 38 | 1.153 / 1.380 |

`tabla-fases.py` asigna cada ventana de 10 s a la fase de su punto medio, así que las respuestas del pico que llegan
tarde caen en la fase siguiente. Por ventana, el p95 de los 200 es de 1.300 a 1.380 ms antes del pico, 2.187 y 3.262
en el pico, 5.827 en la ventana que sigue y vuelve a 1.300 en la próxima. En total 18.720 pedidos, 18.678 respuestas,
42 timeouts del cliente (10 s), 0 429. La generadora creó los 14.400 usuarios del pico sin avisar CPU alta.

## Qué limitó

- **El proceso.** En el pico usa de 77 a 125 % (user de 59 a 100; la muestra baja es de un intervalo de 3 s): el hilo
  de JS está saturado y libuv y el GC ocupan parte del segundo vCPU. Atendió entre 570 y 650 respuestas por segundo,
  dentro del techo estimado, y vuelve al 5 a 15 % 4 s después del pico.
- **La cola de `listen` del kernel.** Node acepta conexiones nuevas solo cuando el event loop se libera; mientras
  tanto esperan en la cola del socket, con el backlog por defecto de 511. Se llenó y el kernel descartó los
  handshakes que seguían: `TcpExtListenOverflows` = 17.788 y `TCPSynRetrans` = 2.329, contra 0 en la capacidad. El
  `nstat` de la misma VM leído después con 2 nodos (`azure-2-nodos-b2als/*/nodo-0/kernel.txt`) suma
  `SyncookiesSent` = 503 y `SyncookiesRecv` = 1.716, que solo pueden venir de este pico: con `tcp_max_syn_backlog` =
  256 también se desbordó la cola de SYN. Es lo que vimos en la clase del 27/08 (03:24 a 03:26): la cola del socket
  aceptador tiene un tamaño fijo del sistema operativo y cuando se llena se rechazan conexiones. El cliente reintenta
  el SYN a 1, 3 y 7 s: de ahí el escalón de la latencia y los timeouts.
- **Dentro de la app no se degrada nada.** `POST.exchange` p95 de 1.153 ms antes, 1.195 a 1.218 en el pico y 1.125
  después. `arca.ms` p95 de 490 a 545, 0 timeouts a ARCA; los 503 son la falla inyectada (`http_5xx`), en la misma
  proporción que fuera del pico.
- No limitaron conntrack (16.241 de 65.536), Redis ni ARCA (140 milicores en el minuto del pico).

## Predicho contra medido

| Métrica | Predicción | Medido | |
|---|---|---|---|
| CPU del proceso en el pico | 95 a 100 % de un núcleo | 77 a 125 % (107 en promedio) | ✓ saturado |
| Cola al final del pico | 2 a 9 s de trabajo | el proceso sigue saturado unos 4 s | ✓ en duración, por otro mecanismo |
| p95 de los 200 en el pico | ≥ 2,7 s | 3.262 ms en la fase, 5.827 en la ventana siguiente | ✓ |
| 503 por `timeout` de ARCA | 20 a 60 % del pico | 0 timeouts; 503 en el 6,3 %, todos de la falla inyectada | ✗ |
| 200 en el pico | bajan a 25 a 50 % | 61,5 % | ✗ |
| Timeouts del cliente (10 s) | 0 a 1 % del pico | 42, el 0,29 % | ✓ |
| CPU de la VM | 60 a 75 % | 76 % (Datadog, 53,5 user y 23,0 system) | ✗ por 1 punto |
| Créditos de CPU | bajan menos de 2 | de 70,5 a 71,6 | ✓ |
| Conntrack máximo | 15.000 a 22.000, sin `table full` | 16.241, sin `table full` | ✓ |
| Recuperación | 10 a 20 s | la ventana que sigue al pico sale mal y la próxima ya está en el rango de antes | ✓ |
| Generadora | 14.400 usuarios en el pico, sin aviso de CPU | 14.400, sin aviso | ✓ |

**El mecanismo.** La predicción ponía la cola en el event loop: la app acepta todo, se atrasa y vencen los timers de
1 s de ARCA. No pasó eso: la cola quedó en el `listen` del kernel y lo que no entraba se descartaba en el handshake.
Los pedidos que llegaban a la app se atendían casi a tiempo; la demora la pagó el cliente, reintentando el SYN. De ahí
también que los 200 no bajaran.

## Qué se lee

Con 1 nodo el criterio del limitador se dispara por la latencia (2,4 × en el pico), no por los 503. Qué hacer con eso
está en [`resultados-tacticas-nginx.md`](../../resultados-tacticas-nginx.md).
