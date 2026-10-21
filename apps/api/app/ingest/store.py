"""Escritura idempotente en PostgreSQL de lo que lee `bmc.py` (002_operacion_facturacion.sql).

Todo es INSERT … ON CONFLICT DO UPDATE: volver a cargar el mismo corte actualiza, no duplica.
`to_sql` produce el script y `write` lo ejecuta en una sola transacción.
"""
from __future__ import annotations

from datetime import date, time

from .bmc import Load, _slug

TRUCK_TYPE = "TRACTOCAMIONES"


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (date, time)):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


def upsert(table: str, row: dict, key: tuple[str, ...]) -> str:
    cols = list(row)
    upd = [c for c in cols if c not in key]
    tail = (f"DO UPDATE SET {', '.join(f'{c} = EXCLUDED.{c}' for c in upd)}" if upd else "DO NOTHING")
    return (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(lit(row[c]) for c in cols)}) "
            f"ON CONFLICT ({', '.join(key)}) {tail};")


def _party_id(name: str) -> str:
    n = _slug(name)
    if n.startswith("ORTIZ") or n in {"G-ORTIZ", "GRUPO-ORTIZ"}:
        return "ORTIZ"
    return n


def statements(load: Load) -> list[str]:
    out: list[str] = []
    c = load.contract
    parties = {}
    if c:
        parties[_party_id(c.client)] = c.client
        parties[_party_id(c.contractor)] = c.contractor
    for t in load.tickets:
        parties.setdefault(_party_id(t.supplier), t.supplier)
    for pid, name in parties.items():
        out.append(upsert("party", {"id": pid, "name": name}, ("id",)))

    # Equipos propios: id = código interno (mismo id que usa el libro de arranque), PIN = placa
    plates = {r.plate for r in load.reports} | {t.plate for t in load.tickets if t.billable} | {w.plate for w in load.windows}
    eq_id = {}
    for p in sorted(plates):
        eq_id[p] = load.equipment.get(p, p)
        out.append(upsert("equipment", {"id": eq_id[p], "pin": p, "plate": p, "code": load.equipment.get(p),
                                         "type_id": TRUCK_TYPE, "owner_id": "ORTIZ", "model": "Tractocamión"}, ("id",)))

    drivers = {r.driver for r in load.reports if r.driver} | set(load.operators)
    for name in sorted(drivers):
        out.append(upsert("operator", {"name": name, "document": load.operators.get(name)}, ("name",)))

    if c:
        out.append(upsert("contract", {
            "id": c.id, "order_no": c.order_no, "client_id": _party_id(c.client), "contractor_id": _party_id(c.contractor),
            "object": c.object, "cost_center": c.cost_center, "start_date": c.start, "end_date": c.end, "value": c.value,
        }, ("id",)))
        for it in load.items:
            out.append(upsert("contract_item", {"contract_id": c.id, "code": it.code, "description": it.description,
                                                "unit": it.unit, "qty_contract": it.qty_updated or it.qty}, ("contract_id", "code")))
            out.append(upsert("tariff", {"contract_id": c.id, "item_code": it.code, "valid_from": c.start, "unit_price": it.price,
                                         "qty": it.qty, "source": "Contrato inicial", "in_force": True},
                              ("contract_id", "item_code", "valid_from", "source")))
            if it.price_updated and it.price_updated != it.price:
                # El acta sigue liquidando al precio inicial: el del otrosí queda registrado sin vigencia confirmada
                out.append(upsert("tariff", {"contract_id": c.id, "item_code": it.code, "valid_from": c.start,
                                             "unit_price": it.price_updated, "qty": it.qty_updated, "source": "Otrosí No. 01",
                                             "in_force": False}, ("contract_id", "item_code", "valid_from", "source")))
        if load.rule and load.rule_item:
            r = load.rule
            out.append(upsert("standby_rule", {"contract_id": c.id, "item_code": load.rule_item, "min_m3": r.min_m3,
                                               "min_km": r.min_km, "trips_per_month": r.trips_per_month,
                                               "days_per_month": r.days_per_month}, ("contract_id", "item_code")))
        price = load.items[0].price if load.items else None
        for n, cut in sorted(load.cuts.items()):
            out.append(upsert("billing_cut", {"contract_id": c.id, "number": n, "period_from": cut.period_from,
                                              "period_to": cut.period_to, "prepared_on": cut.prepared_on,
                                              "status": cut.status, "note": cut.note}, ("contract_id", "number")))
            mine = [t for t in load.tickets if t.cut_number == n and t.billable]
            if load.rule_item and price is not None and mine:
                billed = cut.qty_billed or sum(t.m3km_billed or 0 for t in mine)
                out.append(upsert("billing_cut_line", {"contract_id": c.id, "cut_number": n, "item_code": load.rule_item,
                                                       "concept": "ejecutado", "qty_billed": round(billed),
                                                       "qty_validated": sum(t.m3km_calc for t in mine), "unit_price": price},
                                  ("contract_id", "cut_number", "item_code", "concept")))
        for t in load.tickets:
            out.append(upsert("haul_ticket", {
                "contract_id": c.id, "cut_number": t.cut_number, "ticket_no": t.ticket_no, "day": t.day, "plate": t.plate,
                "equipment_id": eq_id.get(t.plate) if t.billable else None, "supplier_id": _party_id(t.supplier),
                "driver": t.driver, "m3": t.m3, "route_code": t.route_code, "unload_station": t.unload_station,
                "origin": t.origin, "destination": t.destination, "haul_km": t.haul_km, "m3km_billed": t.m3km_billed,
                "activity": t.activity, "billable": t.billable, "note": t.note,
            }, ("contract_id", "ticket_no", "plate", "day")))
        for w in load.windows:
            out.append(upsert("standby_window", {
                "contract_id": c.id, "cut_number": w.cut_number, "equipment_id": eq_id.get(w.plate, w.plate), "slot": w.slot,
                "date_from": w.date_from, "date_to": w.date_to, "days_available": w.days_available,
                "workshop_days": w.workshop_days, "note": w.note,
            }, ("contract_id", "cut_number", "equipment_id")))

    for r in load.reports:
        op = f"(SELECT id FROM operator WHERE name = {lit(r.driver)})" if r.driver else "NULL"
        row = {"equipment_id": eq_id.get(r.plate, r.plate), "day": r.day, "report_no": r.report_no, "operator_id": "__OP__",
               "status": r.status, "odometer_start": r.odometer_start, "odometer_end": r.odometer_end,
               "shift_start": r.shift_start, "shift_end": r.shift_end, "m3": r.m3, "trips": r.trips, "route": r.route,
               "origin": r.origin, "destination": r.destination, "note": r.note, "source": "BMC_1.xlsx"}
        out.append(upsert("daily_report", row, ("equipment_id", "day")).replace("'__OP__'", op))
    return out


def to_sql(load: Load) -> str:
    return "BEGIN;\n" + "\n".join(statements(load)) + "\nCOMMIT;\n"


def write(load: Load, dsn: str) -> None:
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        for s in statements(load):
            cur.execute(s)

