from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ai_internal_key: str = "dev_internal_shared_secret_change_in_prod"
    ai_provider: Literal["anthropic", "groq", "fake"] = "anthropic"
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    ai_model_transcribe: str = "claude-sonnet-4-20250514"
    ai_model_grade: str = "claude-sonnet-4-20250514"
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    groq_grade_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    ai_min_confidence: float = 0.75
    ai_max_illegible_ratio: float = 0.20
    ai_pass_grade_image: bool = True
    ai_blur_laplacian_min: float = 45.0
    ai_request_timeout_seconds: float = 35.0
    ai_sympy_timeout_seconds: float = 3.0
    redis_url: str = "redis://localhost:6379"
    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
