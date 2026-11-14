import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import get_settings
from app.routes_grading import router as grading_router
from app.routes_pdf import router as pdf_router
from app.routes_stats import router as stats_router
from app.security import require_internal_key

logger = logging.getLogger("mathlens.ai")

internal_router = APIRouter(prefix="/v1", dependencies=[Depends(require_internal_key)])


@internal_router.get("/ping")
def internal_ping() -> dict[str, bool]:
    return {"ok": True}


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    app = FastAPI(
        title="MathLens AI Grading & Stats Service",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
    )

    @app.middleware("http")
    async def request_id_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        req_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        response.headers["X-Request-Id"] = req_id
        logger.info(
            "http_request method=%s path=%s status=%s duration_ms=%d request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            req_id,
        )
        return response

    @app.get("/healthz")
    def healthz() -> dict[str, str | bool]:
        return {"ok": True, "service": "mathlens-ai"}

    @app.get("/readyz")
    def readyz() -> dict[str, str | bool]:
        current = get_settings()
        return {"ok": True, "provider": current.ai_provider}

    @app.get("/metrics")
    def metrics() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(internal_router)
    app.include_router(grading_router)
    app.include_router(pdf_router)
    app.include_router(stats_router)
    return app


app = create_app()
