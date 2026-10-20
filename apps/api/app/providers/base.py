"""Contrato común de telemetría. La API y la web sólo conocen esta interfaz."""
from collections.abc import AsyncIterator
from typing import Protocol

from ..domain.models import DailyMetrics, Equipment, LiveStatus


class TelemetryProvider(Protocol):
    async def get_fleet(self) -> list[Equipment]: ...

    async def get_daily_metrics(self, date_from: str, date_to: str) -> DailyMetrics: ...

    async def get_live_status(self) -> list[LiveStatus]: ...

    def live_events(self) -> AsyncIterator[LiveStatus]:
        """Flujo de cambios de estado (simulado, websocket del OEM o sondeo AEMP)."""
        ...
