#!/bin/bash
# Guarda en evidencia/infra/<caso>/ como estaba desplegada la infraestructura.
# Uso: evidencia/capturar-infra.sh <caso>   (por ejemplo 1-nodo o escalado)
# Correr desde la raiz del repo, con az login hecho. No guarda ninguna clave.
set -u
CASO="${1:?uso: evidencia/capturar-infra.sh <caso>}"
cd "$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="evidencia/infra/$CASO"
mkdir -p "$OUT"

terraform state list > "$OUT/terraform-state-list.txt"
# los outputs no incluyen claves (ver outputs.tf)
terraform output > "$OUT/terraform-output.txt"
az vmss list-instances -g tp2_resource_group -n tp2vmss -o table > "$OUT/vmss-list-instances.txt"

# el codigo desplegado tiene que ser el commiteado: git-status.txt debe quedar vacio
git rev-parse HEAD > "$OUT/git-head.txt"
git status --porcelain > "$OUT/git-status.txt"
[ -s "$OUT/git-status.txt" ] && echo "AVISO: hay cambios sin commitear, ver $OUT/git-status.txt"

# recursos del grupo, para descubrir los ids de ARCA y de Redis
az resource list -g tp2_resource_group --query "[].{n:name,t:type,id:id}" -o table > "$OUT/recursos.txt"
echo "Guardado en $OUT"
echo "Falta, al terminar la corrida, las metricas de Azure Monitor en su ventana (ver el plan, seccion 4.7):"
echo "  az monitor metrics list --resource <id> --metric <nombre> --interval PT1M --start-time <UTC> --end-time <UTC> -o json"
