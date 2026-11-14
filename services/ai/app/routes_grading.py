from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, status

from app.cache import GradeResultCache
from app.config import Settings, get_settings
from app.pipeline.service import GradingPipelineService
from app.providers import get_provider_cached
from app.providers.base import CircuitOpenError, ProviderRequestError, ProviderUpstreamError
from app.schemas import (
    GradeEssayRequest,
    GradeEssayResponse,
    TranscribeRequest,
    TranscriptionResult,
)
from app.security import require_internal_key

router = APIRouter(prefix="/v1", dependencies=[Depends(require_internal_key)])


@lru_cache(maxsize=1)
def get_grade_cache() -> GradeResultCache:
    return GradeResultCache(max_entries=256)


def get_grading_pipeline(settings: Settings | None = None) -> GradingPipelineService:
    active_settings = settings or get_settings()
    provider = get_provider_cached(
        active_settings.ai_provider,
        active_settings.anthropic_api_key,
        active_settings.groq_api_key,
        active_settings.ai_model_transcribe,
        active_settings.ai_model_grade,
        active_settings.groq_vision_model,
        active_settings.groq_grade_model,
        active_settings.ai_request_timeout_seconds,
        active_settings.gemini_api_key,
        active_settings.gemini_vision_model,
        active_settings.gemini_grade_model,
    )
    return GradingPipelineService(
        settings=active_settings,
        provider=provider,
        cache=get_grade_cache(),
    )


@router.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_endpoint(
    payload: TranscribeRequest,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> TranscriptionResult:
    try:
        pipeline = get_grading_pipeline(settings)
        result, _, _, _ = await pipeline.transcribe_only(payload)
        return result
    except CircuitOpenError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "AI_CIRCUIT_OPEN", "message": str(exc)},
        ) from exc
    except (ProviderUpstreamError, ProviderRequestError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "AI_UPSTREAM_ERROR", "message": str(exc)},
        ) from exc


@router.post("/grade-essay", response_model=GradeEssayResponse)
async def grade_essay_endpoint(
    payload: GradeEssayRequest,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> GradeEssayResponse:
    try:
        pipeline = get_grading_pipeline(settings)
        return await pipeline.grade_essay(payload)
    except CircuitOpenError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "AI_CIRCUIT_OPEN", "message": str(exc)},
        ) from exc
    except (ProviderUpstreamError, ProviderRequestError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "AI_UPSTREAM_ERROR", "message": str(exc)},
        ) from exc
