#!/bin/sh
# uso: muestreo-cpu.sh <pid de la app>  (en el nodo; cada 2 s: t_unix, utime y stime acumulados, ticks de 10 ms)
echo "# muestreo cada 2 s en el nodo de /proc/<pid de la app>/stat: t_unix, utime y stime acumulados (ticks de 10 ms)"
while true; do
  s=$(sed "s/.*) //" /proc/$1/stat)
  echo "$(date +%s) $(echo $s | cut -d" " -f12,13)"
  sleep 2
done
