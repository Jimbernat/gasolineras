"""Descarga precios del Ministerio y genera data/stations.json (compacto) + data/history.json (medias diarias)."""
import json, statistics, urllib.request, urllib.error, datetime, pathlib, sys, time

API = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/"
FUELS = {  # clave corta -> campo de la API
    "g95": "Precio Gasolina 95 E5",
    "g98": "Precio Gasolina 98 E5",
    "goa": "Precio Gasoleo A",
    "gop": "Precio Gasoleo Premium",
    "glp": "Precio Gases licuados del petróleo",
    "gnc": "Precio Gas Natural Comprimido",
}
DATA = pathlib.Path(__file__).resolve().parent.parent / "data"


def num(s):
    s = (s or "").strip().replace(",", ".")
    return float(s) if s else None


def in_spain(lat, lon):
    return 27 <= lat <= 44.5 and -18.5 <= lon <= 4.5


def fetch():
    req = urllib.request.Request(API, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 (gasolineras-app)"})
    for intento in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            err = f"HTTP {e.code} {e.reason}: {e.read()[:200]!r}"
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
        print(f"::warning::Intento {intento} fallido — {err}")  # visible en GitHub sin iniciar sesión
        time.sleep(20 * intento)
    raise SystemExit(f"::error::No se pudo descargar la API del Ministerio — {err}")


def main():
    if len(sys.argv) > 1:  # uso local: python3 update.py raw.json
        raw = json.loads(pathlib.Path(sys.argv[1]).read_text())
    else:
        raw = fetch()
    if raw.get("ResultadoConsulta") != "OK":
        raise SystemExit(f"API error: {raw.get('ResultadoConsulta')}")

    provinces, stations = [], []
    for e in raw["ListaEESSPrecio"]:
        if e.get("Tipo Venta") != "P":  # solo venta al público
            continue
        lat, lon = num(e["Latitud"]), num(e["Longitud (WGS84)"])
        if lat is None or lon is None:
            continue
        if not in_spain(lat, lon) and in_spain(lon, lat):  # coordenadas invertidas en origen
            lat, lon = lon, lat
        if not in_spain(lat, lon):
            continue
        prices = [num(e[f]) for f in FUELS.values()]
        if not any(prices):
            continue
        prov = e["Provincia"].strip().capitalize()
        if prov not in provinces:
            provinces.append(prov)
        stations.append([
            e["IDEESS"], round(lat, 5), round(lon, 5), e["Rótulo"].strip(),
            e["Dirección"].strip().title(), e["Municipio"].strip(), provinces.index(prov),
            e["Horario"].strip(), *prices,
        ])

    fecha = datetime.datetime.strptime(raw["Fecha"], "%d/%m/%Y %H:%M:%S")
    out = {"fecha": raw["Fecha"], "fuels": list(FUELS), "provinces": provinces, "stations": stations}
    DATA.mkdir(exist_ok=True)
    (DATA / "stations.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

    # Histórico: media diaria por combustible (España y por provincia), se sobrescribe el día en curso
    hist_path = DATA / "history.json"
    hist = json.loads(hist_path.read_text()) if hist_path.exists() else {}
    day = {}
    for i, k in enumerate(FUELS):
        vals = [s[8 + i] for s in stations if s[8 + i]]
        if not vals:
            continue
        by_prov = {}
        for s in stations:
            if s[8 + i]:
                by_prov.setdefault(provinces[s[6]], []).append(s[8 + i])
        day[k] = {"ES": round(statistics.mean(vals), 4),
                  **{p: round(statistics.mean(v), 4) for p, v in by_prov.items()}}
    hist[fecha.strftime("%Y-%m-%d")] = day
    hist = dict(sorted(hist.items())[-400:])
    hist_path.write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(stations)} estaciones · {raw['Fecha']}")


if __name__ == "__main__":
    main()
