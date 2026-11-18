Anotadas el 2026-11-17, después de la corrida, con `datadog/series.json` (CPU del nodo `tp2vmss000000` cada ≈ 15 s) y
`pedidos.jsonl`. **No cambian B**: B = 120 pedidos/s según el criterio commiteado en las predicciones.

1. **Pausa al final del escalón de 160 (07:43:09 UTC, segundos 351–357 de la corrida).** Los timeouts que hacen fallar
   el escalón (1,2 % contra un tope de 1 %) no están repartidos: entre los segundos 305 y 350 no hay ninguno, y entre el
   351 y el 357 hay 98. Justo antes, la latencia de los 200 salta de ≈ 1,5 s a 5–8 s. La CPU del nodo en ese momento
   está **normal**: 20–21 % (user + system) a las 07:43:00, 07:43:15 y 07:43:30, sin pico. El nodo no estaba
   saturado: **probablemente fue la red de la generadora de carga** (wifi de la casa), no el sistema.
2. **Minuto muerto en la sobrecarga (≈ 07:45:30 a 07:47:00 UTC, escalón de 320 e inicio de la bajada).** Todos los
   pedidos terminan en timeout, pero la CPU del nodo está en **0–1 %**, igual que sin carga. Redis (`operationsPerSecond`
   ≈ 1) y ARCA (`CpuUsage` = 0) tampoco reciben trabajo, y la app no se reinició: `/health` daba `uptime` 5.090 s a las
   07:54:41, o sea que arrancó a las 06:29:51. Por encima de ≈ 200 pedidos/s **el límite no fue la CPU del nodo**: el
   máximo fue ≈ 21 % a 160 pedidos/s y ≈ 27 % a 200, lejos del 78 % y 95 % predichos. Con lo medido no se puede separar
   entre dos explicaciones, y las dos dan la CPU ociosa y Redis sin operaciones:
   - el tráfico no llegó al nodo (la red de la generadora o el router de la casa, con miles de conexiones nuevas
     abiertas a la vez: hasta 320 × 10 s);
   - la app quedó esperando a Redis (si la conexión TLS a `Balanced_B0` se trabó, todos los pedidos esperan antes de
     llamar a ARCA).

   Para distinguirlas: `system.net.bytes_rcvd` del nodo o las métricas del balanceador (si no entró tráfico, es la red),
   y el log de pm2 de la app (si hay `Redis error`, es Redis).
3. Las marcas de tiempo de Azure Monitor (`azure-monitor/`, grano 1 min) parecen ir **≈ 1 min corridas** respecto de la
   carga y de Datadog. Por ejemplo, los minutos sin operaciones en Redis figuran en 07:47, y en Datadog la CPU ociosa
   empieza a las 07:45:30. Hay que tenerlo en cuenta al comparar por minuto.
