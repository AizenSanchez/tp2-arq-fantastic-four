#!/bin/bash
# uso: exportar-azure-monitor.sh <carpeta> <inicio UTC> <fin UTC>
# exporta Redis, ARCA y la VMSS con 2 min de margen y grano de 1 min, sin ids de suscripcion. necesita `az` logueado.
set -e
out=$1; mkdir -p $out; S=$(date -u -d "$2 - 2 min" +%FT%TZ); E=$(date -u -d "$3 + 2 min" +%FT%TZ)
limpiar() { python3 -c '
import json,re,sys
def l(x):
  if isinstance(x,list): return [l(i) for i in x]
  if isinstance(x,dict): return {k:l(v) for k,v in x.items() if k!="id"}
  return x
print(re.sub(r"subscriptions/[0-9a-fA-F-]{36}","subscriptions/<suscripcion>",json.dumps(l(json.load(sys.stdin)),indent=2)))'; }
ex() { id=$(az resource list -g tp2_resource_group --resource-type $1 --query "[0].id" -o tsv); shift; az monitor metrics list --resource $id --metrics "$@" --interval PT1M --start-time $S --end-time $E -o json | limpiar; }
ex Microsoft.Cache/redisEnterprise usedmemory operationsPerSecond percentProcessorTime --aggregation Maximum Average > $out/redis.json
ex Microsoft.ContainerInstance/containerGroups CpuUsage MemoryUsage --aggregation Average Maximum > $out/arca.json
ex Microsoft.Compute/virtualMachineScaleSets "CPU Credits Remaining" "CPU Credits Consumed" "Percentage CPU" --aggregation Average Maximum > $out/vmss.json
