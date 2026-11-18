# Predicción de la táctica: probe HTTP del balanceador

> Se commitea y pushea **antes** de aplicar la táctica y de medirla. No se edita después: las correcciones van como nota
> al pie con fecha. Los resultados van en `perf/results/` y en otro commit.

## Qué cambia

| | Línea base | Táctica |
|---|---|---|
| Probe del balanceador (`node.tf`) | TCP al puerto 3000 cada 15 s (`number_of_probes = 2`, `probe_threshold = 1`) | **HTTP `GET /` al puerto 3000 cada 5 s** (`probe_threshold = 1`) |
| Qué tiene que pasar para que el nodo esté sano | que el sistema operativo acepte la conexión TCP | que la app **responda 200** a `GET /` |

`GET /` responde "Server is up." sin tocar Redis ni ARCA: un nodo que no puede hablar con Redis sigue en el pool.

## Cómo se mide

La misma corrida de la línea base (`perf/disponibilidad/`, 300 s a 20 pedidos/s, con 2 nodos y las fallas solo en
`tp2vmss000000`), en el mismo despliegue (`gunegfcioh`), con el caso `azure-tactica-probe`. La línea base es
`perf/results/azure-escalado/` (18/11), comparada en `perf/results/resultados-disponibilidad-escalado.md`. E9 se repite
como control, sin predicción. El monitor de `/health` (E14) no tiene línea base válida: en esa corrida quedó pegado al
nodo sano.

## Predicción

| Falla | Línea base (pedidos perdidos) | Táctica (pedidos perdidos) |
|---|---|---|
| E3 — `kill -9` | 21 | **21** |
| E4 — `pm2 stop` 30 s → `pm2 start` | 320 | **61** |
| E18 — `kill -STOP` 30 s → `kill -CONT` | 125 | **≈ 55** |

**Razonamiento.**

- **`kill -9`:** el nodo vuelve en ~1 s y el probe, aunque ahora consulte cada 5 s, no llega a enterarse de que estaba
  caído. Se pierde lo mismo que en la línea base.
- **`pm2 stop`:** en la línea base se perdieron 320 pedidos en ~26 s, hasta que el probe marcó el nodo caído, o sea
  unos 12 por segundo. Con un probe cada 5 s, en el peor de los casos se pierden 5 s de ese tráfico: 320 / 26 × 5 ≈ 61.
- **`kill -STOP`:** mejora porque el probe ahora es HTTP: con el proceso congelado la app no responde a `GET /`, el probe
  falla y el balanceador saca al nodo, en lugar de seguir encolándole conexiones que terminaban en timeout. Antes de que
  lo saque se pierde, como en el `pm2 stop`, a lo sumo 5 s de tráfico (≈ 61 en el peor caso): se estiman ≈ 55.
