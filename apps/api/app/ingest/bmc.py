"""Carga del historial de facturación y del pool diario del contrato de acarreo con Consorcio BMC.

Fuentes (todas en el PC de control de gestión, ninguna se versiona en el repo):
- F12-C Seguimiento Contractual ... .xlsx   hoja "Acta" (contrato, ítems, precio inicial y otrosí),
                                            hojas "Detalle Acta NN" (recibos) y "STAND BY" (ventanas)
- Validacion Acta NN ... .xlsx              hoja "Detalle NN recalculado" (recibos de un acta posterior
                                            con el m³-km que cobró el acta)
- BMC_1.xlsx                                hojas "Registros" (parte diario: odómetro, horas, m³, viajes,
                                            trayecto) y "Operadores y Equipos"
- lecturas-partes-*.csv                     número de parte por equipo y día
- ventanas-standby.csv                      días disponibles por equipo validados para cada acta

Uso:
    python -m app.ingest.bmc --f12 F12-C.xlsx --validacion "Validacion Acta 02.xlsx" \
        --panel BMC_1.xlsx --partes lecturas-partes.csv --ventanas ventanas-standby.csv \
        [--dsn postgresql://fleetmap:fleetmap@localhost/fleetmap] [--sql salida.sql]
Sin --dsn ni --sql sólo imprime el resumen (cuadre de cada acta y tarifas encontradas).
"""
from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path

import openpyxl

from ..domain.haulage import StandbyRule, m3km, standby_by_slot

OWN_SUPPLIER = {"G. ORTIZ", "GRUPO ORTIZ", "ORTIZ"}


def _norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().upper()


def _slug(s: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", _norm(s)).strip("-")


def _day(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v.strip():
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(v.strip(), fmt).date()
            except ValueError:
                pass
    return None


def _num(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def _time(v) -> time | None:
    if isinstance(v, time):
        return v
    if isinstance(v, datetime):
        return v.time()
    if isinstance(v, str) and re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", v.strip()):
        h, m = v.strip().split(":")[:2]
        return time(int(h) % 24, int(m))
    return None


# ── Modelo intermedio ───────────────────────────────────────────────────────
@dataclass
class Contract:
    id: str
    client: str
    contractor: str
    object: str | None = None
    cost_center: str | None = None
    start: date | None = None
    end: date | None = None
    value: float | None = None
    order_no: str | None = None


@dataclass
class Item:
    code: str
    description: str
    unit: str
    qty: float | None
    price: float
    qty_updated: float | None = None
    price_updated: float | None = None


@dataclass
class Cut:
    number: int
    period_from: date
    period_to: date
    prepared_on: date | None = None
    qty_billed: float | None = None
    status: str = "recibida"
    note: str | None = None


@dataclass
class Ticket:
    ticket_no: str
    day: date
    plate: str
    supplier: str
    driver: str | None
    m3: float
    haul_km: float
    m3km_billed: float | None
    route_code: str | None = None
    unload_station: float | None = None
    origin: str | None = None
    destination: str | None = None
    activity: str | None = None
    note: str | None = None
    cut_number: int | None = None

    @property
    def billable(self) -> bool:
        return _norm(self.supplier) in OWN_SUPPLIER

    @property
    def m3km_calc(self) -> int:
        return m3km(self.m3, self.haul_km)


@dataclass
class Window:
    cut_number: int
    plate: str
    code: str | None
    slot: str
    date_from: date
    date_to: date
    days_available: int
    workshop_days: int = 0
    note: str | None = None


@dataclass
class DailyReport:
    plate: str
    day: date
    status: str
    driver: str | None
    odometer_start: float | None
    odometer_end: float | None
    shift_start: time | None
    shift_end: time | None
    m3: float | None
    trips: int | None
    route: str | None
    origin: str | None
    destination: str | None
    report_no: str | None
    note: str | None


@dataclass
class Load:
    contract: Contract | None = None
    items: list[Item] = field(default_factory=list)
    rule: StandbyRule | None = None
    rule_item: str | None = None
    cuts: dict[int, Cut] = field(default_factory=dict)
    tickets: list[Ticket] = field(default_factory=list)
    windows: list[Window] = field(default_factory=list)
    reports: list[DailyReport] = field(default_factory=list)
    operators: dict[str, str | None] = field(default_factory=dict)   # nombre → cédula
    equipment: dict[str, str] = field(default_factory=dict)          # placa → código interno


# ── F12-C: hoja Acta ────────────────────────────────────────────────────────
def _cells(ws) -> dict[str, object]:
    out = {}
    for row in ws.iter_rows():
        for c in row:
            if c.value is not None:
                out[c.coordinate] = c.value
    return out


def _right_of(cells: dict, label: str, row_hint: int | None = None, max_cols: int = 6):
    """Valor de la primera celda no vacía a la derecha de una etiqueta."""
    for coord, v in cells.items():
        if isinstance(v, str) and _norm(v).startswith(_norm(label)):
            col, row = openpyxl.utils.cell.coordinate_from_string(coord)
            if row_hint and row != row_hint:
                continue
            ci = openpyxl.utils.column_index_from_string(col)
            for k in range(1, max_cols + 1):
                val = cells.get(f"{openpyxl.utils.get_column_letter(ci + k)}{row}")
                if val is not None:
                    return val
    return None


def parse_acta_sheet(ws, load: Load) -> Cut:
    cells = _cells(ws)
    title = next((v for v in cells.values() if isinstance(v, str) and "ACTA DE CORTE" in _norm(v)), "")
    number = int(re.search(r"(\d+)", title).group(1)) if re.search(r"(\d+)", title) else 1
    contract_id = str(_right_of(cells, "Contrato No.")).strip()

    # Fila "Contrato Inicial": plazo, inicio, fin, valor
    start = end = value = None
    for coord, v in cells.items():
        if isinstance(v, str) and _norm(v) == "CONTRATO INICIAL":
            _, row = openpyxl.utils.cell.coordinate_from_string(coord)
            vals = [cells[k] for k in sorted((k for k in cells if openpyxl.utils.cell.coordinate_from_string(k)[1] == row),
                                            key=lambda k: openpyxl.utils.column_index_from_string(openpyxl.utils.cell.coordinate_from_string(k)[0]))]
            dates = [d for d in (_day(x) for x in vals) if d]
            nums = [x for x in vals if isinstance(x, (int, float))]
            if len(dates) >= 2:   # la misma fila trae antes la fecha de elaboración del acta
                start, end = dates[-2], dates[-1]
            value = float(nums[-1]) if nums else None
            break

    load.contract = Contract(
        id=contract_id, client=str(_right_of(cells, "Contratante:") or "").strip(),
        contractor=str(_right_of(cells, "Contratista:") or "").strip(),
        object=str(_right_of(cells, "Objeto del Contrato:") or "").strip() or None,
        cost_center=str(_right_of(cells, "CC-SC:") or "").strip() or None, start=start, end=end, value=value,
    )

    # Ítems: filas con código Navision en la columna B (x.xx.xx)
    qty_cut = 0.0
    load.items = []
    for row in ws.iter_rows(min_row=1, values_only=True):
        code = row[1] if len(row) > 1 else None
        if isinstance(code, str) and re.fullmatch(r"\d+\.\d{2}\.\d{2}", code.strip()) and isinstance(row[6], (int, float)):
            load.items.append(Item(
                code=code.strip(), description=str(row[2] or "").strip(), unit=str(row[4] or "").strip(),
                qty=_num(row[5]), price=float(row[6]), qty_updated=_num(row[9]), price_updated=_num(row[10]),
            ))
            qty_cut += _num(row[14]) or 0.0      # columna O: obra ejecutada presente acta

    period_from = _day(_right_of(cells, "Periodo Facturado:"))
    period_to = _day(_right_of(cells, "a:", max_cols=3))
    cut = Cut(number=number, period_from=period_from, period_to=period_to,
              prepared_on=_day(_right_of(cells, "Fecha Elaboracion Acta")), qty_billed=qty_cut)
    load.cuts[number] = cut
    return cut


# ── Recibos (detalle del acta) ──────────────────────────────────────────────
TICKET_HEADERS = {
    "day": ("FECHA",), "ticket_no": ("RECIBO",), "plate": ("PLACA",),
    "m3": ("VOLUMEN SUELTO", "M3", "M³"), "driver": ("CONDUCTOR",), "supplier": ("PROVEEDOR",),
    "route_code": ("RUTA",), "unload_station": ("ABS DESCARGUE", "ABSCISA"),
    "origin": ("ORIGEN",), "destination": ("DESTINO",), "haul_km": ("DISTANCIA ACARREO", "KM ACARREO"),
    "m3km_billed": ("TOTAL (M3-KM) VOL SUEL", "M3-KM DEL ACTA"), "note": ("NOVEDAD",),
}


def _header_map(row) -> dict[str, int]:
    hdr = [_norm(v) for v in row]
    out: dict[str, int] = {}
    for key, names in TICKET_HEADERS.items():
        for i, h in enumerate(hdr):
            if h and any(h == _norm(n) or h.startswith(_norm(n)) for n in names) and key not in out:
                out[key] = i
    return out


def parse_tickets(ws) -> list[Ticket]:
    rows = list(ws.iter_rows(values_only=True))
    hi = next((i for i, r in enumerate(rows[:15]) if {"RECIBO", "PLACA"} <= {_norm(v) for v in r}), None)
    if hi is None:
        return []
    h = _header_map(rows[hi])
    # la columna de actividad (PARCHEO / MIXTO) no tiene encabezado en el detalle del acta
    out = []
    for r in rows[hi + 1:]:
        get = lambda k: r[h[k]] if k in h and h[k] < len(r) else None  # noqa: E731
        d, plate, m3, km = _day(get("day")), get("plate"), _num(get("m3")), _num(get("haul_km"))
        if not (d and plate and m3 is not None and km is not None):
            continue
        activity = next((str(v).strip() for v in r[h["m3km_billed"] + 1:] if isinstance(v, str)
                         and _norm(v) in {"PARCHEO", "MIXTO", "BACHEO", "CARPETA"}), None) if "m3km_billed" in h else None
        out.append(Ticket(
            ticket_no=str(get("ticket_no")).strip(), day=d, plate=_norm(plate), supplier=str(get("supplier") or "").strip(),
            driver=(str(get("driver")).strip() if get("driver") else None), m3=m3, haul_km=km,
            m3km_billed=_num(get("m3km_billed")), route_code=(str(get("route_code")).strip() if get("route_code") else None),
            unload_station=_num(get("unload_station")), origin=(str(get("origin")).strip() if get("origin") else None),
            destination=(str(get("destination")).strip() if get("destination") else None), activity=activity,
            note=(str(get("note")).strip() if get("note") else None),
        ))
    return out


# ── STAND BY del acta ───────────────────────────────────────────────────────
def parse_standby_sheet(ws, cut_number: int, load: Load) -> None:
    rows = list(ws.iter_rows(values_only=True))
    hi = next((i for i, r in enumerate(rows[:5]) if "PLACA" in {_norm(v) for v in r}), None)
    if hi is None:
        return
    hdr = [_norm(v) for v in rows[hi]]
    ix = {k: hdr.index(k) for k in ("PLACA", "M3", "KM", "VIAJES", "INICIO", "FIN", "DIAS") if k in hdr}
    for r in rows[hi + 1:]:
        plate = r[ix["PLACA"]] if "PLACA" in ix else None
        if not (isinstance(plate, str) and re.fullmatch(r"[A-Z]{3}\d{3}", plate.strip())):
            continue
        if load.rule is None:
            load.rule = StandbyRule(_num(r[ix["M3"]]), _num(r[ix["KM"]]), _num(r[ix["VIAJES"]]))
        code = str(r[0]).strip() if r[0] else None
        load.windows.append(Window(cut_number=cut_number, plate=plate.strip(), code=code, slot=code or plate.strip(),
                                   date_from=_day(r[ix["INICIO"]]), date_to=_day(r[ix["FIN"]]),
                                   days_available=int(_num(r[ix["DIAS"]]) or 0), note="Hoja STAND BY del acta"))
        if code:
            load.equipment.setdefault(plate.strip(), code)


def parse_f12(path: Path, load: Load) -> None:
    wb = openpyxl.load_workbook(path, data_only=True)
    cut = parse_acta_sheet(wb["Acta"], load)
    for ws in wb.worksheets:
        if _norm(ws.title).startswith("DETALLE ACTA"):
            load.tickets.extend(parse_tickets(ws))
    if "STAND BY" in wb.sheetnames:
        parse_standby_sheet(wb["STAND BY"], cut.number, load)
    if load.items and load.rule_item is None:
        load.rule_item = load.items[0].code


def parse_validation(path: Path, load: Load) -> None:
    """Libro de validación de un acta posterior: trae los recibos con el m³-km que cobró el acta."""
    wb = openpyxl.load_workbook(path, data_only=True)
    periods: dict[int, tuple[str, str]] = {}
    for ws in wb.worksheets:
        for row in ws.iter_rows(max_row=40, values_only=True):
            for v in row:
                if m := re.search(r"Acta No\. ?0*(\d+) \((\d{1,2}/\d{1,2}) al (\d{1,2}/\d{1,2})\)", str(v or "")):
                    periods.setdefault(int(m.group(1)), (m.group(2), m.group(3)))
    for ws in wb.worksheets:
        if _norm(ws.title).startswith("DETALLE"):
            m = re.search(r"(\d+)", ws.title)
            tickets = parse_tickets(ws)
            if m and tickets:
                n = int(m.group(1))
                days = [t.day for t in tickets]
                frm, to = min(days), max(days)
                if n in periods:   # "Acta No. 02 (17/09 al 15/10)" en la hoja de resumen
                    (d1, m1), (d2, m2) = (map(int, p.split("/")) for p in periods[n])
                    frm, to = date(frm.year, m1, d1), date(to.year, m2, d2)
                load.cuts.setdefault(n, Cut(number=n, period_from=frm, period_to=to))
                for t in tickets:
                    t.cut_number = n
            load.tickets.extend(tickets)


def assign_cuts(load: Load) -> None:
    """Asigna cada recibo al acta cuyo periodo lo contiene y quita duplicados entre libros."""
    seen: dict[tuple, Ticket] = {}
    for t in load.tickets:
        if t.cut_number is None:
            t.cut_number = next((c.number for c in load.cuts.values()
                                 if c.period_from and c.period_to and c.period_from <= t.day <= c.period_to), None)
        seen[(t.ticket_no, t.plate, t.day)] = t
    load.tickets = list(seen.values())


# ── Pool diario (BMC_1.xlsx) ────────────────────────────────────────────────
def classify(route: str | None, trips: int | None) -> str:
    r = _norm(route)
    if "TALLER" in r or "MANTENIMIENTO" in r:
        return "taller"
    if (trips or 0) > 0:   # un viaje registrado manda aunque el trayecto diga "No programado"
        return "trabajando"
    if "VARAD" in r and "PLANTA" not in r:
        return "varado"
    if not r or "SIN PROGRAMACION" in r or "NO PROGRAMADO" in r:
        return "sin_registro"
    return "disponible"


def _split_route(route: str | None) -> tuple[str | None, str | None]:
    if not route or " - " not in route:
        return None, None
    a, b = route.split(" - ", 1)
    return a.strip(), re.sub(r"\s*\(.*?\)\s*", " ", b).strip() or None


def parse_panel(path: Path, load: Load) -> None:
    wb = openpyxl.load_workbook(path, data_only=True)
    if "Operadores y Equipos" in wb.sheetnames:
        for r in wb["Operadores y Equipos"].iter_rows(min_row=2, values_only=True):
            name, doc, plate, _, code = (list(r) + [None] * 5)[:5]
            if name and plate and re.fullmatch(r"[A-Z]{3}\d{3}", str(plate).strip()):
                load.operators[str(name).strip()] = str(doc).strip() if doc else None
                if code:
                    load.equipment[str(plate).strip()] = str(code).strip()
    ws = wb["Registros"]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [_norm(v) for v in rows[0]]
    col = {k: hdr.index(k) for k in hdr if k}
    for r in rows[1:]:
        d, plate = _day(r[col["FECHA"]]), r[col["PLACA"]]
        if not (d and plate):
            continue
        g = lambda k: r[col[k]] if k in col else None  # noqa: E731
        trips = int(_num(g("CANT.VIAJES")) or 0) if g("CANT.VIAJES") is not None else None
        route = str(g("TRAYECTO")).strip() if g("TRAYECTO") else None
        note = str(g("OBS")).strip() if g("OBS") else None
        parte = re.search(r"Parte (\d{4,6})", note or "")
        origin, dest = _split_route(route)
        load.reports.append(DailyReport(
            plate=str(plate).strip(), day=d, status=classify(route, trips),
            driver=str(g("CONDUCTOR")).strip() if g("CONDUCTOR") else None,
            odometer_start=_num(g("KM INI")), odometer_end=_num(g("KM FIN")),
            shift_start=_time(g("HRS IN OP")), shift_end=_time(g("HRS FIN OP")),
            m3=_num(g("M3 TRANS")), trips=trips, route=route, origin=origin, destination=dest,
            report_no=parte.group(1) if parte else None, note=note,
        ))


def parse_partes(path: Path, load: Load) -> None:
    """Completa el número de parte y la jornada con la lectura de partes (CSV ; fecha;placa;parte;...)."""
    by_key = {(r.plate, r.day): r for r in load.reports}
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh, delimiter=";"):
            d, plate = _day(row.get("fecha")), (row.get("placa") or "").strip()
            rep = by_key.get((plate, d))
            if rep and not rep.report_no and row.get("parte"):
                rep.report_no = row["parte"].strip()


def parse_windows(path: Path, load: Load) -> None:
    """CSV ; acta;placa;slot;desde;hasta;dias_disponibles;dias_taller;nota — reemplaza las ventanas de esa acta."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter=";"))
    cuts = {int(r["acta"]) for r in rows}
    load.windows = [w for w in load.windows if w.cut_number not in cuts]
    for r in rows:
        load.windows.append(Window(
            cut_number=int(r["acta"]), plate=r["placa"].strip(), code=load.equipment.get(r["placa"].strip()),
            slot=r["slot"].strip(), date_from=_day(r["desde"]), date_to=_day(r["hasta"]),
            days_available=int(r["dias_disponibles"]), workshop_days=int(r.get("dias_taller") or 0),
            note=(r.get("nota") or "").strip() or None,
        ))


# ── Resumen ─────────────────────────────────────────────────────────────────
def summary(load: Load) -> list[dict]:
    out = []
    for n in sorted(load.cuts):
        mine = [t for t in load.tickets if t.cut_number == n and t.billable]
        third = [t for t in load.tickets if t.cut_number == n and not t.billable]
        billed = sum(t.m3km_billed or 0 for t in mine)
        calc = sum(t.m3km_calc for t in mine)
        standby = None
        win = [w for w in load.windows if w.cut_number == n]
        if load.rule and win:
            res = standby_by_slot(load.rule, [{"plate": w.plate, "slot": w.slot, "days_available": w.days_available} for w in win],
                                  [{"plate": t.plate, "m3": t.m3, "haul_km": t.haul_km} for t in mine])
            standby = {"days": sum(r.days_available for r in res), "minimum": round(sum(r.minimum for r in res)),
                       "shortfall": round(sum(r.shortfall for r in res))}
        out.append({
            "acta": n, "periodo": f"{load.cuts[n].period_from} a {load.cuts[n].period_to}", "viajes": len(mine),
            "m3": round(sum(t.m3 for t in mine), 2), "km_min": min((t.haul_km for t in mine), default=None),
            "km_max": max((t.haul_km for t in mine), default=None), "m3km_acta": round(billed), "m3km_calculado": calc,
            "diferencia": round(billed - calc), "recibos_con_diferencia": sum(1 for t in mine if t.m3km_billed != t.m3km_calc),
            "terceros_m3km": sum(t.m3km_calc for t in third), "standby": standby,
        })
    return out


def load_all(f12: Path | None, validations: list[Path], panel: Path | None, partes: Path | None,
             windows: Path | None) -> Load:
    load = Load()
    if f12:
        parse_f12(f12, load)
    for v in validations:
        parse_validation(v, load)
    if panel:
        parse_panel(panel, load)
    if partes:
        parse_partes(partes, load)
    if windows:
        parse_windows(windows, load)
    assign_cuts(load)
    return load


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--f12", type=Path)
    ap.add_argument("--validacion", type=Path, action="append", default=[])
    ap.add_argument("--panel", type=Path)
    ap.add_argument("--partes", type=Path)
    ap.add_argument("--ventanas", type=Path)
    ap.add_argument("--orden", help="Orden de operación del cliente, p. ej. BMC-NNN-AAAA")
    ap.add_argument("--estado", action="append", default=[], metavar="ACTA=ESTADO",
                    help="Estado de un acta: 1=facturada, 2=validada …")
    ap.add_argument("--dsn", help="Cadena de conexión PostgreSQL; escribe directo en la base")
    ap.add_argument("--sql", type=Path, help="Escribe un script SQL con los INSERT en lugar de conectarse")
    a = ap.parse_args(argv)

    load = load_all(a.f12, a.validacion, a.panel, a.partes, a.ventanas)
    if load.contract and a.orden:
        load.contract.order_no = a.orden
    for s in a.estado:
        n, st = s.split("=", 1)
        if int(n) in load.cuts:
            load.cuts[int(n)].status = st
    if load.contract:
        c = load.contract
        print(f"Contrato {c.id} · {c.client} → {c.contractor} · {c.start} a {c.end} · valor {c.value:,.0f}")
    for it in load.items:
        print(f"  Ítem {it.code} {it.unit}: {it.qty:,.0f} a ${it.price:,.0f}"
              + (f" · otrosí {it.qty_updated:,.0f} a ${it.price_updated:,.0f}" if it.price_updated else ""))
    if load.rule:
        print(f"  Mínimo stand by: {load.rule.min_m3:g} m³ × {load.rule.min_km:g} km × {load.rule.trips_per_month:g} viajes"
              f" = {load.rule.month_m3km:,.0f} m³-km/mes")
    for s in summary(load):
        print(f"  Acta {s['acta']:02d} ({s['periodo']}): {s['viajes']} viajes, {s['m3']} m³, km {s['km_min']}–{s['km_max']},"
              f" acta {s['m3km_acta']:,} vs cálculo {s['m3km_calculado']:,} m³-km (dif {s['diferencia']:,}"
              f" en {s['recibos_con_diferencia']} recibos) · terceros {s['terceros_m3km']:,}"
              + (f" · stand by {s['standby']['days']} días, mínimo {s['standby']['minimum']:,}, faltante {s['standby']['shortfall']:,}"
                 if s["standby"] else ""))
    print(f"  Pool diario: {len(load.reports)} partes de {len({r.plate for r in load.reports})} equipos")

    if a.dsn or a.sql:
        from .store import to_sql, write
        if a.sql:
            a.sql.write_text(to_sql(load), encoding="utf-8")
            print(f"SQL escrito en {a.sql}")
        if a.dsn:
            write(load, a.dsn)
            print("Base actualizada")


if __name__ == "__main__":
    main()
