"""Catálogos de negocio. En producción vienen del ERP / maestro de activos.

La telemetría AEMP sólo aporta PIN, OEM, modelo, horas, combustible y posición;
tipos, tarifas, obras, clientes y turnos son datos propios de la empresa.
"""

STANDBY_FACTOR = 0.5

BBOX = {"latMin": 5.0, "latMax": 6.6, "lonMin": -76.0, "lonMax": -74.4}

TYPES = [
    {"id": "EXC", "name": "Excavadora", "rate": 95, "fuel": 18, "models": ["CAT 336", "Komatsu PC360LC-11", "Volvo EC380E", "Hitachi ZX350LC"]},
    {"id": "VOL", "name": "Volqueta", "rate": 70, "fuel": 22, "models": ["Volvo A40G", "CAT 745", "Komatsu HM400-5"]},
    {"id": "CAR", "name": "Cargador", "rate": 85, "fuel": 16, "models": ["CAT 966 GC", "Volvo L150H", "Komatsu WA470-8"]},
    {"id": "BUL", "name": "Bulldozer", "rate": 120, "fuel": 28, "models": ["CAT D8", "Komatsu D155AX-8", "Liebherr PR 756"]},
    {"id": "MOT", "name": "Motoniveladora", "rate": 90, "fuel": 15, "models": ["CAT 140 GC", "John Deere 772G", "Komatsu GD655-7"]},
    {"id": "RET", "name": "Retroexcavadora", "rate": 55, "fuel": 8, "models": ["CAT 420", "John Deere 310L", "Case 580N"]},
    {"id": "COM", "name": "Compactador", "rate": 60, "fuel": 10, "models": ["CAT CS56B", "Dynapac CA2500", "Bomag BW 213"]},
    {"id": "GRU", "name": "Grúa", "rate": 150, "fuel": 20, "models": ["Liebherr LTM 1090", "Grove GMK5150L"]},
]

CLIENTS = [
    {"id": "C1", "name": "Concesión Vial Andina"},
    {"id": "C2", "name": "Agregados del Valle"},
    {"id": "C3", "name": "Hidroeléctrica Sur"},
    {"id": "C4", "name": "Constructora Meridiano"},
    {"id": "C5", "name": "Minera Cordillera"},
]

SITES = [
    {"id": "S1", "name": "Troncal Norte · Tramo 2", "short": "Troncal Norte", "client": "C1", "lat": 6.35, "lon": -75.55, "radius": 0.05, "sunday": False, "mix": {"EXC": 4, "VOL": 8, "MOT": 3, "COM": 3, "BUL": 2, "CAR": 1}},
    {"id": "S2", "name": "Cantera La Esperanza", "short": "La Esperanza", "client": "C2", "lat": 6.05, "lon": -75.20, "radius": 0.035, "sunday": True, "mix": {"EXC": 3, "CAR": 4, "VOL": 6}},
    {"id": "S3", "name": "Presa Río Claro", "short": "Río Claro", "client": "C3", "lat": 5.45, "lon": -74.85, "radius": 0.05, "sunday": True, "mix": {"EXC": 5, "VOL": 7, "BUL": 3, "GRU": 3, "COM": 2}},
    {"id": "S4", "name": "Parque Industrial Occidente", "short": "P.I. Occidente", "client": "C4", "lat": 5.70, "lon": -75.70, "radius": 0.03, "sunday": False, "mix": {"RET": 5, "EXC": 2, "COM": 2, "GRU": 1, "CAR": 2}},
    {"id": "S5", "name": "Variante San Isidro", "short": "San Isidro", "client": "C1", "lat": 5.95, "lon": -75.85, "radius": 0.04, "sunday": False, "mix": {"MOT": 3, "COM": 3, "VOL": 4, "EXC": 2, "RET": 2}},
    {"id": "S6", "name": "Mina El Porvenir", "short": "El Porvenir", "client": "C5", "lat": 5.20, "lon": -75.30, "radius": 0.045, "sunday": True, "mix": {"EXC": 4, "VOL": 9, "CAR": 3, "BUL": 2}},
]

# Corredores viales [lat, lon] usados por el mapa y por las volquetas.
ROADS = [
    [[6.35, -75.55], [6.25, -75.42], [6.12, -75.28], [6.05, -75.20]],
    [[6.05, -75.20], [5.88, -75.10], [5.66, -74.96], [5.45, -74.85]],
    [[6.05, -75.20], [5.98, -75.45], [5.84, -75.60], [5.70, -75.70]],
    [[5.70, -75.70], [5.82, -75.79], [5.95, -75.85]],
    [[5.70, -75.70], [5.50, -75.55], [5.33, -75.40], [5.20, -75.30]],
    [[5.20, -75.30], [5.28, -75.10], [5.40, -74.94], [5.45, -74.85]],
    [[6.35, -75.55], [6.20, -75.72], [6.05, -75.82], [5.95, -75.85]],
]

STATES = [
    {"id": "op", "name": "Operando", "color": "#12a87a"},
    {"id": "idle", "name": "Ralentí", "color": "#f07c2a"},
    {"id": "standby", "name": "Standby", "color": "#2f86e0"},
    {"id": "down", "name": "Avería", "color": "#e5384f"},
    {"id": "off", "name": "Sin señal", "color": "#8a94a6"},
]

SITE_BY_ID = {s["id"]: s for s in SITES}
TYPE_BY_ID = {t["id"]: t for t in TYPES}


def shift_hours(site_id: str, weekday: int) -> float:
    """Horas de turno programadas. weekday: 0 = lunes."""
    if weekday < 5:
        return 10.0
    if weekday == 5:
        return 6.0
    return 6.0 if SITE_BY_ID[site_id]["sunday"] else 0.0
