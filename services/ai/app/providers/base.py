from __future__ import annotations

import json
import logging
import re
import time
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.schemas import ModelAnswerIn, RubricCriterionIn

logger = logging.getLogger("mathlens.ai.provider")

_PRICE_PER_1M_TOKENS: dict[str, tuple[float, float]] = {
    "gemini-flash-latest": (0.15, 0.60),
    "gemini-2.5-flash": (0.15, 0.60),
    "gemini-3.8-flash": (0.20, 0.80),
    "gemini-3.1-pro-preview": (1.25, 5.00),
    "claude-sonnet-4-20250514": (3.00, 15.00),
    "claude-3-5-sonnet-20241022": (3.00, 15.00),
    "qwen/qwen3.8-27b": (0.15, 0.45),
    "openai/gpt-oss-120b": (0.15, 0.75),
    "openai/gpt-oss-20b": (0.08, 0.30),
    "meta-llama/llama-4-scout-17b-16e-instruct": (0.11, 0.34),
    "fake-vision-v1": (0.0, 0.0),
    "fake-grader-v1": (0.0, 0.0),
}


def estimate_cost_usd(model_name: str, input_tokens: int, output_tokens: int) -> float:
    in_rate, out_rate = _PRICE_PER_1M_TOKENS.get(model_name, (1.00, 3.00))
    cost = (input_tokens * in_rate + output_tokens * out_rate) / 1_000_000.0
    return round(cost, 6)


def _decode_json_with_latex_fallback(candidate: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    try:
        parsed, _ = decoder.raw_decode(candidate)
    except json.JSONDecodeError:
        sanitized = re.sub(r'(?<!\\)\\(?!["\\/bfnrtu])', r"\\\\", candidate)
        parsed, _ = decoder.raw_decode(sanitized)
    if not isinstance(parsed, dict):
        raise ValueError("Parsed JSON root is not an object")
    return parsed


def extract_json_object(raw_text: str) -> dict[str, Any]:
    # Strip reasoning blocks so math notation inside <think>...</think> does not hijack `{` matching
    text = re.sub(r"<think>[\s\S]*?</think>", "", raw_text, flags=re.IGNORECASE).strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()
    first = text.find("{")
    if first == -1:
        raise ValueError("No JSON object found in model output")
    return _decode_json_with_latex_fallback(text[first:])


class ProviderUpstreamError(RuntimeError):
    """Transient upstream provider error eligible for circuit-breaking and retry."""


class ProviderRequestError(RuntimeError):
    """Non-retryable upstream request, model availability, or schema parse error."""


class PayloadTooLargeError(ProviderRequestError):
    """Upstream provider rejected request size or ITPM token ceiling (HTTP 413)."""


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

    async def extract_json_with_images(
        self,
        *,
        processed_images: list[tuple[str, str]],
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        timeout_seconds: float | None = None,
        hint_tag: str | None = None,
    ) -> RawProviderCall:
        """Vision+text call returning JSON output with configurable token & timeout budgets."""
        raise NotImplementedError(
            f"{type(self).__name__} does not implement extract_json_with_images"
        )

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


class FailoverLLMProvider(LLMProvider):
    """Tries priority primary provider first and fails over to backup on upstream/request error."""

    def __init__(self, primary: LLMProvider, backup: LLMProvider) -> None:
        self._primary = primary
        self._backup = backup
        self.provider_name = primary.provider_name

    async def _call_with_failover(
        self,
        op_name: str,
        primary_fn: Callable[[], Awaitable[RawProviderCall]],
        backup_fn: Callable[[], Awaitable[RawProviderCall]],
    ) -> RawProviderCall:
        try:
            return await primary_fn()
        except (ProviderUpstreamError, ProviderRequestError, CircuitOpenError) as exc:
            logger.warning(
                "Primary provider '%s' %s failed (%s); failing over to '%s'",
                self._primary.provider_name,
                op_name,
                exc,
                self._backup.provider_name,
            )
            return await backup_fn()

    async def extract_json_with_images(
        self,
        *,
        processed_images: list[tuple[str, str]],
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        timeout_seconds: float | None = None,
        hint_tag: str | None = None,
    ) -> RawProviderCall:
        return await self._call_with_failover(
            "extract_json_with_images",
            lambda: self._primary.extract_json_with_images(
                processed_images=processed_images,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
                timeout_seconds=timeout_seconds,
                hint_tag=hint_tag,
            ),
            lambda: self._backup.extract_json_with_images(
                processed_images=processed_images,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
                timeout_seconds=timeout_seconds,
                hint_tag=hint_tag,
            ),
        )

    async def transcribe(
        self,
        *,
        processed_images: list[tuple[str, str]],
        system_prompt: str,
        question_prompt_latex: str | None,
        hint_tag: str | None = None,
        image_warnings: list[str] | None = None,
    ) -> RawProviderCall:
        return await self._call_with_failover(
            "transcribe",
            lambda: self._primary.transcribe(
                processed_images=processed_images,
                system_prompt=system_prompt,
                question_prompt_latex=question_prompt_latex,
                hint_tag=hint_tag,
                image_warnings=image_warnings,
            ),
            lambda: self._backup.transcribe(
                processed_images=processed_images,
                system_prompt=system_prompt,
                question_prompt_latex=question_prompt_latex,
                hint_tag=hint_tag,
                image_warnings=image_warnings,
            ),
        )

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
        return await self._call_with_failover(
            "grade",
            lambda: self._primary.grade(
                system_prompt=system_prompt,
                question_prompt_latex=question_prompt_latex,
                model_answer=model_answer,
                rubric_criteria=rubric_criteria,
                wrapped_student_work=wrapped_student_work,
                processed_images=processed_images,
                include_images=include_images,
                hint_tag=hint_tag,
            ),
            lambda: self._backup.grade(
                system_prompt=system_prompt,
                question_prompt_latex=question_prompt_latex,
                model_answer=model_answer,
                rubric_criteria=rubric_criteria,
                wrapped_student_work=wrapped_student_work,
                processed_images=processed_images,
                include_images=include_images,
                hint_tag=hint_tag,
            ),
        )
