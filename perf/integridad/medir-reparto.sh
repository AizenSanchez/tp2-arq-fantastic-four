#!/bin/bash
# Mide como reparte el balanceador entre los nodos: N pedidos GET / con conexion nueva cada uno, contando el header
# X-Node, desde esta maquina y desde el jumpbox (dentro de Azure). Un origen con pocas conexiones distintas (por ejemplo
# detras de un NAT) puede caer casi siempre en el mismo nodo, y eso afecta a lo que se puede observar con 2 nodos.
#   perf/integridad/medir-reparto.sh [N=100] [caso=azure-2-nodos]
cd "$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1
N="${1:-100}"; CASO="${2:-azure-2-nodos}"
LB="$(cat node/lb_dns)"; JB="$(cat ansible/jumpbox_dns)"
OUT="evidencia/$CASO/reparto-del-balanceador.txt"; mkdir -p "evidencia/$CASO"
contar() { sort | uniq -c | sed 's/^ */  /'; }
{
  echo "reparto del balanceador, $N pedidos GET / con conexion nueva (Connection: close) desde cada origen"
  echo "fecha UTC: $(date -u +%FT%TZ)   commit: $(git rev-parse --short HEAD)"
  echo "terraform output vmss_instances: $(terraform output -raw vmss_instances 2>/dev/null)"
  echo
  echo "desde esta maquina (conexion: ${CONEXION:-sin anotar}):"
  for _ in $(seq 1 "$N"); do curl -s -m 10 -o /dev/null -D - -H 'Connection: close' "http://$LB/" | grep -i '^x-node' | tr -d '\r'; done | contar
  echo
  echo "desde el jumpbox, dentro de Azure:"
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -i key.pem "azureuser@$JB" \
    "for _ in \$(seq 1 $N); do curl -s -m 10 -o /dev/null -D - -H 'Connection: close' http://$LB/ | grep -i '^x-node' | tr -d '\r'; done | sort | uniq -c | sed 's/^ */  /'"
} | tee "$OUT"
