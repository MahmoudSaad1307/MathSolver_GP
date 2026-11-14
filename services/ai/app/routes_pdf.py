from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.pipeline.pdf_extractor import extract_exam_pdfs
from app.pipeline.pdf_preprocess import PdfValidationError
from app.providers import get_provider_cached, get_secondary_provider_cached
from app.providers.base import ProviderUpstreamError
from app.schemas_pdf import ExtractExamPdfRequest, ExtractExamPdfResponse
from app.security import require_internal_key

router = APIRouter(prefix="/v1", tags=["pdf-import"])


@router.post(
    "/extract-exam-pdf",
    response_model=ExtractExamPdfResponse,
    dependencies=[Depends(require_internal_key)],
)
async def extract_exam_pdf_route(
    body: ExtractExamPdfRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ExtractExamPdfResponse:
    primary = get_provider_cached(
        settings.ai_provider,
        settings.anthropic_api_key,
        settings.groq_api_key,
        settings.ai_model_transcribe,
        settings.ai_model_grade,
        settings.groq_vision_model,
        settings.groq_grade_model,
        settings.ai_request_timeout_seconds,
    )
    secondary = get_secondary_provider_cached(
        settings.ai_provider,
        settings.anthropic_api_key,
        settings.groq_api_key,
        settings.ai_model_transcribe,
        settings.ai_model_grade,
        settings.groq_vision_model,
        settings.groq_grade_model,
        settings.ai_request_timeout_seconds,
    )
    try:
        return await extract_exam_pdfs(
            body,
            primary_provider=primary,
            secondary_provider=secondary,
            settings=settings,
        )
    except PdfValidationError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ProviderUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "PDF_EXTRACTION_FAILED", "message": str(exc)},
        ) from exc
