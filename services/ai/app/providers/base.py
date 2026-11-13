from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.schemas import ModelAnswerIn, RubricCriterionIn

_PRICE_PER_1M_TOKENS: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-20250514": (3.00, 15.00),
    "claude-3-5-sonnet-20241022": (3.00, 15.00),
    "meta-llama/llama-4-scout-17b-16e-instruct": (0.11, 0.34),
    "fake-vision-v1": (0.0, 0.0),
    "fake-grader-v1": (0.0, 0.0),
}


def estimate_cost_usd(model_name: str, input_tokens: int, output_tokens: int) -> float:
    in_rate, out_rate = _PRICE_PER_1M_TOKENS.get(model_name, (1.00, 3.00))
    cost = (input_tokens * in_rate + output_tokens * out_rate) / 1_000_000.0
    return round(cost, 6)


def extract_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1 or last <= first:
        raise ValueError("No JSON object found in model output")
    candidate = text[first : last + 1]
    parsed = json.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("Parsed JSON root is not an object")
    return parsed


class ProviderUpstreamError(RuntimeError):
    """Transient upstream provider error eligible for circuit-breaking and retry."""


class CircuitOpenError(RuntimeError):
    """Raised when provider circuit breaker is open after repeated failures."""


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, reset_seconds: float = 30.0) -> None:
        self._failure_threshold = failure_threshold
        self._reset_seconds = reset_seconds
        self._consecutive_failures = 0
        self._opened_at: float | None = None

    def before_call(self) -> None:
        if self._opened_at is not None:
            if time.monotonic() - self._opened_at >= self._reset_seconds:
                self._opened_at = None
                self._consecutive_failures = 0
            else:
                raise CircuitOpenError("Upstream AI provider circuit breaker is open")

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._failure_threshold:
            self._opened_at = time.monotonic()


@dataclass(frozen=True)
class RawProviderCall:
    raw_text: str
    parsed_json: dict[str, Any]
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int
    model_name: str
    schema_retry_used: bool


class LLMProvider(ABC):
    provider_name: str

    @abstractmethod
    async def transcribe(
        self,
        *,
        processed_images: list[tuple[str, str]],
        system_prompt: str,
        question_prompt_latex: str | None,
        hint_tag: str | None = None,
        image_warnings: list[str] | None = None,
    ) -> RawProviderCall:
        """Transcribe handwritten solution images into structured LaTeX line JSON."""

    @abstractmethod
    async def grade(
        self,
        *,
        system_prompt: str,
        question_prompt_latex: str,
        model_answer: ModelAnswerIn,
        rubric_criteria: list[RubricCriterionIn],
        wrapped_student_work: str,
        processed_images: list[tuple[str, str]],
        include_images: bool,
        hint_tag: str | None = None,
    ) -> RawProviderCall:
        """Compare student work to model answer and rubric and emit structured JSON."""
