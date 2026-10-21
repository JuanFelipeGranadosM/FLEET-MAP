"""Carga del histórico de repercusiones de maquinaria (libro "DATOS INFORME MASTER").

Hojas: HISTORICO (actas mensuales reales y presupuesto), LISTA DE EQUIPOS (tarifa hora vigente y placa),
LISTA DE PROYECTOS (proyecto → obra grande), LISTA FAMILIAS, COSTES VS VENTA y RETOMAS.
Si HISTORICO no trae el presupuesto se toma de la hoja PTTO VENTA.

Uso:
    python -m app.ingest.repercusiones "DATOS INFORME MASTER.xlsx" [--dsn postgresql://…] [--sql salida.sql]
Sin --dsn ni --sql imprime el resumen por mes y el cuadre contra COSTES VS VENTA.
Volver a cargar reemplaza los meses que trae el libro; los demás meses quedan como estaban.
"""
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import openpyxl

from .bmc import _day, _norm, _num
from .store import lit, upsert

PREFIX = "40BU"


def short_code(code: str) -> str:
    """'40BUP0TC009' → 'P0TC009' (código del libro de arranque)."""
    return code[len(PREFIX):] if code.startswith(PREFIX) and len(code) > len(PREFIX) else code


def _str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


@dataclass
class Line:
    period: date
    kind: str
    asset: str
    description: str | None
    hours: float | None
    pct: float | None
    hours_billed: float | None
    rate: float | None
    amount: float
    project_id: str | None
    project_name: str | None
    cost_center: str | None
    family: str | None
    group: str | None
    income_type: str | None
    row: int


@dataclass
class Book:
    families: dict[str, str] = field(default_factory=dict)
    projects: dict[str, dict] = field(default_factory=dict)
    assets: dict[str, dict] = field(default_factory=dict)
    lines: list[Line] = field(default_factory=list)
    pnl: dict[tuple[date, str], float] = field(default_factory=dict)
    disposals: dict[str, dict] = field(default_factory=dict)


def _rows(wb, name):
    return list(wb[name].iter_rows(values_only=True)) if name in wb.sheetnames else []


def _header(rows, must: str) -> tuple[int, list[str]]:
    for i, r in enumerate(rows[:10]):
        h = [_norm(v) for v in r]
        if _norm(must) in h:
            return i, h
    raise ValueError(f"No encontré la columna {must}")


def _col(h: list[str], *names: str) -> int | None:
    for n in names:
        for i, x in enumerate(h):
            if x == _norm(n) or x.startswith(_norm(n)):
                return i
    return None


def parse_lines(rows, kind_from_sheet: str | None = None) -> list[Line]:
    hi, h = _header(rows, "CODIGO EQUIPO")
    c = {k: _col(h, *names) for k, names in {
        "period": ("CORTE",), "kind": ("TIPO DE COSTE",), "desc": ("TIPO DE EQUIPO",), "asset": ("CODIGO EQUIPO",),
        "hours": ("HORAS",), "pct": ("%",), "billed": ("TOTAL HORAS",), "rate": ("TARIFA HORA",),
        "amount": ("TOTAL REPERCUSION",), "pname": ("NOMBRE PROYECTO",), "pid": ("PROYECTO DESTINO",),
        "cc": ("CENTRO DE COSTO",), "fam": ("FAMILIA",), "group": ("PROYECTO",), "income": ("TIPO DE INGRESO",),
    }.items()}
    # "PROYECTO" también es prefijo de "PROYECTO DESTINO": la obra grande es la columna exacta
    c["group"] = next((i for i, x in enumerate(h) if x == "PROYECTO"), c["group"])
    c["hours"] = next((i for i, x in enumerate(h) if x == "HORAS"), c["hours"])
    out = []
    for n, r in enumerate(rows[hi + 1:], start=hi + 2):
        g = lambda k: r[c[k]] if c[k] is not None and c[k] < len(r) else None  # noqa: E731
        period, asset = _day(g("period")), _str(g("asset"))
        billed, rate, amount = _num(g("billed")), _num(g("rate")), _num(g("amount"))
        if not (period and asset and amount is not None):
            continue
        kind_raw = _norm(g("kind") or kind_from_sheet)
        out.append(Line(
            period=period.replace(day=1), kind="presupuesto" if "PTTO" in kind_raw or "PPTO" in kind_raw else "real",
            asset=asset, description=_str(g("desc")), hours=_num(g("hours")), pct=_num(g("pct")), hours_billed=billed,
            rate=rate, amount=amount, project_id=_str(g("pid")), project_name=_str(g("pname")), cost_center=_str(g("cc")),
            family=_str(g("fam")), group=_str(g("group")), income_type=_str(g("income")), row=n,
        ))
    return out


def parse(path: Path) -> Book:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    b = Book()
    for r in _rows(wb, "LISTA FAMILIAS"):
        if _str(r[0]) and _str(r[1]):
            b.families[_str(r[0])] = _str(r[1])

    rows = _rows(wb, "LISTA DE PROYECTOS")
    if rows:
        hi, h = _header(rows, "No PROYECTO")
        for r in rows[hi + 1:]:
            pid = _str(r[0])
            if pid:
                b.projects[pid] = {"short_name": _str(r[1]), "name": _str(r[2]), "management_control": _str(r[3]),
                                   "site_manager": _str(r[4]), "production_manager": _str(r[5]), "group_name": _str(r[6])}

    rows = _rows(wb, "LISTA DE EQUIPOS")
    if rows:
        hi, h = _header(rows, "CODIGO EQUIPO")
        plate_cols = [i for i, x in enumerate(h) if x == "PLACA"]
        for r in rows[hi + 1:]:
            code = _str(r[0])
            if not code:
                continue
            plate = next((_str(r[i]) for i in reversed(plate_cols) if i < len(r) and _str(r[i]) not in (None, "N/A")), None)
            b.assets[code] = {"description": _str(r[2]), "rate_hour": _num(r[1]), "plate": plate,
                              "gps": _str(r[_col(h, "GPS")]) if _col(h, "GPS") is not None else None}

    hist = _rows(wb, "HISTORICO")
    if hist:
        b.lines = parse_lines(hist)
    if not any(x.kind == "presupuesto" for x in b.lines) and "PTTO VENTA" in wb.sheetnames:
        b.lines += parse_lines(_rows(wb, "PTTO VENTA"), "PTTO VENTA")

    for r in _rows(wb, "COSTES VS VENTA")[1:]:
        d, concept, amount = _day(r[0]), _str(r[1]), _num(r[2])
        if d and concept and amount is not None:
            b.pnl[(d.replace(day=1), concept)] = amount

    rows = _rows(wb, "RETOMAS")
    if rows:
        hi, h = _header(rows, "CECO")
        cols = {
            "subfamily": "SUB-FAMILIA", "asset_group": "GRUPO", "hours_histogram": "PRO HISTOGRAMA", "hours_total": "PRO TOTAL",
            "hour_meter": "HOROMETRO", "end_of_use": "FECHA FIN USO", "sale_date": "FECHA VENTA",
            "acquisition_cost": "COSTO DE ADQUISICION", "accumulated_amortization": "AMORTIZACION ACUMULADA",
            "net_book_value": "VALOR NETO CONTABLE", "book_gain": "P/G CONTABLE", "retake_pct": "% RETOMA",
            "retake_value": "VALOR RETOMA", "sales_made": "VENTAS REALIZADAS", "projected_sale": "VENTEA PROYECTADA",
            "market_sale": "VENTA AL MERCADO", "buyer": "COMPRADOR", "fixed_cost_month": "COSTE FIJO MES",
            "rent_month": "ALQUILER MES",
        }
        ix = {k: _col(h, v) for k, v in cols.items()}
        ceco = h.index("CECO")
        for r in rows[hi + 1:]:
            code = _str(r[ceco])
            if not code:
                continue
            rec = {}
            for k, i in ix.items():
                v = r[i] if i is not None and i < len(r) else None
                rec[k] = _day(v) if k in ("end_of_use", "sale_date") else (_str(v) if k in ("subfamily", "asset_group", "buyer") else _num(v))
            b.disposals[code] = rec
    return b


def rate_history(lines: list[Line]) -> list[tuple[str, date, float]]:
    """Cambios de tarifa por activo en las actas reales: (activo, desde, tarifa)."""
    by_asset: dict[str, dict[date, set[float]]] = defaultdict(lambda: defaultdict(set))
    for x in lines:
        if x.kind == "real" and x.rate:
            by_asset[x.asset][x.period].add(x.rate)
    out = []
    for asset, months in by_asset.items():
        prev: set[float] = set()
        for period in sorted(months):
            rates = months[period]
            for r in sorted(rates - prev):
                out.append((asset, period, r))
            prev = rates
    return out


def summary(b: Book) -> list[dict]:
    tot: dict[tuple[date, str], float] = defaultdict(float)
    for x in b.lines:
        tot[(x.period, x.kind)] += x.amount
    out = []
    for p in sorted({k[0] for k in tot}):
        venta = b.pnl.get((p, "VENTA INCURRIDA"))
        out.append({"mes": p.isoformat()[:7], "real": round(tot.get((p, "real"), 0)), "presupuesto": round(tot.get((p, "presupuesto"), 0)),
                    "venta_incurrida": round(venta) if venta is not None else None,
                    "cuadra": venta is None or abs(venta - tot.get((p, "real"), 0)) < 1})
    return out


def statements(b: Book) -> list[str]:
    out = []
    fams = dict(b.families)
    for x in b.lines:
        if x.family and x.family not in fams:
            fams[x.family] = x.family
    for code, name in sorted(fams.items()):
        out.append(upsert("equipment_family", {"code": code, "name": name}, ("code",)))

    projects = dict(b.projects)
    for x in b.lines:
        if x.project_id and x.project_id not in projects:
            projects[x.project_id] = {"short_name": x.project_name, "group_name": x.group}
    for pid, p in sorted(projects.items()):
        out.append(upsert("cost_project", {"id": pid, **{k: p.get(k) for k in (
            "short_name", "name", "group_name", "management_control", "site_manager", "production_manager")}}, ("id",)))

    assets = {k: dict(v) for k, v in b.assets.items()}
    for x in b.lines:
        a = assets.setdefault(x.asset, {"description": x.description, "rate_hour": None, "plate": None, "gps": None})
        a.setdefault("family", x.family)
        a["family"] = a.get("family") or x.family
        a["description"] = a.get("description") or x.description
    for code in b.disposals:
        assets.setdefault(code, {"description": b.disposals[code].get("subfamily"), "rate_hour": None, "plate": None, "gps": None})
    for code, a in sorted(assets.items()):
        fam = a.get("family") or (code[len(PREFIX):len(PREFIX) + 4] if code.startswith(PREFIX) else None)
        out.append(upsert("asset", {"code": code, "equipment_id": short_code(code), "description": a.get("description"),
                                    "family_code": fam if fam in fams else None, "plate": a.get("plate"),
                                    "rate_hour": a.get("rate_hour"), "gps": a.get("gps")}, ("code",)))

    for asset, since, rate in rate_history(b.lines):
        out.append(upsert("asset_rate", {"asset_code": asset, "valid_from": since, "rate_hour": rate},
                          ("asset_code", "valid_from", "rate_hour")))

    # Reemplaza los meses que trae el libro, por tipo
    for kind in ("real", "presupuesto"):
        ps = [x.period for x in b.lines if x.kind == kind]
        if ps:
            out.append(f"DELETE FROM repercussion WHERE kind = {lit(kind)} AND period BETWEEN {lit(min(ps))} AND {lit(max(ps))};")
    cols = ["period", "kind", "asset_code", "description", "hours", "pct", "hours_billed", "rate_hour", "amount",
            "project_id", "project_name", "cost_center", "family_code", "group_name", "income_type", "source_row"]
    for i in range(0, len(b.lines), 500):
        vals = ",\n".join("(" + ", ".join(lit(v) for v in (
            x.period, x.kind, x.asset, x.description, x.hours, x.pct, x.hours_billed, x.rate, x.amount, x.project_id,
            x.project_name, x.cost_center, x.family if x.family in fams else None, x.group, x.income_type, x.row)) + ")"
            for x in b.lines[i:i + 500])
        out.append(f"INSERT INTO repercussion ({', '.join(cols)}) VALUES\n{vals};")

    for (p, concept), amount in sorted(b.pnl.items()):
        out.append(upsert("monthly_pnl", {"period": p, "concept": concept, "amount": amount}, ("period", "concept")))
    for code, rec in sorted(b.disposals.items()):
        out.append(upsert("asset_disposal", {"asset_code": code, **rec}, ("asset_code",)))
    return out


def to_sql(b: Book) -> str:
    return "BEGIN;\n" + "\n".join(statements(b)) + "\nCOMMIT;\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("libro", type=Path)
    ap.add_argument("--dsn")
    ap.add_argument("--sql", type=Path)
    a = ap.parse_args(argv)
    b = parse(a.libro)
    real = [x for x in b.lines if x.kind == "real"]
    ppto = [x for x in b.lines if x.kind == "presupuesto"]
    print(f"{len(b.assets)} activos en la lista · {len(b.projects)} proyectos · {len(b.families)} familias · {len(b.disposals)} retomas")
    if real:
        print(f"Real: {len(real)} líneas, {min(x.period for x in real)} a {max(x.period for x in real)},"
              f" {sum(x.hours_billed or 0 for x in real):,.0f} h, ${sum(x.amount for x in real):,.0f}")
    if ppto:
        print(f"Presupuesto: {len(ppto)} líneas, {min(x.period for x in ppto)} a {max(x.period for x in ppto)},"
              f" ${sum(x.amount for x in ppto):,.0f}")
    print(f"Cambios de tarifa: {len(rate_history(b.lines))} vigencias en {len({r[0] for r in rate_history(b.lines)})} activos")
    bad = [x for x in b.lines if x.rate is not None and abs((x.hours_billed or 0) * x.rate - x.amount) > 1]
    print(f"Líneas donde horas × tarifa ≠ total: {len(bad)}")
    for s in summary(b):
        flag = "" if s["cuadra"] else "  ← no cuadra con COSTES VS VENTA"
        print(f"  {s['mes']}: real ${s['real']:,} · ppto ${s['presupuesto']:,}"
              + (f" · venta incurrida ${s['venta_incurrida']:,}" if s["venta_incurrida"] is not None else "") + flag)
    if a.sql:
        a.sql.write_text(to_sql(b), encoding="utf-8")
        print(f"SQL escrito en {a.sql}")
    if a.dsn:
        import psycopg

        with psycopg.connect(a.dsn) as conn, conn.cursor() as cur:
            for s in statements(b):
                cur.execute(s)
        print("Base actualizada")


if __name__ == "__main__":
    main()
