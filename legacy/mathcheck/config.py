import functools
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List
import dotenv

# Load .env from current directory, parent directory, or workspace root
env_paths = [
    Path.cwd() / ".env",
    Path(__file__).resolve().parent / ".env",
    Path(__file__).resolve().parent.parent / ".env",
]
for p in env_paths:
    if p.is_file():
        dotenv.load_dotenv(dotenv_path=p, override=False)

def _parse_comma_list(value: str | None, default: List[str]) -> List[str]:
    if not value or not value.strip():
        return default
    return [item.strip() for item in value.split(",") if item.strip()]

@dataclass(frozen=True)
class Settings:
    groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", "").strip())
    use_groq: bool = field(default_factory=lambda: os.getenv("USE_GROQ", "true").lower() in ("true", "1", "yes"))
    groq_vision_models: List[str] = field(
        default_factory=lambda: _parse_comma_list(
            os.getenv("GROQ_VISION_MODELS"),
            ["qwen/qwen3.6-27b", "meta-llama/llama-4-scout-17b-16e-instruct"],
        )
    )
    groq_reason_models: List[str] = field(
        default_factory=lambda: _parse_comma_list(
            os.getenv("GROQ_REASON_MODELS"),
            # Use only verified Groq model IDs as fallbacks
            ["qwen-qwq-32b", "deepseek-r1-distill-llama-70b"],
        )
    )
    ollama_host: str = field(default_factory=lambda: os.getenv("OLLAMA_HOST", "http://localhost:11434").strip())
    ollama_vision_model: str = field(default_factory=lambda: os.getenv("OLLAMA_VISION_MODEL", "qwen2.5vl:7b").strip())
    ollama_reason_model: str = field(default_factory=lambda: os.getenv("OLLAMA_REASON_MODEL", "qwen2.5:7b").strip())
    max_solve_retries: int = field(default_factory=lambda: int(os.getenv("MAX_SOLVE_RETRIES", "3")))
    numeric_samples: int = field(default_factory=lambda: int(os.getenv("NUMERIC_SAMPLES", "14")))

    def is_groq_ready(self) -> bool:
        return bool(self.use_groq and self.groq_api_key)

@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton Settings instance.

    Thread-safe via lru_cache. In tests call ``get_settings.cache_clear()``
    between test cases that modify environment variables.
    """
    return Settings()

def is_ollama_reachable(host: str) -> bool:
    try:
        import urllib.request
        url = host.rstrip("/") + "/api/tags"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as response:
            return response.status == 200
    except Exception:
        return False

def validate_environment_or_fail(settings: Settings | None = None) -> None:
    """
    Fail fast with a clear Arabic error if the Groq key is missing/disabled
    and Ollama is unreachable.
    """
    s = settings or get_settings()
    if s.is_groq_ready():
        return
    
    # Check Ollama
    if is_ollama_reachable(s.ollama_host):
        return

    raise RuntimeError(
        "خطأ في التهيئة: مفتاح GROQ_API_KEY مفقود (أو معطل) وخادم Ollama المحلي غير متصل "
        f"على {s.ollama_host}. يرجى توفير مفتاح Groq صالح في ملف .env أو تشغيل Ollama محلياً."
    )
