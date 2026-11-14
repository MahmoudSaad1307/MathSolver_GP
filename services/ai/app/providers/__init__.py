from __future__ import annotations

from functools import lru_cache

from app.config import Settings
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import FailoverLLMProvider, LLMProvider
from app.providers.fake_provider import FakeProvider
from app.providers.gemini_provider import GeminiProvider
from app.providers.groq_provider import GroqProvider


def resolve_primary_provider_name(settings: Settings) -> str:
    """Resolve active primary provider with Gemini taking top priority whenever configured."""
    if settings.ai_provider == "fake":
        return "fake"
    if settings.gemini_api_key.strip() or settings.ai_provider == "gemini":
        return "gemini"
    if settings.ai_provider == "anthropic":
        if settings.anthropic_api_key.strip() or not settings.groq_api_key.strip():
            return "anthropic"
        return "groq"
    return settings.ai_provider


def _build_provider_by_name(name: str, settings: Settings) -> LLMProvider:
    if name == "fake":
        return FakeProvider()
    if name == "gemini":
        return GeminiProvider(
            api_key=settings.gemini_api_key,
            vision_model=settings.gemini_vision_model,
            grade_model=settings.gemini_grade_model,
            timeout_seconds=settings.ai_request_timeout_seconds,
        )
    if name == "groq":
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


def create_secondary_provider(settings: Settings) -> LLMProvider | None:
    """Return secondary cross-check/backup provider when a second real API key is configured."""
    primary_name = resolve_primary_provider_name(settings)
    if primary_name == "fake":
        return None
    if primary_name == "gemini":
        if settings.groq_api_key.strip():
            return _build_provider_by_name("groq", settings)
        if settings.anthropic_api_key.strip():
            return _build_provider_by_name("anthropic", settings)
        return None
    if primary_name == "anthropic" and settings.groq_api_key.strip():
        return _build_provider_by_name("groq", settings)
    if primary_name == "groq" and settings.anthropic_api_key.strip():
        return _build_provider_by_name("anthropic", settings)
    return None


def create_provider(settings: Settings) -> LLMProvider:
    primary_name = resolve_primary_provider_name(settings)
    primary = _build_provider_by_name(primary_name, settings)
    backup = create_secondary_provider(settings)
    if backup is not None:
        return FailoverLLMProvider(primary, backup)
    return primary


def _build_settings_for_cache(
    ai_provider: str,
    anthropic_key: str,
    groq_key: str,
    transcribe_model: str,
    grade_model: str,
    groq_vision_model: str,
    groq_grade_model: str,
    timeout_seconds: float,
    gemini_key: str,
    gemini_vision_model: str,
    gemini_grade_model: str,
) -> Settings:
    return Settings(
        ai_provider=ai_provider,  # type: ignore[arg-type]
        gemini_api_key=gemini_key,
        gemini_vision_model=gemini_vision_model,
        gemini_grade_model=gemini_grade_model,
        anthropic_api_key=anthropic_key,
        groq_api_key=groq_key,
        ai_model_transcribe=transcribe_model,
        ai_model_grade=grade_model,
        groq_vision_model=groq_vision_model,
        groq_grade_model=groq_grade_model,
        ai_request_timeout_seconds=timeout_seconds,
    )


@lru_cache(maxsize=2)
def get_secondary_provider_cached(
    ai_provider: str,
    anthropic_key: str,
    groq_key: str,
    transcribe_model: str,
    grade_model: str,
    groq_vision_model: str,
    groq_grade_model: str,
    timeout_seconds: float,
    gemini_key: str = "",
    gemini_vision_model: str = "gemini-flash-latest",
    gemini_grade_model: str = "gemini-flash-latest",
) -> LLMProvider | None:
    return create_secondary_provider(
        _build_settings_for_cache(
            ai_provider,
            anthropic_key,
            groq_key,
            transcribe_model,
            grade_model,
            groq_vision_model,
            groq_grade_model,
            timeout_seconds,
            gemini_key,
            gemini_vision_model,
            gemini_grade_model,
        )
    )


@lru_cache(maxsize=2)
def get_provider_cached(
    ai_provider: str,
    anthropic_key: str,
    groq_key: str,
    transcribe_model: str,
    grade_model: str,
    groq_vision_model: str,
    groq_grade_model: str,
    timeout_seconds: float,
    gemini_key: str = "",
    gemini_vision_model: str = "gemini-flash-latest",
    gemini_grade_model: str = "gemini-flash-latest",
) -> LLMProvider:
    return create_provider(
        _build_settings_for_cache(
            ai_provider,
            anthropic_key,
            groq_key,
            transcribe_model,
            grade_model,
            groq_vision_model,
            groq_grade_model,
            timeout_seconds,
            gemini_key,
            gemini_vision_model,
            gemini_grade_model,
        )
    )
