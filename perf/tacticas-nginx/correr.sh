#!/bin/sh
# uso (desde perf/): sh tacticas-nginx/correr.sh <escenario sin .yaml> <caso>/<corrida>
# TARGET (http://<lb_dns>) y DATADOG_API_KEY por entorno, nunca en un archivo. deja en results/ el json y el
# horario UTC de inicio y fin, que es el rango que usan la captura de Datadog y la de Azure Monitor.
set -e
: "${TARGET:?falta TARGET}" "${DATADOG_API_KEY:?falta DATADOG_API_KEY}"
mkdir -p "results/$(dirname "$2")"
inicio=$(date -u +%Y-%m-%dT%H:%M:%SZ)
s=0
npx artillery run "tacticas-nginx/$1.yaml" --output "results/$2.json" > /tmp/artillery.log 2>&1 || s=$?
printf 'inicio %s\nfin %s\n' "$inicio" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "results/$2.horario.txt"
tail -40 /tmp/artillery.log
exit $s
