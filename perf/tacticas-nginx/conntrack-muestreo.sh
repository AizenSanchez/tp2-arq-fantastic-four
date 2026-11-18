#!/bin/sh
# uso: conntrack-muestreo.sh <segundos>  (en el nodo; escribe /tmp/conntrack.log cada 5 s)
# solo el total: en los nodos `conntrack -L` no devolvio estados en ninguna corrida
set -eu
fin=$(( $(date +%s) + ${1:?uso: conntrack-muestreo.sh <segundos>} ))
while [ "$(date +%s)" -lt "$fin" ]; do
  echo "$(date -u +%H:%M:%S) total=$(cat /proc/sys/net/netfilter/nf_conntrack_count)"
  sleep 5
done > /tmp/conntrack.log 2>&1
