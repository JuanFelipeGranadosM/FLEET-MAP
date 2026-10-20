"""Reglas de facturación (fuente de verdad del servidor).

horas trabajadas = horómetro (motor encendido, incluye ralentí)
standby          = horas de turno con el equipo disponible y sin operar
facturación      = trabajadas × tarifa + standby × tarifa × factor_standby
no facturado     = (trabajadas + standby + avería) × tarifa − facturación
"""
from .models import Billing, BillingLine, Equipment


def compute_billing(eq: Equipment, work: float, standby: float, down: float, date_from: str, date_to: str) -> Billing:
    lines = [
        BillingLine(concept="Horas trabajadas", hours=round(work, 2), rate=eq.rate, factor=1.0, amount=round(work * eq.rate, 2)),
        BillingLine(concept="Standby", hours=round(standby, 2), rate=eq.rate, factor=eq.standby_factor, amount=round(standby * eq.rate * eq.standby_factor, 2)),
    ]
    total = sum(line.amount for line in lines)
    potential = round((work + standby + down) * eq.rate, 2)
    avail = work + standby + down
    return Billing(
        equipment_id=eq.id, date_from=date_from, date_to=date_to, lines=lines,
        total=round(total, 2), potential=potential, not_billed=round(potential - total, 2),
        utilization=round(work / avail, 4) if avail else 0.0,
    )
