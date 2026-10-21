from fastapi.testclient import TestClient

from app.main import app


def test_endpoints():
    with TestClient(app) as c:
        cat = c.get("/api/v1/catalog").json()
        assert len(cat["sites"]) == 6
        fleet = c.get("/api/v1/fleet").json()
        assert len(fleet) == 98 and "typeId" in fleet[0]
        m = c.get("/api/v1/metrics/daily", params={"from": "2026-10-01", "to": "2026-10-20"}).json()
        assert len(m["days"]) == 20
        assert len(m["work"]) == len(fleet) * 20
        assert all(0 <= w <= 10 for w in m["work"])
        live = c.get("/api/v1/live").json()
        assert {s["state"] for s in live} <= {"op", "idle", "standby", "down", "off"}


def test_billing_rules():
    with TestClient(app) as c:
        eq = c.get("/api/v1/fleet").json()[0]
        b = c.get(f"/api/v1/equipment/{eq['id']}/billing", params={"from": "2026-10-01", "to": "2026-10-20"}).json()
        work, standby = b["lines"][0], b["lines"][1]
        assert abs(work["amount"] - work["hours"] * eq["rate"]) < 0.02
        assert abs(standby["amount"] - standby["hours"] * eq["rate"] * 0.5) < 0.02
        assert abs(b["notBilled"] - (b["potential"] - b["total"])) < 0.05
        assert c.get("/api/v1/equipment/NOPE/billing").status_code == 404


def test_live_websocket():
    with TestClient(app) as c, c.websocket_connect("/api/v1/live/ws") as ws:
        ev = ws.receive_json()
        assert ev["state"] != ev["prev"]


def test_finance_without_database():
    with TestClient(app) as c:
        assert c.get("/api/v1/health").json()["database"] is False
        assert c.get("/api/v1/finance/months").status_code == 503
