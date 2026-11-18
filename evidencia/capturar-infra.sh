#!/bin/bash
OLD_DIR="$(pwd)"
DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd $DIR/..

CASO="${1:?uso: evidencia/capturar-infra.sh <caso>}"
mkdir -p evidencia/$CASO
terraform state list > evidencia/$CASO/terraform-state-list.txt
terraform output > evidencia/$CASO/terraform-output.txt
az vmss list-instances -g tp2_resource_group -n tp2vmss -o table > evidencia/$CASO/vmss-list-instances.txt
echo >> evidencia/$CASO/vmss-list-instances.txt
az vmss show -g tp2_resource_group -n tp2vmss --query "{sku:sku.name, capacidad:sku.capacity, region:location}" -o table >> evidencia/$CASO/vmss-list-instances.txt

cd $OLD_DIR
