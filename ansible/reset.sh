#!/bin/bash
OLD_DIR="$(pwd)"
DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd $DIR

# como deploy.sh pero sin armar el zip: solo corre el reset
ansible-playbook -i vmss_hosts --private-key ../key.pem -u azureuser vmss_reset.yml

cd $OLD_DIR
