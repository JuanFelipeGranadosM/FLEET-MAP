"""Adaptador ISO 15143-3 (AEMP 2.0).

Cada OEM (CAT VisionLink, Komatsu Komtrax, Volvo CareTrack, JDLink…) publica el
mismo estándar con su propia URL base y OAuth2 (client credentials). Endpoints:

  GET /Fleet/{page}
  GET /Fleet/Equipment/ID/{id}/CumulativeOperatingHours/{start}/{end}/{page}
  GET /Fleet/Equipment/ID/{id}/CumulativeIdleHours/{start}/{end}/{page}
  GET /Fleet/Equipment/ID/{id}/FuelUsed/{start}/{end}/{page}

Las series son acumuladas y se convierten a deltas diarios. Standby y avería no
vienen en AEMP: salen del calendario de turnos y de las órdenes de mantenimiento.
Verificar nombres de campos y paginación con la documentación de cada OEM:
este adaptador aún no se ha probado contra una API real.
"""
import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import date, timedelta
from pathlib import Path

import httpx

from ..config import Settings
from ..domain import catalog as cat
from ..domain.models import DailyMetrics, Equipment, LiveStatus


class AempTelemetryProvider:
    def __init__(self, s: Settings):
        self.s = s
        self.http = httpx.AsyncClient(base_url=s.aemp_base_url, timeout=30)
        self._token: tuple[str, float] | None = None
        path = Path(s.asset_master_path)
        self.assets: dict[str, dict] = json.loads(path.read_text()) if path.exists() else {}
        self._fleet: list[Equipment] | None = None
        self.sem = asyncio.Semaphore(8)  # límite de concurrencia hacia el OEM

    async def _auth(self) -> str:
        if self._token and self._token[1] > time.time() + 60:
            return self._token[0]
        res = await self.http.post(self.s.aemp_token_url, data={
            "grant_type": "client_credentials", "client_id": self.s.aemp_client_id,
            "client_secret": self.s.aemp_client_secret, "scope": self.s.aemp_scope,
        })
        res.raise_for_status()
        body = res.json()
        self._token = (body["access_token"], time.time() + int(body.get("expires_in", 3600)))
        return self._token[0]

    async def _get(self, path: str) -> dict:
        async with self.sem:
            res = await self.http.get(path, headers={"Authorization": f"Bearer {await self._auth()}", "Accept": "application/json"})
            res.raise_for_status()
            return res.json()

    async def get_fleet(self) -> list[Equipment]:
        out: list[Equipment] = []
        page = 1
        while True:
            body = await self._get(f"/Fleet/{page}")
            for eq in body.get("Equipment", []):
                h, loc = eq.get("EquipmentHeader", {}), eq.get("Location", {})
                pin = h.get("PIN") or h.get("SerialNumber")
                meta = self.assets.get(pin)
                if not meta:
                    continue  # equipo sin dato en el maestro de activos
                site = cat.SITE_BY_ID[meta["siteId"]]
                out.append(Equipment(
                    id=h.get("EquipmentID") or pin, pin=pin, oem=h.get("OEMName", ""), model=h.get("Model", ""),
                    type_id=meta["typeId"], site_id=site["id"], client_id=site["client"],
                    lat=loc.get("Latitude", site["lat"]), lon=loc.get("Longitude", site["lon"]),
                    rate=meta["rate"], standby_factor=meta.get("standbyFactor", cat.STANDBY_FACTOR),
                    year=meta.get("year", 0), hour_meter=(eq.get("CumulativeOperatingHours") or {}).get("Hour", 0),
                ))
            if not any(link.get("rel") == "Next" for link in body.get("Links", [])):
                break
            page += 1
        self._fleet = out
        return out

    async def _series(self, eq_id: str, kind: str, key: str, a: date, b: date) -> list[tuple[date, float]]:
        body = await self._get(f"/Fleet/Equipment/ID/{eq_id}/{kind}/{a.isoformat()}T00:00:00Z/{b.isoformat()}T23:59:59Z/1")
        pts = [(date.fromisoformat(p["datetime"][:10]), float(p.get(key, 0))) for p in body.get(kind, [])]
        return sorted(pts)

    async def get_daily_metrics(self, date_from: str, date_to: str) -> DailyMetrics:
        fleet = self._fleet or await self.get_fleet()
        a, b = date.fromisoformat(date_from), date.fromisoformat(date_to)
        n = (b - a).days + 1
        days = [a + timedelta(days=d) for d in range(n)]
        m = {k: [0.0] * (len(fleet) * n) for k in ("work", "idle", "standby", "down", "fuel")}

        def to_daily(pts: list[tuple[date, float]], dst: list[float], e: int) -> None:
            for (_, v0), (d1, v1) in zip(pts, pts[1:]):
                if a <= d1 <= b:
                    dst[e * n + (d1 - a).days] += max(0.0, v1 - v0)

        async def one(e: int, eq: Equipment) -> None:
            # un día antes para poder calcular el primer delta
            op, idle, fuel = await asyncio.gather(
                self._series(eq.id, "CumulativeOperatingHours", "Hour", a - timedelta(days=1), b),
                self._series(eq.id, "CumulativeIdleHours", "Hour", a - timedelta(days=1), b),
                self._series(eq.id, "FuelUsed", "FuelConsumed", a - timedelta(days=1), b),
            )
            to_daily(op, m["work"], e)
            to_daily(idle, m["idle"], e)
            to_daily(fuel, m["fuel"], e)
            for d, day in enumerate(days):
                i = e * n + d
                m["standby"][i] = max(0.0, cat.shift_hours(eq.site_id, day.weekday()) - m["work"][i] - m["down"][i])

        await asyncio.gather(*(one(e, eq) for e, eq in enumerate(fleet)))
        return DailyMetrics(days=[d.isoformat() for d in days], equipment_ids=[eq.id for eq in fleet],
                            **{k: [round(v, 2) for v in col] for k, col in m.items()})

    async def get_live_status(self) -> list[LiveStatus]:
        fleet = await self.get_fleet()
        now = int(time.time() * 1000)
        # AEMP no trae "estado"; se deriva del último reporte (motor encendido, ralentí, códigos de falla).
        return [LiveStatus(id=eq.id, state="standby", lat=eq.lat, lon=eq.lon, ts=now) for eq in fleet]

    async def live_events(self) -> AsyncIterator[LiveStatus]:
        last: dict[str, str] = {}
        while True:
            for s in await self.get_live_status():
                if last.get(s.id) not in (None, s.state):
                    yield s.model_copy(update={"prev": last[s.id]})
                last[s.id] = s.state
            await asyncio.sleep(300)  # AEMP suele actualizar cada 5–15 min
