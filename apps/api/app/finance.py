"""Facturación desde la base: repercusión real y presupuesto, tarifas por activo y actas de contratos.

Lee las tablas de db/002_operacion_facturacion.sql y db/003_repercusiones.sql. Se activa con
FLEETMAP_DATABASE_URL; sin ella los endpoints responden 503 y el resto de la API sigue igual.
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query

from .config import settings

router = APIRouter(prefix="/api/v1/finance", tags=["facturación"])


def _val(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, date):
        return v.isoformat()
    return v


def query(sql: str, params: dict | None = None) -> list[dict]:
    if not settings.database_url:
        raise HTTPException(503, "Sin base de datos: defina FLEETMAP_DATABASE_URL")
    import psycopg
    from psycopg.rows import dict_row

    try:
        with psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=5) as conn:
            return [{k: _val(v) for k, v in r.items()} for r in conn.execute(sql, params or {}).fetchall()]
    except psycopg.OperationalError as e:
        raise HTTPException(503, f"No se pudo conectar a la base: {e}") from e


def _range(frm: str | None, to: str | None) -> dict:
    return {"from": frm or "1900-01-01", "to": to or "2999-12-31"}


@router.get("/months")
def months() -> list[dict]:
    """Serie mensual: repercusión real, presupuesto y costes vs venta."""
    return query("""
        WITH r AS (
          SELECT period, sum(amount) FILTER (WHERE kind = 'real') AS real,
                 sum(amount) FILTER (WHERE kind = 'presupuesto') AS budget,
                 sum(hours_billed) FILTER (WHERE kind = 'real') AS real_hours,
                 count(DISTINCT asset_code) FILTER (WHERE kind = 'real') AS assets
          FROM repercussion GROUP BY period
        ), p AS (
          SELECT period, sum(amount) FILTER (WHERE concept = 'VENTA INCURRIDA') AS sales,
                 sum(amount) FILTER (WHERE concept = 'COSTE INCURRIDO') AS cost,
                 sum(amount) FILTER (WHERE concept = 'COSTE PPTO') AS cost_budget
          FROM monthly_pnl GROUP BY period
        )
        SELECT coalesce(r.period, p.period) AS period, r.real, r.budget, r.real_hours, r.assets,
               p.sales, p.cost, p.cost_budget
        FROM r FULL JOIN p ON p.period = r.period ORDER BY 1""")


@router.get("/groups")
def groups(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to")) -> list[dict]:
    """Real y presupuesto por obra grande (TM1 SUR, TM2 NORTE, PLANTAS…) en el rango."""
    return query("""
        SELECT coalesce(group_name, 'SIN PROYECTO') AS group_name,
               sum(amount) FILTER (WHERE kind = 'real') AS real, sum(amount) FILTER (WHERE kind = 'presupuesto') AS budget,
               sum(hours_billed) FILTER (WHERE kind = 'real') AS hours, count(DISTINCT asset_code) FILTER (WHERE kind = 'real') AS assets
        FROM repercussion WHERE period BETWEEN %(from)s AND %(to)s AND group_name IS DISTINCT FROM 'PPTO'
        GROUP BY 1 ORDER BY real DESC NULLS LAST""", _range(date_from, date_to))


@router.get("/projects")
def projects(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to"),
             group: str | None = None) -> list[dict]:
    """Repercusión real por proyecto / UF."""
    return query("""
        SELECT r.project_id, coalesce(p.short_name, r.project_name) AS name, r.group_name,
               sum(r.amount) AS real, sum(r.hours_billed) AS hours, count(DISTINCT r.asset_code) AS assets
        FROM repercussion r LEFT JOIN cost_project p ON p.id = r.project_id
        WHERE r.kind = 'real' AND r.period BETWEEN %(from)s AND %(to)s AND (%(group)s::text IS NULL OR r.group_name = %(group)s)
        GROUP BY 1, 2, 3 ORDER BY real DESC""", _range(date_from, date_to) | {"group": group})


@router.get("/families")
def families(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to")) -> list[dict]:
    """Real vs presupuesto por familia de equipo."""
    return query("""
        SELECT r.family_code, coalesce(f.name, r.family_code) AS name,
               sum(r.amount) FILTER (WHERE r.kind = 'real') AS real, sum(r.amount) FILTER (WHERE r.kind = 'presupuesto') AS budget,
               sum(r.hours_billed) FILTER (WHERE r.kind = 'real') AS real_hours,
               sum(r.hours_billed) FILTER (WHERE r.kind = 'presupuesto') AS budget_hours,
               -- real solo de los meses que tienen presupuesto, para medir cumplimiento
               sum(r.amount) FILTER (WHERE r.kind = 'real' AND r.period IN (SELECT period FROM repercussion WHERE kind = 'presupuesto'))
                 AS real_budgeted
        FROM repercussion r LEFT JOIN equipment_family f ON f.code = r.family_code
        WHERE r.period BETWEEN %(from)s AND %(to)s
        GROUP BY 1, 2 ORDER BY real DESC NULLS LAST""", _range(date_from, date_to))


@router.get("/assets")
def assets(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to")) -> list[dict]:
    """Maestro de activos con tarifa vigente, cambios de tarifa y repercusión del rango."""
    return query("""
        SELECT a.code, a.equipment_id, a.description, a.plate, a.family_code, f.name AS family, a.rate_hour,
               (SELECT count(*) FROM asset_rate ar WHERE ar.asset_code = a.code) AS rate_changes,
               t.real, t.hours, t.last_period, t.last_group,
               d.end_of_use, d.net_book_value
        FROM asset a
        LEFT JOIN equipment_family f ON f.code = a.family_code
        LEFT JOIN asset_disposal d ON d.asset_code = a.code
        LEFT JOIN LATERAL (
          SELECT sum(r.amount) AS real, sum(r.hours_billed) AS hours, max(r.period) AS last_period,
                 (array_agg(r.group_name ORDER BY r.period DESC))[1] AS last_group
          FROM repercussion r WHERE r.asset_code = a.code AND r.kind = 'real' AND r.period BETWEEN %(from)s AND %(to)s
        ) t ON true
        ORDER BY t.real DESC NULLS LAST, a.code""", _range(date_from, date_to))


@router.get("/assets/{code}")
def asset_detail(code: str) -> dict:
    rows = query("SELECT code, equipment_id, description, plate, family_code, rate_hour FROM asset WHERE code = %(c)s OR equipment_id = %(c)s",
                 {"c": code})
    if not rows:
        raise HTTPException(404, f"Activo {code} no existe")
    a = rows[0]
    a["rates"] = query("SELECT valid_from, rate_hour FROM asset_rate WHERE asset_code = %(c)s ORDER BY valid_from", {"c": a["code"]})
    a["months"] = query("""
        SELECT period, kind, sum(hours_billed) AS hours, sum(amount) AS amount, string_agg(DISTINCT group_name, ', ') AS groups
        FROM repercussion WHERE asset_code = %(c)s GROUP BY 1, 2 ORDER BY 1""", {"c": a["code"]})
    return a


@router.get("/contracts")
def contracts() -> list[dict]:
    """Contratos con sus tarifas, actas (cobrado vs calculado) y stand by por cupo."""
    out = query("""
        SELECT c.id, c.order_no, cl.name AS client, ct.name AS contractor, c.object, c.start_date, c.end_date, c.value
        FROM contract c JOIN party cl ON cl.id = c.client_id JOIN party ct ON ct.id = c.contractor_id ORDER BY c.start_date""")
    for c in out:
        p = {"c": c["id"]}
        c["tariffs"] = query("""
            SELECT t.item_code, i.description, i.unit, t.unit_price, t.qty, t.source, t.in_force, t.valid_from
            FROM tariff t JOIN contract_item i ON i.contract_id = t.contract_id AND i.code = t.item_code
            WHERE t.contract_id = %(c)s ORDER BY t.valid_from, t.in_force DESC""", p)
        c["cuts"] = query("""
            SELECT b.number, b.period_from, b.period_to, b.status, l.qty_billed, l.qty_validated, l.unit_price, l.amount,
                   r.trips, r.m3, r.km_min, r.km_max, r.m3km_billed, r.m3km_calc, r.m3km_diff, r.tickets_with_diff,
                   s.minimum, s.executed, s.shortfall, s.days
            FROM billing_cut b
            LEFT JOIN billing_cut_line l ON l.contract_id = b.contract_id AND l.cut_number = b.number AND l.concept = 'ejecutado'
            LEFT JOIN v_cut_reconciliation r ON r.contract_id = b.contract_id AND r.cut_number = b.number
            LEFT JOIN LATERAL (
              SELECT sum(minimum_m3km) AS minimum, sum(executed_m3km) AS executed, sum(shortfall_m3km) AS shortfall,
                     sum(days_available) AS days
              FROM v_standby v WHERE v.contract_id = b.contract_id AND v.cut_number = b.number
            ) s ON true
            WHERE b.contract_id = %(c)s ORDER BY b.number""", p)
        c["standby"] = query("""
            SELECT cut_number, slot, plates, days_available, minimum_m3km, executed_m3km, trips, shortfall_m3km
            FROM v_standby WHERE contract_id = %(c)s ORDER BY cut_number, slot""", p)
    return out
