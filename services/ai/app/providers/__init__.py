from __future__ import annotations

from functools import lru_cache

from app.config import Settings
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import LLMProvider
from app.providers.fake_provider import FakeProvider
from app.providers.groq_provider import GroqProvider


def create_provider(settings: Settings) -> LLMProvider:
    if settings.ai_provider == "fake":
        return FakeProvider()
    if settings.ai_provider == "groq":
        return GroqProvider(
            api_key=settings.groq_api_key,
            vision_model=settings.groq_vision_model,
            grade_model=settings.groq_grade_model,
            timeout_seconds=settings.ai_request_timeout_seconds,
        )
    return AnthropicProvider(
        api_key=settings.anthropic_api_key,
        transcribe_model=settings.ai_model_transcribe,
        grade_model=settings.ai_model_grade,
        timeout_seconds=settings.ai_request_timeout_seconds,
    )


@lru_cache(maxsize=1)
def get_provider_cached(
    ai_provider: str,
    anthropic_key: str,
    groq_key: str,
    transcribe_model: str,
    grade_model: str,
    groq_vision_model: str,
    groq_grade_model: str,
    timeout_seconds: float,
) -> LLMProvider:
    settings = Settings(
        ai_provider=ai_provider,  # type: ignore[arg-type]
        anthropic_api_key=anthropic_key,
        groq_api_key=groq_key,
        ai_model_transcribe=transcribe_model,
        ai_model_grade=grade_model,
        groq_vision_model=groq_vision_model,
        groq_grade_model=groq_grade_model,
        ai_request_timeout_seconds=timeout_seconds,
    )
    return create_provider(settings)
