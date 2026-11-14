#!/usr/bin/env bash
# Regenera la evidencia de respuestas de la app (plan, punto 5.11) contra el compose local.
# Cada archivo empieza con el comando exacto que produjo la respuesta ("$ ...").
# ARCA aprueba, rechaza o falla al azar: para 200 y 403 se prueban DNIs hasta obtener ese caso,
# y se guarda el comando del intento que lo obtuvo.
#
# Uso, desde la raiz del repo:
#   docker compose -f docker-compose.local.yml up -d --build
#   evidencia/app/generar.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

URL=localhost:3000
OUT=evidencia/app
COMPOSE="docker compose -f docker-compose.local.yml"
CT="-H 'Content-Type: application/json'"

body() { # body <campo dni JSON, o vacio>
  printf '{"baseCurrency":"ARS","counterCurrency":"USD","baseAmount":1000,"baseAccountId":101,"counterAccountId":102%s}' "$1"
}

run() { # run <comando>: imprime "$ comando" y su salida
  echo "\$ $1"
  bash -c "$1"
  echo
}

status() { head -2 "$1" | sed -n 's/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p'; }

random_dni() { echo $((10000000 + RANDOM * 2000 + RANDOM % 2000)); }

exchange_cmd() { # exchange_cmd <body> [headers extra]
  echo "curl -s -i -X POST $URL/exchange $CT ${2:-}-d '$1'"
}

until_status() { # until_status <codigo> <archivo>
  for _ in $(seq 1 30); do
    run "$(exchange_cmd "$(body ",\"dni\":\"$(random_dni)\"")")" > "$2"
    [ "$(status "$2")" = "$1" ] && return 0
  done
  echo "no se obtuvo un $1 en 30 intentos" >&2
  return 1
}

run "curl -s -i $URL/" > $OUT/get-raiz.txt
until_status 200 $OUT/exchange-200.txt
until_status 403 $OUT/exchange-403.txt
run "$(exchange_cmd "$(body '')")" > $OUT/exchange-400-sin-dni.txt
run "$(exchange_cmd "$(body ',"dni":"123"')")" > $OUT/exchange-400-dni-invalido.txt

{
  run "$COMPOSE stop arca 2>/dev/null"
  run "$(exchange_cmd "$(body ',"dni":"40101235"')" "-H 'Idempotency-Key: demo-503' ")"
} > $OUT/exchange-503.txt
$COMPOSE start arca >/dev/null 2>&1
sleep 2

# idempotencia: el primer request tiene que terminar en 200 o 403 (un 5xx libera la clave a proposito)
for i in $(seq 1 30); do
  dni=$(random_dni)
  cmd=$(exchange_cmd "$(body ",\"dni\":\"$dni\"")" "-H 'Idempotency-Key: demo-reintento-$dni' ")
  antes=$(curl -s "$URL/log" | jq length)
  first=$(run "$cmd")
  code=$(echo "$first" | sed -n '2s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p')
  [ "$code" = 200 ] || [ "$code" = 403 ] || continue
  second=$(run "$cmd")
  despues=$(curl -s "$URL/log" | jq length)
  {
    echo "# Mismo Idempotency-Key y mismo body, dos veces."
    echo "# Entradas en el log (curl -s $URL/log | jq length): antes del primero $antes, despues del reintento $despues (el primero suma 1, el reintento no suma)"
    echo "## Primer request"
    echo "$first"
    echo "## Reintento"
    echo "$second"
  } > $OUT/exchange-reintento-idempotente.txt
  break
done

echo "evidencia regenerada en $OUT/"
