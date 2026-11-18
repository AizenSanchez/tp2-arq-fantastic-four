# Resultados del bloque 4 (integridad) en Azure, con 1 y con 2 nodos

Predicciones: [`../predicciones/integridad.md`](../predicciones/integridad.md), commiteadas **antes** de estas corridas (commits `d868f13`, `574ced2` y `7278141`, que estaban en el remoto cuando se midió). Resultados locales previos: [`resultados-integridad-local.md`](resultados-integridad-local.md).

## 1. Cómo se midió

| | |
|---|---|
| Cuenta y región | Cuenta gratuita de Azure (crédito de prueba), `eastus2` |
| Nodos de la app | VM Scale Set de `Standard_F1als_v7` (1 vCPU, no burstable), 1 y 2 instancias. **No se usó `Standard_B1s`, la del repo: no está disponible en `eastus2` para esta suscripción** (`az vm list-skus` no la devuelve) |
| Balanceador | Azure Load Balancer Standard, regla en modo `Default` (hash de 5 elementos), probe TCP al puerto 3000 cada 15 s con 2 intentos |
| Redis | Azure Managed Redis `Balanced_B0`, sin alta disponibilidad, `NoCluster`, `VolatileTTL` |
| ARCA | Contenedor de la cátedra en Azure Container Instances, 0,5 vCPU y 0,5 GB |
| Generador de carga | Una notebook en Buenos Aires, por **wifi** (interfaz `wlo1`), fuera de Azure |
| Código | Commit `1c8ded6` para 1 nodo, `1ca79d0` para 2 nodos y `5bbe966` para la repetición de `duplicados`; en `meta.txt` de cada corrida, con el `git status` (solo figura la evidencia que la propia corrida genera y, en 2 nodos, un `tfplan2` ya borrado) |
| Reinicio | `ansible/reset.sh` antes de cada corrida; se corrió un escenario por vez |
| Métricas | Datadog (`us5`, dashboard "TP2 arVault", JSON en `perf/datadog/tp2-arvault.json`) y Azure Monitor para Redis y ARCA |

Casos (carpeta de `perf/results/`): `azure-1-nodo`, `azure-1-nodo-repeticion`, `azure-2-nodos` y `azure-2-nodos-repeticion`. Cada escenario guarda su reporte crudo, una línea por pedido, el RTT, la infraestructura (`evidencia/<caso>/`), las métricas de Azure Monitor y capturas de Datadog con el rango exacto de la corrida (`datadog/LEEME.txt` en cada carpeta).

## 2. Resumen

| Caso | Escenario | Comprobaciones exactas | Valores esperados fuera de rango | Observación |
|---|---|---|---|---|
| 1 nodo | saldo | 11 de 11 | 1 (mediana de un 422) | 20 aprobados, USD final 0 |
| 1 nodo | reintentos | **9 de 12** | 0 | 1 pedido perdido por el cliente |
| 1 nodo (repetición) | reintentos | 12 de 12 | 0 | 192 de 192 reintentos idénticos |
| 1 nodo | saldo-carga | 11 de 11 | 0 | 3.100 pedidos, 20 aprobados |
| 1 nodo | duplicados | 12 de 12 | 1 (mediana del 409) | 409 en 100 de 100 pares |
| 2 nodos | saldo | 11 de 11 | 0 | 20 aprobados, USD final 0 |
| 2 nodos | reintentos | 11 de 11 | 1 (cruces entre nodos) | 189 de 189 reintentos idénticos; 78 de 200 cruzaron de nodo |
| 2 nodos | saldo-carga | 11 de 11 | 0 | 3.100 pedidos, 20 aprobados |
| 2 nodos | duplicados | **7 de 12** | 1 (mediana del 409) | 1 respuesta perdida; los dos pedidos de cada par siempre en el mismo nodo |
| 2 nodos (repetición) | duplicados | 11 de 12 | 0 | 42 de 100 pares en nodos distintos |

**Lo principal:** todas las propiedades de integridad del servidor se cumplieron con 1 y con 2 nodos. Aprobados exactamente 20 con saldo para 20 (también con 3.100 pedidos y 100 por segundo), saldo de USD final 0 y nunca negativo, una entrada de log por pedido, y ningún reintento con una respuesta distinta de la guardada. Las comprobaciones exactas que fallaron se explican, una por una, por pedidos perdidos por el cliente o por defectos de mi propia verificación (sección 4); en ninguna se encontró una inconsistencia del servidor.

## 3. Idempotencia y saldo entre nodos (lo que justifica sacar el estado de la memoria)

- **Reintentos entre nodos.** Con 2 nodos, de 200 pares, 78 tuvieron su segundo pedido en un nodo distinto del primero. De los 73 con respuesta guardada (primer pedido 200 o 403), los 73 devolvieron **la misma respuesta y el mismo `id`**. La mediana de ese segundo pedido fue 294 ms cuando cruzó de nodo y 292 ms cuando no: el nodo no cambia el costo, porque la respuesta guardada está en Redis. (`azure-2-nodos/exchange-integridad-reintentos/`)
- **Pedidos simultáneos entre nodos.** En la repetición de `duplicados` con 2 nodos, 42 de 100 pares tuvieron sus dos pedidos en nodos distintos, y en 98 de 100 pares exactamente uno recibió 409. El tercer pedido repitió la respuesta del ganador en los 96 pares con respuesta guardada. (`azure-2-nodos-repeticion/`)
- **Saldo.** Con 2 nodos compitiendo por el mismo saldo (3.100 pedidos, los nodos recibieron 1.628 y 1.472), se aprobaron exactamente 20 y el saldo de USD terminó en 0, igual que con 1 nodo. No hubo un solo aprobado de más. (`azure-2-nodos/exchange-integridad-saldo-carga/`)

## 4. Diferencias con la predicción y su causa

### 4.1 Corrida de `reintentos` con 1 nodo: un pedido perdido (3 comprobaciones exactas rotas)
Un pedido terminó con `ERR_SOCKET_TIMEOUT` en el cliente (399 de 400 respuestas). Verificado: fue el segundo intento (una repetición, que no llama a ARCA) de un usuario cuyo primer pedido había recibido un 403; el log de transacciones tiene exactamente las entradas esperadas (212 de 212); y de 3.861 validaciones de ARCA que registró la app ninguna pasó de 2 s. **No verificado:** la causa del pedido perdido; parece un corte puntual de red del lado del cliente (wifi), pero sin captura de paquetes no se puede afirmar. La corrida se conserva y se repitió: `azure-1-nodo-repeticion` cumple las 12 comprobaciones.

### 4.2 Mediana de un 422 en `saldo` con 1 nodo: 685 ms contra 714 a 874 predichos
El RTT que se mide al inicio de cada corrida (conexión nueva, mediana) varió entre corridas de 285 a 409 ms (wifi) y en esta fue 409 ms, pero el valor implícito durante la corrida fue ≈ 300 ms (685 − 385). Evidencia: en la corrida de `reintentos` del mismo caso, la mediana de un reintento guardado (que solo cuesta red) fue 292 ms. El rango de ± 80 ms de mi predicción es menor que la variación del RTT entre corridas.

### 4.3 Mediana del 409 en `duplicados`: 145 ms contra ≈ 409 a 469 predichos (1 nodo y 2 nodos, primera corrida)
Causa verificada: mi lanzador propio usaba `fetch`, que reutiliza conexiones, así que cada pedido costó una sola ida y vuelta (RTT con conexión reutilizada medido: 144 a 204 ms), mientras que mi predicción sumó el RTT de conexión **nueva** (≈ 2 idas y vueltas). El tercer pedido, que repite una respuesta guardada, dio 144 ms, igual que el 409. Después de cambiar el lanzador para abrir una conexión por pedido, la repetición con 2 nodos dio **298 ms**, dentro del rango. Es un error de mi predicción (qué RTT sumar), no del servidor.

### 4.4 Reintentos que cruzan de nodo: 78 contra 86 a 114 predichos
La predicción suponía que el balanceador repartiría los pedidos 50/50 (y entonces cruza el 50%). El reparto real en esa corrida fue 68/32 (272 y 128 pedidos): con ese reparto la probabilidad de cruzar es 2 · 0,32 · 0,68 ≈ 43%, o sea ≈ 87 pares, con un desvío de ≈ 7. Los 78 observados están en el borde de ese ruido. El mecanismo (reintento que llega a otro nodo y devuelve lo guardado) funcionó en el 100% de los casos.

### 4.5 `duplicados` con 2 nodos (primera corrida): 5 comprobaciones exactas rotas
- **Una respuesta perdida** (error del lanzador, sin tipo anotado porque lo descartaba). El pedido perdido fue el primero de un par, el que "gana": los otros dos pedidos del par recibieron 409, porque el servidor seguía procesándolo, y el servidor sí lo registró: hay una entrada aprobada en el log que el cliente nunca vio. Las otras 7 entradas no vistas son 503, que no devuelven `id`. Saldos y log son consistentes.
- **El lanzador no probaba lo que debía:** los dos pedidos de cada par cayeron siempre en el mismo nodo (0 de 100), porque `fetch` reutiliza conexiones. Se corrigió (commit `5bbe966`: una conexión por pedido, y cada error queda en `errores.jsonl`) y se repitió.

### 4.6 `duplicados` con 2 nodos (repetición): 1 comprobación exacta rota por una suposición incorrecta
La comprobación daba por ganador al pedido que *salió* primero y exigía que el otro devolviera lo mismo. En 2 pares un pedido recibió 200 y el otro 503, y el tercer pedido devolvió el 200 guardado. Eso no contradice al servidor: un 503 de ARCA **libera la clave** a propósito, así que otro pedido con la misma clave puede correr después y aprobarse (y con conexiones distintas el orden de llegada no es el de salida). No puedo determinar el orden de llegada con los datos del cliente. La invariante correcta es que dos respuestas guardadas (200 o 403) nunca difieran; se corrigió en `016d914`. El resultado generado no se modificó.

### 4.7 CPU de los nodos: predicción incumplida con 1 nodo
Predije menos de 15% con 100 pedidos por segundo. Con 1 nodo, el panel de Datadog muestra en el pico **17,67% de usuario y 5,55% de sistema (≈ 23% en total)**; con 2 nodos, **≈ 7,85% y 2,36% en cada uno (≈ 10%)**, es decir, la carga por nodo se reparte a la mitad. Causa probable: mi estimación (1,2 ms de CPU por pedido, tomada del TP 1 y escalada para una B1s) fue baja; el valor observado equivale a ≈ 2,3 ms por pedido, incluido el agente de Datadog, en una `F1als_v7`. Los valores salen de lo que marca el panel (`datadog/04-cpu-nodos.jpg`), no de una serie exportada. **No se midió la CPU del escenario de 10 pedidos por segundo.**

## 5. Componentes compartidos (Azure Monitor)

| Métrica (máximo por minuto) | Corridas de poco tráfico (400 pedidos o menos) | Con 3.100 pedidos (1 nodo / 2 nodos) |
|---|---|---|
| CPU de Redis (`percentProcessorTime`) | 19% a 32% | 19% / 30% |
| CPU de ARCA (`CpuUsage`, milicores de 500) | 2 a 11 | 22 / 25 |

ARCA usó ≈ 5% de su 0,5 vCPU a 100 pedidos por segundo: no es un cuello de botella de CPU a esta carga, lo que apoya la hipótesis de que su demora es una espera simulada (el catálogo suponía lo contrario a cargas mucho mayores, que acá no se probaron). La CPU de Redis estuvo entre 19% y 32% en todas las corridas, **también en las de casi nada de tráfico** (con 2 nodos, 27% a 32% incluso en `duplicados`, de 300 pedidos): no se puede atribuir a la carga, y en ningún caso se acercó a un límite. La métrica `operationsPerSecond` dio valores que no pude reconciliar con el tráfico (por ejemplo 1.359 en una corrida de 300 pedidos): **no la uso**.

## 6. Mezcla de respuestas de ARCA

En `saldo-carga` (3.100 pedidos): 503 = 188 y 189 (6,1%), 403 = 951 y 996 (30,7% y 32,1%), con 1 y con 2 nodos. Coincide con las proporciones medidas en local (≈ 6% y ≈ 30%), no con las de las primeras predicciones. El rechazo de ARCA es **fijo por DNI** (medición local, `local-arca/medicion.txt`).

## 7. Hallazgos operativos de la nube

- **El reparto del balanceador depende de cómo el cliente abre conexiones.** Con `curl` desde la notebook (conexión nueva por pedido), entre el 98% y el 100% de los pedidos cayeron en el mismo nodo en seis pruebas; con Artillery el reparto fue real (24/76, 32/68 y 53/47); desde el jumpbox, dentro de Azure, fue 55/45 y 53/47. Mi primera interpretación ("casi todo cae en un solo nodo desde esta ubicación") era **incorrecta** para Artillery. La causa del sesgo con `curl` no está verificada (supongo el NAT del router). (`evidencia/azure-2-nodos/reparto-del-balanceador.txt`)
- **Después de `ansible/deploy.sh`, un nodo queda fuera del balanceador unos minutos:** el deploy detiene la app, instala dependencias y recién después la arranca, y el probe TCP la marca caída (salud del backend 50% durante ≈ 3 min). Hay que esperar a que vuelva a 100% antes de medir.
- **`Standard_B1s` puede no existir en la región** para una suscripción nueva; se cambió con `machine_sku` en `terraform.tfvars`, sin tocar código.
- **El plugin de Datadog de Artillery cae con una clave inválida y manda el evento de inicio siempre al sitio de EE.UU.**; con `event: send: false` en los YAML la corrida no depende de eso (ver `resultados-integridad-local.md`).

## 8. Límites de estos resultados

- Una corrida por caso (más una repetición donde hubo un pedido perdido): las diferencias menores que el azar de ARCA y de la red no se pueden separar del ruido.
- Un solo generador, por wifi desde Buenos Aires. El RTT con conexión nueva varió de 285 a 409 ms entre corridas; las comparaciones de latencia lo incluyen.
- La CPU de los nodos sale de lo que marcan los paneles de Datadog, y solo para `saldo-carga`.
- No se probó nada de rendimiento máximo ni de caídas (bloques 1 y 3), ni el comportamiento de Redis lleno.
- Las capturas 01 de `saldo` y `reintentos` con 2 nodos quedaron en media resolución.
