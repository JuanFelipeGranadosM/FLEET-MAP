from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

State = Literal["op", "idle", "standby", "down", "off"]


class Api(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Equipment(Api):
    id: str
    pin: str
    oem: str
    model: str
    type_id: str
    site_id: str
    client_id: str
    lat: float
    lon: float
    rate: float
    standby_factor: float
    year: int
    hour_meter: float
    route: list[list[float]] | None = None


class LiveStatus(Api):
    id: str
    state: State
    lat: float
    lon: float
    ts: int  # epoch ms
    fault: str | None = None
    prev: State | None = None


class DailyMetrics(Api):
    """Series en columnas: índice = equipo * len(days) + día."""
    days: list[str]
    equipment_ids: list[str]
    work: list[float]
    idle: list[float]
    standby: list[float]
    down: list[float]
    fuel: list[float]


class BillingLine(Api):
    concept: str
    hours: float
    rate: float
    factor: float
    amount: float


class Billing(Api):
    equipment_id: str
    date_from: str
    date_to: str
    currency: str = "USD"
    lines: list[BillingLine]
    total: float
    potential: float
    not_billed: float
    utilization: float
