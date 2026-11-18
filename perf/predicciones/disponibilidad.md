# Predicciones del bloque 3: disponibilidad y fallas

> Reglas del enunciado y del plan del grupo:
> - Cada predicción se commitea y pushea **antes** de correr la prueba que contrasta.
> - Una vez commiteada no se edita: si hay que corregir, se agrega una nota al pie con fecha.
> - Los resultados van en `perf/results/<caso>/exchange-disponibilidad/` y en otro commit.

## Qué se prueba

Una corrida a **20 pedidos/s** constantes (`perf/disponibilidad/`) con fallas inyectadas en el nodo:

| Segundo | Falla | Escenario del TP 1 |
|---|---|---|
| 30–40 | 12,5 % de pedidos inválidos (DNI `123` o moneda `XYZ`) | E9 |
| 60 | `kill -9` al proceso | E3 |
| 120 → 150 | `pm2 stop app` → `pm2 start app` | E4 |
| 210 → 240 | `kill -STOP` → `kill -CONT` | E18 |
| todo | `GET /health` cada 1 s | E14 |

RTT es la ida y vuelta por internet hasta Azure, medida aparte con `GET /`.

**1 nodo** se corre con `DURACION=200`: E9, E3 y E4, con 50 s de margen después del `pm2 start`. E18 (proceso congelado) no se corre con 1 nodo: sin otro nodo al que mandar el tráfico, solo mostraría 30 s sin respuesta. En el TP 1 existió solo con 2 réplicas y nginx (Anexo B.18), así que se predice y se corre en el caso **escalado** (300 s, línea de tiempo completa).

---

## Caso 1 nodo

### E9 — pedidos inválidos

| Qué | Predicción |
|---|---|
| Inválidos enviados | 25 (20 pedidos/s × 10 s × 12,5 %) |
| Código de respuesta (DNI inválido y moneda XYZ) | 400 |
| Latencia de un 400 | ≈ la de un `GET /` (RTT), unos 370 ms menos que un 403 |
| 5xx propios o pedidos sin respuesta en la ventana | 0 |

**Razonamiento.** 400 es el código de pedido mal formado. La validación (`validateBody`) va antes de `checkArca` en la ruta, así que un 400 no espera a ARCA (~370 ms) y tarda como un `GET /`. No hay motivo para un error del servidor.

### E3 — `kill -9` a los 60 s

| Qué | Predicción |
|---|---|
| Tiempo hasta que la app vuelve | 7 s |
| Pedidos perdidos | 160: ~20 en curso al morir + 140 que llegan durante los 7 s caído |
| Cómo los ve el cliente | timeout |
| Segundos sin 200 en el monitor de `/health` | al menos 7 |

**Razonamiento.** En el TP 1, con reinicio automático y 1 réplica, el tiempo de recuperación fue de 3 a 10 s; se toma 7. A 20 pedidos/s y con un 200 que dura ~1 s, hay ~20 pedidos adentro del proceso al morir; mientras está caído llegan 20 × 7 = 140. El balanceador espera a la app, así que el cliente ve timeouts. Mientras la app no está, `/health` no puede responder.

### E4 — `pm2 stop` a los 120 s y `pm2 start` a los 150 s

| Qué | Predicción |
|---|---|
| Tiempo hasta que vuelve a atender, desde el `pm2 start` | 7 s |
| Pedidos perdidos | ≈ 760: ~20 en curso al detenerla + 600 durante los 30 s detenida + 140 durante los 7 s de arranque |
| Cómo los ve el cliente | timeout |

**Razonamiento.** Es el mismo mecanismo que el `kill -9`, con 30 s de caída en lugar de 0 antes del reinicio. Se usan los mismos 7 s de arranque y la misma tasa de 20 pedidos/s.

---

## Caso escalado (2 nodos)

Se corre la línea de tiempo completa (300 s) y las fallas se inyectan solo en `vmss[0]`; el otro nodo sigue sano. E9 se repite como control, sin predicción nueva.

| Falla | Pedidos perdidos |
|---|---|
| E3 — `kill -9` a los 60 s | 0 |
| E4 — `pm2 stop` a los 120 s y `pm2 start` a los 150 s | 0 |
| E18 — `kill -STOP` a los 210 s y `kill -CONT` a los 240 s | 0 (el probe saca el nodo del pool) |

**Razonamiento.** Con un segundo nodo sano detrás del balanceador, los pedidos que no puede atender el nodo con la falla se redirigen al otro.
