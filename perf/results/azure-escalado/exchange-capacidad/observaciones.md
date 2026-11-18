Anotadas el 2026-11-18, después de la corrida. Fuentes: `datadog/series.json` (cada nodo, cada ≈ 15 s),
`azure-monitor/` (grano 1 min) y `pedidos.jsonl`. No cambian B: B = 160 pedidos/s según el criterio commiteado.

1. **Los nodos no fueron el límite.** La CPU de cada nodo (user + system) fue de ≈ 7–8 % a 120 pedidos/s, ≈ 10–11 % a
   160, ≈ 12 % a 200 y ≈ 13 % a 240. El reparto fue 50/50 en todos los escalones (de 47/53 a 51/49). En el escalón de
   320 los dos nodos bajan a ≈ 3 % de CPU.
2. **Los pedidos que vencen no llegan a Azure.** `SYNCount` entrante del balanceador (`azure-monitor/lb-trafico.json`,
   promedio por segundo en cada minuto; Azure Monitor va ≈ 2 min corrido respecto de la carga) fue ≈ 10, 20, 41, 80,
   121, 160 y 195 SYN/s en los escalones de 10 a 200: una conexión por pedido, como se ofrecía. En el escalón de 240
   llegaron **≈ 142 SYN/s** de 240 ofrecidos, y en el de 320, **≈ 0**. Los bytes recibidos por cada nodo (Datadog)
   muestran lo mismo: ≈ 180 KB/s en 200 y en 240, y ≈ 56 KB/s en 320. El probe del balanceador marcó los dos nodos al
   100 % todo el tiempo (`lb-probe.json`).
3. **Los timeouts llegan en ráfagas**, con la misma firma que la pausa del caso 1 nodo. En el escalón de 200, todos
   los timeouts están en los segundos 395–399 y 408–411 (ninguno hasta el 394), con la CPU de los nodos en ≈ 12 %.
4. **Redis no fue el límite.** No hubo `Redis error`, `unhandled` ni pedidos fallidos en los logs de pm2 de los dos
   nodos, y pm2 registró 0 reinicios (consultado con Ansible antes del destroy). Redis hizo ≈ 14,6 operaciones por
   pedido, igual que con 1 nodo.
5. **Conclusión:** el cuello de botella está **antes del balanceador de Azure**, en la red de la generadora (wifi,
   router de la casa o proveedor), que deja de entregar conexiones nuevas a partir de ≈ 200 por segundo. Es la fila
   "la red de la generadora" de la tabla de hipótesis de la predicción.
6. **B: 160 contra 120 con 1 nodo.** La diferencia no viene de la CPU, que estaba sobrada en los dos casos. Con 1 nodo,
   el escalón de 160 falló por una sola pausa de ≈ 8 s (1,2 % de timeouts contra un tope de 1 %). Acá ese escalón
   salió limpio y el primero en fallar fue el de 200, por ráfagas del mismo tipo. Se lee como variación de la red
   entre corridas, no como escalado: B_escalado / B_1 nodo = 1,33, dentro de la tolerancia predicha (1,0 a 1,33).
