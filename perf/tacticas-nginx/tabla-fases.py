# tabla por fase (o por ventana de 10 s con --ventanas) de un reporte de Artillery, con las fases del yaml.
# uso: python3 tabla-fases.py <reporte.json> <escenario.yaml> [--ventanas]
import json, re, sys

d = json.load(open(sys.argv[1]))
fases = [(int(a), int(b)) for b, a in re.findall(r"duration: (\d+)\n\s+arrivalRate: (\d+)", open(sys.argv[2]).read())]
por_ventana = "--ventanas" in sys.argv
W = sorted(d["intermediate"], key=lambda w: int(w["period"]))
#las ventanas de 10 s van alineadas al reloj: el arranque real es el primer contador de la primera
t0 = int(W[0]["firstCounterAt"])
bordes, acc = [], 0
for i, (tasa, dur) in enumerate(fases):
    bordes.append((i, acc, acc + dur))
    acc += dur
endpoints = sorted({k.split("response_time.")[1] for w in W for k in w["summaries"] if "metrics-by-endpoint.response_time." in k})


#cada ventana va a la fase que contiene su punto medio
def fase(w):
    s = max(0, (int(w["period"]) + 5000 - t0) / 1000)
    return next((i for i, a, b in bordes if a <= s < b), len(fases) - 1)


#mediana de los valores de cada ventana, ponderada por pedidos: con p95 no es el p95 exacto de la fase
def wmed(pares, campo):
    pares = sorted((x[campo], x["count"]) for x in pares)
    tot, a = sum(c for _, c in pares), 0
    for v, c in pares:
        a += c
        if a >= tot / 2:
            return round(v)


grupos = {}
for w in W:
    clave = round((int(w["period"]) + 5000 - t0) / 1000) if por_ventana else fase(w)
    g = grupos.setdefault(clave, {"req": 0, "200": 0, "403": 0, "503": 0, "sin": 0, "s": {}})
    c = w["counters"]
    g["req"] += c.get("http.requests", 0)
    for k in ("200", "403", "503"):
        g[k] += c.get("http.codes." + k, 0)
    g["sin"] += sum(v for k, v in c.items() if k.startswith("errors."))
    for k, x in w["summaries"].items():
        g["s"].setdefault(k, []).append(x)

col = "Segundo (medio de la ventana)" if por_ventana else "Fase (req/s x s)"
cab = [col, "Pedidos", "200", "403", "503", "Sin respuesta", "2xx: mediana / p95", "4xx: mediana", "5xx: mediana"]
cab += [f"{e}: mediana / p95" for e in endpoints if e != "/exchange"]
print("| " + " | ".join(cab) + " |")
print("|" + "---|" * len(cab))
for clave in sorted(grupos):
    g, s = grupos[clave], grupos[clave]["s"]
    nombre = clave if por_ventana else f"{fases[clave][0]} x {fases[clave][1]}"
    m = lambda k, campos: " / ".join(str(wmed(s[k], c)) for c in campos) if k in s else "-"
    fila = [nombre, g["req"], g["200"], g["403"], g["503"], g["sin"],
            m("http.response_time.2xx", ("p50", "p95")), m("http.response_time.4xx", ("p50",)), m("http.response_time.5xx", ("p50",))]
    fila += [m("plugins.metrics-by-endpoint.response_time." + e, ("p50", "p95")) for e in endpoints if e != "/exchange"]
    print("| " + " | ".join(map(str, fila)) + " |")
