"""Simulador determinista de una flota (misma semilla = mismos datos)."""
import asyncio
import math
import random
import time
from collections.abc import AsyncIterator
from datetime import date, timedelta

from ..domain import catalog as cat
from ..domain.models import DailyMetrics, Equipment, LiveStatus

FAULTS = [
    "SPN 110 · Temp. refrigerante alta",
    "SPN 100 · Presión aceite baja",
    "SPN 190 · Sobrevelocidad motor",
    "Filtro hidráulico obstruido",
    "Nivel DEF bajo",
]


class MockTelemetryProvider:
    def __init__(self, today: str, history_days: int, seed: int = 20261020):
        self.today = date.fromisoformat(today)
        self.history_days = history_days
        self.start = self.today - timedelta(days=history_days)
        self.n_days = history_days + 1
        self._build(random.Random(seed))
        self._events = random.Random(seed + 1)

    def _build(self, r: random.Random) -> None:
        fleet: list[Equipment] = []
        params: list[tuple[float, float, float]] = []
        n = 0
        for site in cat.SITES:
            touching = [road for road in cat.ROADS if _near(road[0], site) or _near(road[-1], site)]
            for type_id, count in site["mix"].items():
                t = cat.TYPE_BY_ID[type_id]
                for _ in range(count):
                    n += 1
                    model = r.choice(t["models"])
                    ang, dist = r.random() * math.tau, math.sqrt(r.random()) * site["radius"]
                    route = None
                    if type_id == "VOL" and touching:
                        road = r.choice(touching)
                        route = road if _near(road[0], site) else list(reversed(road))
                    fleet.append(Equipment(
                        id=f"{type_id}-{n:03d}", pin=f"PIN{r.randint(10_000_000, 99_999_999)}",
                        oem=model.split(" ")[0], model=model, type_id=type_id,
                        site_id=site["id"], client_id=site["client"],
                        lat=round(site["lat"] + math.sin(ang) * dist, 5),
                        lon=round(site["lon"] + math.cos(ang) * dist * 1.1, 5),
                        rate=round(t["rate"] * (0.92 + r.random() * 0.16)),
                        standby_factor=cat.STANDBY_FACTOR, year=2016 + r.randrange(10),
                        hour_meter=round(2000 + r.random() * 16000), route=route,
                    ))
                    params.append((0.45 + r.random() * 0.5, 0.08 + r.random() * 0.22, t["fuel"] * (0.9 + r.random() * 0.2)))
        self.fleet = fleet

        size = len(fleet) * self.n_days
        m = {k: [0.0] * size for k in ("work", "idle", "standby", "down", "fuel")}
        phase = {s["id"]: r.random() * 6.28 for s in cat.SITES}
        for e, eq in enumerate(fleet):
            prop, idle_ratio, fuel_rate = params[e]
            down_left = 0
            for d in range(self.n_days):
                day = self.start + timedelta(days=d)
                shift = cat.shift_hours(eq.site_id, day.weekday())
                i = e * self.n_days + d
                if down_left <= 0 and r.random() < 0.012:
                    down_left = 1 + r.randrange(5)
                if shift == 0:
                    down_left = max(0, down_left - 1)
                    continue
                if down_left > 0:
                    down_left -= 1
                    m["down"][i] = shift
                    continue
                activity = 0.78 + 0.22 * math.sin(d / 23 + phase[eq.site_id])
                util = min(0.98, max(0.0, prop * activity * (0.75 + r.random() * 0.5)))
                work = shift * util
                idle = work * idle_ratio * (0.7 + r.random() * 0.6)
                m["work"][i], m["idle"][i], m["standby"][i] = work, idle, shift - work
                m["fuel"][i] = (work - idle) * fuel_rate * (0.85 + r.random() * 0.3) + idle * fuel_rate * 0.22
        self.m = m

        now = int(time.time() * 1000)
        self.live: dict[str, LiveStatus] = {}
        for e, eq in enumerate(fleet):
            i = e * self.n_days + self.n_days - 1
            if m["down"][i] > 0:
                state = "down"
            elif r.random() < 0.04:
                state = "off"
            else:
                p, x = m["work"][i] / 10, r.random()
                state = "op" if x < p * 0.85 else "idle" if x < p else "standby"
            self.live[eq.id] = LiveStatus(id=eq.id, state=state, lat=eq.lat, lon=eq.lon, ts=now - r.randrange(900_000),
                                          fault=r.choice(FAULTS) if state == "down" else None)

    async def get_fleet(self) -> list[Equipment]:
        return self.fleet

    async def get_daily_metrics(self, date_from: str, date_to: str) -> DailyMetrics:
        a = max((date.fromisoformat(date_from) - self.start).days, 0)
        b = min((date.fromisoformat(date_to) - self.start).days, self.n_days - 1)
        if b < a:
            a = b = max(0, min(a, self.n_days - 1))
        out: dict[str, list[float]] = {}
        for k, src in self.m.items():
            col: list[float] = []
            for e in range(len(self.fleet)):
                base = e * self.n_days
                col.extend(round(v, 2) for v in src[base + a: base + b + 1])
            out[k] = col
        days = [(self.start + timedelta(days=d)).isoformat() for d in range(a, b + 1)]
        return DailyMetrics(days=days, equipment_ids=[eq.id for eq in self.fleet], **out)

    async def get_live_status(self) -> list[LiveStatus]:
        return list(self.live.values())

    async def live_events(self) -> AsyncIterator[LiveStatus]:
        r = self._events
        ids = list(self.live)
        while True:
            await asyncio.sleep(1.8)
            s = self.live[r.choice(ids)]
            prev, roll = s.state, r.random()
            if prev == "down":
                nxt = "standby" if roll < 0.4 else "down"
            elif prev == "off":
                nxt = "standby"
            else:
                nxt = "op" if roll < 0.5 else "idle" if roll < 0.68 else "standby" if roll < 0.95 else "down" if roll < 0.985 else "off"
            if nxt == prev:
                continue
            s.state, s.ts = nxt, int(time.time() * 1000)
            s.fault = r.choice(FAULTS) if nxt == "down" else None
            yield s.model_copy(update={"prev": prev})


def _near(pt: list[float], site: dict) -> bool:
    return abs(pt[0] - site["lat"]) < 0.02 and abs(pt[1] - site["lon"]) < 0.02
