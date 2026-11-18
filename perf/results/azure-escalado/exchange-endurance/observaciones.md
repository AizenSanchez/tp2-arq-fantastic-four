Anotadas el 2026-11-18, después de la corrida. Fuentes: `datadog/series.json` y `azure-monitor/`.

1. **Endurance a 80 pedidos/s (0,5 · B) durante 10 min:** 0 errores, reparto 49,6 / 50,4 % y pendiente del p95 de los
   200 de −0,7 ms/min. Memoria de cada nodo (`system.mem.used`) desde el minuto 1 hasta el final: +1,4 % y +0,7 %.
2. **Tramo a 160 pedidos/s (B) durante 3 min:** p95 de los 200 de 1.513 ms y 0,6 % de timeouts (por debajo del 1 % del
   criterio). Son los únicos errores de la corrida: a 160 la red de la generadora ya está cerca de su límite (ver
   `../exchange-capacidad/observaciones.md`).
3. **Redis (`usedmemory`):** de 3,4 a 37,7 MiB en 76.800 pedidos, ≈ 0,46 KiB por pedido, lineal. Hizo ≈ 1.165 ops/s
   a 80 pedidos/s y ≈ 2.330 a 160: ≈ 14,6 por pedido, igual que con 1 nodo.
4. **ARCA (`CpuUsage`):** ≈ 25 milicores a 80 pedidos/s y ≈ 50 a 160, ≈ 0,31 milicores por pedido/s.
5. Las marcas de tiempo de Azure Monitor van ≈ 2 min corridas respecto de `meta.txt` y Datadog.
