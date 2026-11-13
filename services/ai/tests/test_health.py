from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


def test_health_and_internal_auth() -> None:
    get_settings.cache_clear()
    client = TestClient(create_app())

    hz = client.get("/healthz")
    assert hz.status_code == 200
    assert hz.json()["ok"] is True
    assert "X-Request-Id" in hz.headers

    rz = client.get("/readyz")
    assert rz.status_code == 200

    unauth = client.get("/v1/ping")
    assert unauth.status_code == 401

    wrong = client.get("/v1/ping", headers={"X-Internal-Key": "wrong"})
    assert wrong.status_code == 401

    settings = get_settings()
    authed = client.get("/v1/ping", headers={"X-Internal-Key": settings.ai_internal_key})
    assert authed.status_code == 200
    assert authed.json() == {"ok": True}
