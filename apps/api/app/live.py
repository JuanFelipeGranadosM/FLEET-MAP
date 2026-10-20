"""Difusión de eventos en vivo a todos los clientes WebSocket."""
import asyncio
import contextlib

from .domain.models import LiveStatus
from .providers.base import TelemetryProvider


class LiveHub:
    def __init__(self) -> None:
        self.queues: set[asyncio.Queue[LiveStatus]] = set()
        self._task: asyncio.Task | None = None

    def start(self, provider: TelemetryProvider) -> None:
        async def pump() -> None:
            async for ev in provider.live_events():
                for q in list(self.queues):
                    if q.full():  # cliente lento: se descarta el evento más viejo
                        q.get_nowait()
                    q.put_nowait(ev)
        self._task = asyncio.create_task(pump())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def subscribe(self) -> asyncio.Queue[LiveStatus]:
        q: asyncio.Queue[LiveStatus] = asyncio.Queue(maxsize=100)
        self.queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[LiveStatus]) -> None:
        self.queues.discard(q)
