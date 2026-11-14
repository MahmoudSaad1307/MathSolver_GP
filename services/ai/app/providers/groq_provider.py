from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any, cast

import groq
from PIL import Image
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.providers.base import (
    CircuitBreaker,
    LLMProvider,
    PayloadTooLargeError,
    ProviderRequestError,
    ProviderUpstreamError,
    RawProviderCall,
)
from app.providers.json_helper import build_grading_user_message, execute_with_json_repair
from app.schemas import ModelAnswerIn, RubricCriterionIn

logger = logging.getLogger("mathlens.ai.groq")

_FALLBACK_GROQ_MODEL = "qwen/qwen3.8-27b"


def _shrink_image_for_groq(
    b64: str, mime: str, *, max_side: int, quality: int = 80
) -> tuple[str, str]:
    try:
        raw = base64.b64decode(b64, validate=True)
        with Image.open(io.BytesIO(raw)) as img:
            if max(img.width, img.height) <= max_side and len(b64) <= 220_000:
                return b64, mime
            resized = img.convert("RGB")
            resized.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            resized.save(buf, format="JPEG", quality=quality, optimize=True)
            return base64.b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"
    except Exception:
        return b64, mime


def _compact_images_for_groq(
    images: list[tuple[str, str]],
    *,
    max_side: int | None = None,
    quality: int = 80,
) -> list[tuple[str, str]]:
    if not images:
        return []
    target_side = max_side or (1280 if len(images) == 1 else (960 if len(images) == 2 else 768))
    return [
        _shrink_image_for_groq(b64, mime, max_side=target_side, quality=quality)
        for b64, mime in images
    ]


def _extract_retry_wait_seconds(exc: groq.APIStatusError) -> float:
    response = getattr(exc, "response", None)
    if response is not None:
        raw_header = response.headers.get("retry-after")
        if raw_header:
            try:
                return min(max(float(raw_header) + 0.5, 1.0), 14.0)
            except ValueError:
                pass
    match = re.search(r"try again in ([0-9]+(?:\.[0-9]+)?)s", str(exc), re.IGNORECASE)
    if match:
        return min(max(float(match.group(1)) + 0.5, 1.0), 14.0)
    if exc.status_code == 429 and "output tokens per minute" in str(exc).lower():
        return 6.0
    return 0.0


class GroqProvider(LLMProvider):
    provider_name = "groq"

    def __init__(
        self,
        *,
        api_key: str,
        vision_model: str,
        grade_model: str,
        timeout_seconds: float = 35.0,
    ) -> None:
        if not api_key:
            raise ValueError("GROQ_API_KEY is required when AI_PROVIDER=groq")
        self._client = groq.AsyncGroq(api_key=api_key, timeout=timeout_seconds)
        self._vision_model = vision_model
        self._grade_model = grade_model
        self._breaker = CircuitBreaker()

    @retry(
        retry=retry_if_exception_type(ProviderUpstreamError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.8, min=0.8, max=6.0),
        reraise=True,
    )
    async def _call_chat(
        self,
        *,
        model: str,
        system_prompt: str,
        content_parts: list[dict[str, Any]] | str,
        max_tokens: int = 1800,
        timeout_seconds: float | None = None,
    ) -> tuple[str, int, int]:
        self._breaker.before_call()
        client = (
            self._client.with_options(timeout=timeout_seconds)
            if timeout_seconds is not None and hasattr(self._client, "with_options")
            else self._client
        )
        candidate_model = model
        try:
            messages_payload = cast(
                Any,
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": content_parts},
                ],
            )
            try:
                response = await client.chat.completions.create(
                    model=candidate_model,
                    temperature=0.0,
                    max_tokens=max_tokens,
                    messages=messages_payload,
                )
            except groq.NotFoundError as exc:
                if candidate_model == _FALLBACK_GROQ_MODEL:
                    raise ProviderRequestError(
                        f"Groq model '{candidate_model}' not found: {exc}"
                    ) from exc
                logger.warning(
                    "Groq model '%s' unavailable (%s); falling back to '%s'",
                    candidate_model,
                    exc,
                    _FALLBACK_GROQ_MODEL,
                )
                candidate_model = _FALLBACK_GROQ_MODEL
                if model == self._vision_model:
                    self._vision_model = _FALLBACK_GROQ_MODEL
                if model == self._grade_model:
                    self._grade_model = _FALLBACK_GROQ_MODEL
                response = await client.chat.completions.create(
                    model=candidate_model,
                    temperature=0.0,
                    max_tokens=max_tokens,
                    messages=messages_payload,
                )
            self._breaker.record_success()
            content = response.choices[0].message.content or ""
            usage = getattr(response, "usage", None)
            in_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            out_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            return (content, in_tokens, out_tokens)
        except groq.APIStatusError as exc:
            if exc.status_code == 413:
                raise PayloadTooLargeError(f"Groq HTTP {exc.status_code}: {exc}") from exc
            if exc.status_code >= 500 or exc.status_code == 429:
                if exc.status_code == 429:
                    wait_s = _extract_retry_wait_seconds(exc)
                    if wait_s > 0:
                        await asyncio.sleep(wait_s)
                self._breaker.record_failure()
                raise ProviderUpstreamError(f"Groq HTTP {exc.status_code}: {exc}") from exc
            raise ProviderRequestError(f"Groq HTTP {exc.status_code}: {exc}") from exc
        except (groq.APIConnectionError, groq.APITimeoutError) as exc:
            self._breaker.record_failure()
            raise ProviderUpstreamError(f"Groq transport error: {exc}") from exc

    async def _run_json_repair(
        self,
        *,
        model_name: str,
        initial_call: Callable[[], Awaitable[tuple[str, int, int]]],
        repair_call: Callable[[str], Awaitable[tuple[str, int, int]]],
    ) -> RawProviderCall:
        try:
            return await execute_with_json_repair(
                model_name=model_name,
                initial_call=initial_call,
                repair_call=repair_call,
            )
        except ValueError as exc:
            raise ProviderRequestError(f"Groq returned invalid JSON: {exc}") from exc

    async def transcribe(
        self,
        *,
        processed_images: list[tuple[str, str]],
        system_prompt: str,
        question_prompt_latex: str | None,
        hint_tag: str | None = None,
        image_warnings: list[str] | None = None,
    ) -> RawProviderCall:
        del hint_tag, image_warnings
        parts: list[dict[str, Any]] = []
        for b64, mime in _compact_images_for_groq(processed_images, max_side=1280):
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                }
            )
        context_note = (
            f"Question statement (context only): {question_prompt_latex}\n"
            if question_prompt_latex
            else ""
        )
        parts.append(
            {
                "type": "text",
                "text": f"{context_note}Transcribe handwritten math lines as strict JSON.",
            }
        )

        return await execute_with_json_repair(
            model_name=self._vision_model,
            initial_call=lambda: self._call_chat(
                model=self._vision_model,
                system_prompt=system_prompt,
                content_parts=parts,
            ),
            repair_call=lambda prompt: self._call_chat(
                model=self._vision_model,
                system_prompt=system_prompt,
                content_parts=[{"type": "text", "text": prompt}],
            ),
        )

    def _build_json_user_content(
        self, processed_images: list[tuple[str, str]], user_prompt: str
    ) -> list[dict[str, Any]] | str:
        if not processed_images:
            return user_prompt
        parts: list[dict[str, Any]] = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
            for b64, mime in processed_images
        ]
        parts.append({"type": "text", "text": user_prompt})
        return parts

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
        del hint_tag
        model_name = self._vision_model if processed_images else self._grade_model
        compacted_images = _compact_images_for_groq(processed_images)
        # Keep vision max_tokens under Groq on_demand 1000 OTPM ceiling
        effective_max_tokens = min(max_tokens, 950) if compacted_images else max_tokens
        user_content = self._build_json_user_content(compacted_images, user_prompt)

        try:
            return await self._run_json_repair(
                model_name=model_name,
                initial_call=lambda: self._call_chat(
                    model=model_name,
                    system_prompt=system_prompt,
                    content_parts=user_content,
                    max_tokens=effective_max_tokens,
                    timeout_seconds=timeout_seconds,
                ),
                repair_call=lambda prompt: self._call_chat(
                    model=model_name,
                    system_prompt=system_prompt,
                    content_parts=prompt,
                    max_tokens=effective_max_tokens,
                    timeout_seconds=timeout_seconds,
                ),
            )
        except PayloadTooLargeError:
            if len(processed_images) != 1:
                raise
            smaller_images = _compact_images_for_groq(processed_images, max_side=720, quality=72)
            smaller_content = self._build_json_user_content(smaller_images, user_prompt[:2500])
            retry_max_tokens = min(effective_max_tokens, 2048)
            return await self._run_json_repair(
                model_name=model_name,
                initial_call=lambda: self._call_chat(
                    model=model_name,
                    system_prompt=system_prompt,
                    content_parts=smaller_content,
                    max_tokens=retry_max_tokens,
                    timeout_seconds=timeout_seconds,
                ),
                repair_call=lambda prompt: self._call_chat(
                    model=model_name,
                    system_prompt=system_prompt,
                    content_parts=prompt,
                    max_tokens=retry_max_tokens,
                    timeout_seconds=timeout_seconds,
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
        del hint_tag
        parts: list[dict[str, Any]] = []
        if include_images:
            for b64, mime in _compact_images_for_groq(processed_images, max_side=1280):
                parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    }
                )
        parts.append(
            {
                "type": "text",
                "text": build_grading_user_message(
                    question_prompt_latex=question_prompt_latex,
                    model_answer=model_answer,
                    rubric_criteria=rubric_criteria,
                    wrapped_student_work=wrapped_student_work,
                ),
            }
        )

        return await execute_with_json_repair(
            model_name=self._grade_model,
            initial_call=lambda: self._call_chat(
                model=self._grade_model,
                system_prompt=system_prompt,
                content_parts=parts,
            ),
            repair_call=lambda prompt: self._call_chat(
                model=self._grade_model,
                system_prompt=system_prompt,
                content_parts=[{"type": "text", "text": prompt}],
            ),
        )
