# Tácticas de nginx (bloque 2): resultados contra la predicción

Pregunta: sin la microcaché de `GET /rates` y sin el `limit_req` de `POST /exchange` del nginx del TP 1, ¿se degrada
algún QA en la lectura de tasas (E10), en un pico de cambios (E7) o en la carga representativa (E8)? Y si un pico
degrada, ¿qué táctica lo resuelve?

- **Predicciones:** `perf/predicciones/tacticas-nginx.md`, una sección por corrida, cada una commiteada antes de correr.
- **Corridas:** 18/11, nodos `Standard_B2als_v2` en northcentralus, Redis `Balanced_B0`, ARCA en Container Instances,
  generadora fuera de Azure, por cable. 1 nodo de 00:56 a 03:01 UTC (`azure-1-nodo-b2als/`), 2 nodos de 03:29
  a 03:51 (`azure-2-nodos-b2als/`). Cómo correrlas: `perf/tacticas-nginx/README.md`.
- **Infraestructura:** `evidencia/tacticas-nginx/` y `evidencia/tacticas-nginx-2-nodos/`. `curl-sin-tacticas.txt`
  muestra que ninguna respuesta trae cabeceras de caché ni 429.
- **Datadog:** tablero en `perf/datadog/tp2-arvault.json`; series y gráficos en la carpeta `datadog*/` de cada corrida.

## Resultados clave

| Nodos | Corrida | Escenario | Pedidos | Mediana / p95 (ms) | Errores | Lo que limitó o más se acercó | Carpeta |
|---|---|---|---|---|---|---|---|
| 1 | Base | GET / a 1 pedido/s | | 162 / 169 | 0 | la red hasta la generadora | `caracterizacion-b2als/` |
| 1 | Capacidad | escalones de 10 a 320 pedidos/s | 73.800 | p95 de los 200: 1.501 a 1.555 en todos | 0 | proceso al 57 % de un núcleo a 320 | `azure-1-nodo-b2als/exchange-capacidad/` |
| 1 | E10 | 120 pedidos/s, 80 % `GET /rates` | 14.760 | `/rates` 159 / 166 | 0 | conntrack 12.105 de 65.536 | `azure-1-nodo-b2als/exchange-lectura-tasas/` |
| 1 | E7 | pico de 2B (240 pedidos/s) 20 s | 9.120 | 200 en el pico 1.130 / 1.353 | 0, 0 429 | proceso al 46 % en el pico | `azure-1-nodo-b2als/exchange-spike/` |
| 1 | E8 | 12 usuarios/s, `/rates`, `/accounts` y `/exchange` | 21.600 | `/rates` 162 / 169, `/exchange` 1.023 / 1.326 | 0 | nada: proceso al 4,6 % | `azure-1-nodo-b2als/exchange-representativa/` |
| 1 | E7 alto | pico de 6B (720 pedidos/s) 20 s | 18.720 | 200 en el pico 2.060 / 3.262; 5.827 en la ventana siguiente | 42 timeouts (0,29 %) | **el proceso (77 a 125 %) y la cola de `listen` del kernel: 17.788 handshakes descartados** | `azure-1-nodo-b2als/exchange-spike-alto/` |
| 2 | E10 | igual | 14.760 | `/rates` 159 / 162 | 0 | nada: 7 y 8 % por nodo | `azure-2-nodos-b2als/exchange-lectura-tasas/` |
| 2 | E8 | igual | 21.600 | `/rates` 162 / 169, `/exchange` 1.023 / 1.326 | 0 | nada: 2,7 y 2,8 % por nodo | `azure-2-nodos-b2als/exchange-representativa/` |
| 2 | E7 alto | igual | 18.720 | 200 en el pico 1.153 / 1.353 | 0 | proceso al 74 y 72 % por nodo | `azure-2-nodos-b2als/exchange-spike-alto/` |

El p95 de `/rates` en E10 es la mediana de los p95 por ventana de 10 s; el agregado de toda la corrida da 165,7 ms con
1 y con 2 nodos. Los POST tardan más de 1 s porque cada uno espera a ARCA y paga dos viajes: el handshake de una
conexión nueva y el pedido. Con 2 nodos el Load Balancer repartió el total de pedidos entre 49,3 y 50,8 % por nodo, y
reparte por conexión: en E8 las tres rutas de una sesión caen en el mismo nodo.

**Techo de un nodo.** La CPU de la capacidad da un costo marginal de 1,70 ms por POST entre 160 y 320 pedidos/s, o sea
un techo de unos 570 pedidos/s para el proceso Node. En el pico de E7 alto el nodo contestó entre 570 y 650 por
segundo: techo observado de 570 a 650, consistente con 1,70 a 1,78 ms por POST. Vale con créditos de CPU: B2als_v2 es
burstable (línea base del 30 % de la VM) y sin créditos el nodo sostiene unos 260 pedidos/s. Todas las corridas
fueron cortas y los créditos no bajaron de 70.

## Predicho contra medido

| Nodos | Corrida | Métricas predichas | Cumplidas | Las que no, y por qué |
|---|---|---|---|---|
| 1 | Capacidad | 11 | 6 | B: se predijo 240 y dio ≥ 320; con él, el primer escalón que no cumple, la CPU del proceso y de la VM a 320 y conntrack. La predicción usó 3,5 ms por POST medidos en un solo punto a 20 pedidos/s; el costo marginal medido es 1,70 ms. La diferencia a tasa baja no la explica el costo en reposo y no la investigamos más |
| 1 | E10 | 8 | 7 | El p95 de los POST se predijo sobre `http.response_time.2xx`, que en E10 mezcla los GET: métrica mal elegida. Lo que se puede leer (`/exchange` p95 1.300 ms, `POST.exchange` en la app 1.149 ms) queda dentro |
| 1 | E7 | 8 | 7 | Conntrack: 8.377 contra 3.700 a 5.800. El factor de 0,5 a 0,8 salió de la meseta de la capacidad, que estaba limitada por los puertos de la generadora; sin el factor la cuenta da 8.640 |
| 1 | E8 | 11 | 10, Redis a medias | Procesador de Redis: 16 a 28 % contra ≤ 16 %. No sigue a la carga: con 2 nodos dio 13 a 18,5 % a 50 veces más op/s |
| 1 | E7 alto | 10 | 7 | **El mecanismo**: se predijo la cola en el event loop y 503 por `timeout` de ARCA (20 a 60 %); la cola quedó en el kernel (abajo), con 0 timeouts de ARCA. De ahí también los 200 (61,5 % contra 25 a 50 %). La CPU de la VM, por 1 punto (76 contra 60 a 75 %) |
| 2 | E10 | 7 | 6 | `GET.rates` en la app: 1,31 y 1,69 ms contra ≤ 1,2. Con 2 nodos es 0,2 a 0,6 ms mayor también en E8, a otra carga; no sabemos por qué, y está lejos del umbral de 17 ms |
| 2 | E8 | 7 | 7 | |
| 2 | E7 alto | 8 | 8 | |

Ninguna de estas diferencias cambia la decisión. La de E7 alto (la cola se formó en el kernel y no en la app) sí cambia
el argumento para descartar un limitador en la app.

**Qué pasa por encima del techo.** Node acepta conexiones nuevas solo cuando el event loop se libera; mientras tanto
esperan en la cola de `listen` del kernel, con el backlog por defecto de 511. Con el proceso saturado esa cola se llena
y el kernel descarta los handshakes que siguen (`TcpExtListenOverflows` = 17.788 con 1 nodo, 0 nuevos en todas las
demás corridas). También se desbordó la cola de SYN (`tcp_max_syn_backlog` = 256): el kernel mandó 503 SYN cookies y
recibió 1.716. Es lo que vimos en la clase del 27/08: la cola del socket aceptador tiene un tamaño fijo y cuando se
llena se rechazan conexiones. El cliente reintenta el SYN a 1, 3 y 7 s, y de ahí el escalón de la latencia y los
timeouts. Un pedido que llega a la app se atiende casi a tiempo (`POST.exchange` p95 de 1.195 a 1.218 ms en el pico,
1.153 antes).

## Decisión

**No se repone ninguna de las dos tácticas.** Para un pico que supera lo que atiende un nodo, alcanzó con tener un
segundo nodo.

| Táctica | Criterio para reponerla | Medido | |
|---|---|---|---|
| Microcaché de `GET /rates` (TP 1: P99 de 18 a 1 ms) | p95 de `GET.rates` en la app > 17 ms (10 % de la base) | 1,06 ms en E10 y 0,97 en E8 con 1 nodo; 1,2 a 1,7 con 2 | no |
| | /rates > 30 % de la CPU del proceso **y** el proceso > 70 % | unos 61 %, con el proceso al 12,2 % | no |
| | p95 de los POST en E10 > 1,1 × el de la capacidad | `/exchange` p95 1.300 ms, igual que sin GET | no |
| | Redis > 50 % | 16 % en E10; 30 % como máximo con carga en todas (36 % en un minuto ocioso) | no |
| `limit_req` de `POST /exchange` (TP 1: 21,9 % del pico rechazado con 429) | p95 de los 200 en una ventana del pico > 2 × el de la primera fase | 2B, 1 nodo: un balde (1.353 contra 1.326). 6B, 1 nodo: **2,4 ×**. 6B, 2 nodos: un balde | **se dispara con 6B y 1 nodo** |
| | 503 > 11 % | 6,3 % a 6B con 1 nodo, 5,9 % con 2 | no |
| | timeouts o errores ≥ 1 % | 0,29 % a 6B con 1 nodo, 0 con 2 | no |
| | recuperación > 30 s | 10 a 20 s con 1 nodo, 0 con 2 | no |

Los dos primeros umbrales del limitador los habíamos fijado en el plan del bloque antes de E7; los otros dos se
agregaron en la sección 5 de las predicciones. Los cuatro quedaron en el repo antes de correr E7 alto.

**La caché.** Ahorraría a lo sumo el tiempo de servidor de `/rates`: 1 ms de 166 en el p95, menos del 1 %. En el TP 1
el proceso atendía 800 pedidos/s en la notebook y el tiempo de servidor pesaba; acá casi toda la latencia es la red,
con 1 o con 2 nodos. Ni la CPU ni Redis son el cuello de botella (03 QAs, pág. 21), que es lo que la caché aliviaría.

**El limitador.** Con E7 a 2B el nodo atendió el pico entero, pero 240 pedidos/s era el 75 % de lo que ya había
aguantado en la capacidad, así que esa corrida no alcanzaba para decidir. Por eso se agregó E7 alto. A 6B con 1 nodo
el criterio se dispara: sin `limit_req`, el exceso degrada a los aceptados. Con 2 nodos el mismo pico entra entero
(p95 un balde arriba, 0 timeouts, 0 handshakes descartados, cada proceso al 74 % como máximo). La táctica que lo
resuelve es replicar el nodo (Maintain Multiple Copies of Computations, 04 Tácticas, pág. 8; Scale out not up, pág. 9),
con el Load Balancer de Azure repartiendo (06 Estilos, pág. 15).

**Cómo se aplica.** El segundo nodo tiene que estar arriba antes del pico: es la estrategia lead de la clase del
29/10, provisionar antes de un evento que se ve venir. Un autoescalado (lag o match) llega tarde a un pico de 20 s; en
la clase del 24/09, para un spike, "no hay una máquina que levante a esa velocidad". En esta infraestructura además un
nodo nuevo del VMSS arranca sin la app hasta que corre Ansible (no hay `custom_data`). El segundo B2als_v2 cuesta unos
US$ 0,038 por hora (unos US$ 27 por mes, precio de lista en northcentralus). `node.tf` queda con `instances = 1` para
cuidar el crédito, y con eso un pico de 6B degrada: para un evento conocido hay que subirlo a 2 antes. La otra salida
que se dio en esa clase, "lo vas dejando pasar despacito", es control de admisión, o sea el limitador: tiene sentido
para picos que superen a todos los nodos y queda como táctica de reserva; por ahora no se repone.

## Descartadas

- **Application Gateway con WAF** (reponer el reverse proxy, 06 Estilos, pág. 16): las dos tácticas que traería no
  hacen falta, cobra por hora aunque no haya tráfico y no está en la infraestructura de la cátedra. Tampoco cachea
  respuestas; para eso haría falta Front Door.
- **Caché de tasas en la app** (Maintain Multiple Copies of Data, 04, pág. 8): ningún criterio cerca del umbral, y con
  2 nodos habría una copia por nodo, con un `PUT /rates` que invalida solo la suya. Como el Load Balancer reparte por
  conexión, durante el TTL dos usuarios en nodos distintos podrían cotizar con tasas distintas.
- **Rate limiting en la app** (Limit Event Response y Bound Queue Sizes, 04, pág. 8): arriba del techo la espera está
  en la cola de `listen`, antes de que la app vea la conexión, y un limitador en la app usaría el mismo hilo saturado
  para contestar 429. Un `limit_req` en nginx sí recortaría esa espera porque corre en otro proceso, pero eso es
  reponer el reverse proxy (descartado arriba).

## Límites de lo medido

- **Cuánto aguantan 2 nodos.** No se midió. Si escala proporcionalmente, el proceso da 2 × 570 ≈ 1.140 pedidos/s con el
  reparto parejo que se midió. ARCA, a 99 milicores a 320 pedidos/s, llegaría a su límite de 500 cerca de 1.600. Redis
  recibiría 1.140 × 14,5 ≈ 16.500 op/s y no le medimos el techo; es compartido y no escala con el VMSS, así que si
  algo corta antes de 1.140 lo más probable es Redis.
- **B ≥ 320 en este nodo** contra B = 120 del bloque 1 (F1als_v7, eastus2, wifi). Los escenarios usaron 120 para que el
  informe tenga un solo B. Esto apoya que el límite del bloque 1 fue la red de la generadora, pero no lo prueba:
  cambiaron nodo, región y generadora a la vez.
- **Créditos.** El techo de 570 vale con créditos de CPU; sin créditos el nodo sostiene unos 260 pedidos/s.
- **Caché por nodo.** La inconsistencia queda como argumento: se midió que el reparto es por conexión, pero no hay caché
  que medir.
- **Redis y Azure Monitor.** El procesador de `Balanced_B0` no es una buena señal de carga; para Redis vale la tasa de
  operaciones, y Azure Monitor la da por minuto y con 1 a 2 min de desfase, así que no ve un pico de 20 s. Los picos se
  miran por la app (`POST.exchange`).
- **Resolución de Artillery.** Los percentiles caen en baldes que crecen un 2 % (1.300, 1.326, 1.353, 1.380 ms): una
  diferencia de un balde es "sin cambio".
- `exchange-capacidad/nodo/kernel.txt` es `sudo dmesg` leído después de la corrida (sin `sudo` no muestra nada).
