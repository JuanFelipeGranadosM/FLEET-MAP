"""Reglas de facturación de acarreo por m³-km (contratos de transporte de mezcla con Consorcio BMC).

cantidad del viaje  = m³ del recibo × km de acarreo, redondeado al entero (así lo liquida el acta)
mínimo garantizado  = m³ mínimos × km mínimos × viajes por mes, prorrateado por días disponibles / 30
stand by            = mínimo garantizado − ejecutado, si es positivo
Los equipos que se relevan dentro del corte (sale un tractocamión y entra otro con el mismo operador) cuentan como un solo cupo.
"""
from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class StandbyRule:
    min_m3: float
    min_km: float
    trips_per_month: float
    days_per_month: int = 30

    @property
    def month_m3km(self) -> float:
        return self.min_m3 * self.min_km * self.trips_per_month

    def minimum(self, days_available: int) -> float:
        return self.month_m3km * days_available / self.days_per_month


def m3km(m3: float, km: float) -> int:
    # medio hacia arriba, como el redondeo de Excel (round() de Python redondea al par)
    return int(m3 * km + 0.5)


@dataclass(frozen=True)
class SlotResult:
    slot: str
    plates: tuple[str, ...]
    days_available: int
    minimum: float
    executed: int
    trips: int

    @property
    def shortfall(self) -> float:
        return max(self.minimum - self.executed, 0.0)


def standby_by_slot(rule: StandbyRule, windows: list[dict], tickets: list[dict]) -> list[SlotResult]:
    """windows: {plate, slot, days_available}; tickets: {plate, m3, haul_km, billable}."""
    slots: dict[str, dict] = defaultdict(lambda: {"plates": [], "days": 0})
    for w in windows:
        s = slots[w["slot"]]
        s["plates"].append(w["plate"])
        s["days"] += w["days_available"]
    out = []
    for name, s in slots.items():
        mine = [t for t in tickets if t.get("billable", True) and t["plate"] in s["plates"]]
        out.append(SlotResult(
            slot=name, plates=tuple(s["plates"]), days_available=s["days"], minimum=rule.minimum(s["days"]),
            executed=sum(m3km(t["m3"], t["haul_km"]) for t in mine), trips=len(mine),
        ))
    return out
