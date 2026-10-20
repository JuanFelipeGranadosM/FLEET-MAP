"""FleetMap API · telemetría de flota, métricas diarias, facturación y estado en vivo."""
from contextlib import asynccontextmanager
from datetime import date, timedelta

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import settings
from .domain import catalog as cat
from .domain.billing import compute_billing
from .domain.models import Billing, DailyMetrics, Equipment, LiveStatus
from .live import LiveHub
from .providers.base import TelemetryProvider


def make_provider() -> TelemetryProvider:
    if settings.provider == "aemp":
        from .providers.aemp import AempTelemetryProvider
        return AempTelemetryProvider(settings)
    from .providers.mock import MockTelemetryProvider
    return MockTelemetryProvider(settings.today, settings.history_days)


provider = make_provider()
hub = LiveHub()


@asynccontextmanager
async def lifespan(_: FastAPI):
    hub.start(provider)
    yield
    await hub.stop()


app = FastAPI(title="FleetMap API", version="0.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"])


def _default_range(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    to = date_to or settings.today
    frm = date_from or (date.fromisoformat(settings.today) - timedelta(days=settings.history_days)).isoformat()
    return frm, to


@app.get("/api/v1/health")
async def health() -> dict:
    return {"ok": True, "provider": settings.provider}


@app.get("/api/v1/catalog")
async def catalog() -> dict:
    return {
        "currency": "USD", "today": settings.today, "historyDays": settings.history_days,
        "standbyFactor": cat.STANDBY_FACTOR, "bbox": cat.BBOX, "types": cat.TYPES, "clients": cat.CLIENTS,
        "sites": cat.SITES, "roads": [], "states": cat.STATES,
    }


@app.get("/api/v1/fleet", response_model=list[Equipment], response_model_by_alias=True)
async def fleet() -> list[Equipment]:
    return await provider.get_fleet()


@app.get("/api/v1/metrics/daily", response_model=DailyMetrics, response_model_by_alias=True)
async def daily(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to")) -> DailyMetrics:
    return await provider.get_daily_metrics(*_default_range(date_from, date_to))


@app.get("/api/v1/live", response_model=list[LiveStatus], response_model_by_alias=True)
async def live() -> list[LiveStatus]:
    return await provider.get_live_status()


@app.get("/api/v1/equipment/{eq_id}/billing", response_model=Billing, response_model_by_alias=True)
async def billing(eq_id: str, date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to")) -> Billing:
    frm, to = _default_range(date_from, date_to)
    eqs = {eq.id: eq for eq in await provider.get_fleet()}
    if eq_id not in eqs:
        raise HTTPException(404, f"Equipo {eq_id} no existe")
    m = await provider.get_daily_metrics(frm, to)
    e, n = m.equipment_ids.index(eq_id), len(m.days)
    sl = slice(e * n, (e + 1) * n)
    return compute_billing(eqs[eq_id], sum(m.work[sl]), sum(m.standby[sl]), sum(m.down[sl]), m.days[0], m.days[-1])


@app.websocket("/api/v1/live/ws")
async def live_ws(ws: WebSocket) -> None:
    await ws.accept()
    q = hub.subscribe()
    try:
        while True:
            ev = await q.get()
            await ws.send_json(ev.model_dump(by_alias=True))
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(q)
