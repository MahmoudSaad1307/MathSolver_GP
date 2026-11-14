from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.providers.base import (
    CircuitBreaker,
    LLMProvider,
    ProviderRequestError,
    ProviderUpstreamError,
    RawProviderCall,
)
from app.providers.json_helper import build_grading_user_message, execute_with_json_repair
from app.schemas import ModelAnswerIn, RubricCriterionIn

logger = logging.getLogger("mathlens.ai.gemini")

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_FALLBACK_GEMINI_MODEL = "gemini-flash-latest"


class GeminiProvider(LLMProvider):
    provider_name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        vision_model: str = _FALLBACK_GEMINI_MODEL,
        grade_model: str = _FALLBACK_GEMINI_MODEL,
        timeout_seconds: float = 35.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required when AI_PROVIDER=gemini")
        self._api_key = api_key
        self._vision_model = vision_model
        self._grade_model = grade_model
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._breaker = CircuitBreaker()

    def _build_payload(
        self,
        *,
        model_name: str,
        system_prompt: str,
        parts: list[dict[str, Any]],
        max_tokens: int,
        include_thinking: bool = True,
    ) -> dict[str, Any]:
        generation_cfg: dict[str, Any] = {
            "temperature": 0.0,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        }
        if include_thinking and "gemini-3" in model_name:
            generation_cfg["thinkingConfig"] = {"thinkingLevel": "LOW"}

        return {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation_cfg,
        }

    async def _post_generate(
        self,
        *,
        model_name: str,
        system_prompt: str,
        parts: list[dict[str, Any]],
        max_tokens: int,
        timeout_seconds: float | None,
        include_thinking: bool = True,
    ) -> httpx.Response:
        url = f"{_GEMINI_BASE_URL}/models/{model_name}:generateContent"
        payload = self._build_payload(
            model_name=model_name,
            system_prompt=system_prompt,
            parts=parts,
            max_tokens=max_tokens,
            include_thinking=include_thinking,
        )
        effective_timeout = min(timeout_seconds or self._timeout_seconds, 35.0)
        return await self._client.post(
            url,
            headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=effective_timeout,
        )

    @retry(
        retry=retry_if_exception_type(ProviderUpstreamError),
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=2.5),
        reraise=True,
    )
    async def _call_generate(
        self,
        *,
        model: str,
        system_prompt: str,
        parts: list[dict[str, Any]],
        max_tokens: int = 2048,
        timeout_seconds: float | None = None,
    ) -> tuple[str, int, int, str]:
        self._breaker.before_call()
        candidate_model = model
        try:
            resp = await self._post_generate(
                model_name=candidate_model,
                system_prompt=system_prompt,
                parts=parts,
                max_tokens=max_tokens,
                timeout_seconds=timeout_seconds,
            )
            if (
                resp.status_code == 400
                and "gemini-3" in candidate_model
                and "thinking" in resp.text.lower()
            ):
                resp = await self._post_generate(
                    model_name=candidate_model,
                    system_prompt=system_prompt,
                    parts=parts,
                    max_tokens=max_tokens,
                    timeout_seconds=timeout_seconds,
                    include_thinking=False,
                )

            if resp.status_code in (404, 503) and candidate_model != _FALLBACK_GEMINI_MODEL:
                logger.warning(
                    "Gemini model '%s' returned HTTP %d; falling back to '%s'",
                    candidate_model,
                    resp.status_code,
                    _FALLBACK_GEMINI_MODEL,
                )
                candidate_model = _FALLBACK_GEMINI_MODEL
                if model == self._vision_model:
                    self._vision_model = _FALLBACK_GEMINI_MODEL
                if model == self._grade_model:
                    self._grade_model = _FALLBACK_GEMINI_MODEL
                resp = await self._post_generate(
                    model_name=candidate_model,
                    system_prompt=system_prompt,
                    parts=parts,
                    max_tokens=max_tokens,
                    timeout_seconds=timeout_seconds,
                )
        except httpx.TimeoutException as exc:
            if candidate_model != _FALLBACK_GEMINI_MODEL:
                logger.warning(
                    "Gemini model '%s' timed out; falling back once to '%s'",
                    candidate_model,
                    _FALLBACK_GEMINI_MODEL,
                )
                if model == self._vision_model:
                    self._vision_model = _FALLBACK_GEMINI_MODEL
                if model == self._grade_model:
                    self._grade_model = _FALLBACK_GEMINI_MODEL
                try:
                    resp = await self._post_generate(
                        model_name=_FALLBACK_GEMINI_MODEL,
                        system_prompt=system_prompt,
                        parts=parts,
                        max_tokens=max_tokens,
                        timeout_seconds=timeout_seconds,
                    )
                    candidate_model = _FALLBACK_GEMINI_MODEL
                except httpx.HTTPError as inner_exc:
                    self._breaker.record_failure()
                    raise ProviderUpstreamError(
                        f"Gemini transport error: {inner_exc}"
                    ) from inner_exc
            else:
                self._breaker.record_failure()
                raise ProviderUpstreamError(f"Gemini timeout: {exc}") from exc
        except httpx.HTTPError as exc:
            self._breaker.record_failure()
            raise ProviderUpstreamError(f"Gemini transport error: {exc}") from exc

        if resp.status_code >= 500 or resp.status_code == 429:
            self._breaker.record_failure()
            raise ProviderUpstreamError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")
        if resp.status_code >= 400:
            raise ProviderRequestError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

        self._breaker.record_success()
        body = resp.json()
        candidates = body.get("candidates") or []
        if not candidates:
            raise ProviderRequestError("Gemini returned no candidates in response")
        content_parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "\n".join(str(p.get("text", "")) for p in content_parts if "text" in p).strip()
        if not text:
            raise ProviderRequestError("Gemini candidate returned empty text")

        usage = body.get("usageMetadata") or {}
        in_tokens = int(usage.get("promptTokenCount", 0) or 0)
        out_tokens = int(usage.get("candidatesTokenCount", 0) or 0) + int(
            usage.get("thoughtsTokenCount", 0) or 0
        )
        return (text, in_tokens, out_tokens, candidate_model)

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
            raise ProviderRequestError(f"Gemini returned invalid JSON: {exc}") from exc

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
        parts: list[dict[str, Any]] = [
            {"inlineData": {"mimeType": mime, "data": b64}} for b64, mime in processed_images
        ]
        context_note = (
            f"Question statement (context only): {question_prompt_latex}\n"
            if question_prompt_latex
            else ""
        )
        parts.append({"text": f"{context_note}Transcribe the handwritten math lines as JSON."})

        used_model = self._vision_model

        async def _init() -> tuple[str, int, int]:
            nonlocal used_model
            txt, i_t, o_t, used_model = await self._call_generate(
                model=self._vision_model,
                system_prompt=system_prompt,
                parts=parts,
            )
            return txt, i_t, o_t

        async def _repair(prompt: str) -> tuple[str, int, int]:
            txt, i_t, o_t, _ = await self._call_generate(
                model=used_model,
                system_prompt=system_prompt,
                parts=[{"text": prompt}],
            )
            return txt, i_t, o_t

        return await self._run_json_repair(
            model_name=self._vision_model,
            initial_call=_init,
            repair_call=_repair,
        )

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
        target_model = self._vision_model if processed_images else self._grade_model
        parts: list[dict[str, Any]] = [
            {"inlineData": {"mimeType": mime, "data": b64}} for b64, mime in processed_images
        ]
        parts.append({"text": user_prompt})
        used_model = target_model

        async def _init() -> tuple[str, int, int]:
            nonlocal used_model
            txt, i_t, o_t, used_model = await self._call_generate(
                model=target_model,
                system_prompt=system_prompt,
                parts=parts,
                max_tokens=max_tokens,
                timeout_seconds=timeout_seconds,
            )
            return txt, i_t, o_t

        async def _repair(prompt: str) -> tuple[str, int, int]:
            txt, i_t, o_t, _ = await self._call_generate(
                model=used_model,
                system_prompt=system_prompt,
                parts=[{"text": prompt}],
                max_tokens=max_tokens,
                timeout_seconds=timeout_seconds,
            )
            return txt, i_t, o_t

        return await self._run_json_repair(
            model_name=target_model,
            initial_call=_init,
            repair_call=_repair,
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
            for b64, mime in processed_images:
                parts.append({"inlineData": {"mimeType": mime, "data": b64}})
        parts.append(
            {
                "text": build_grading_user_message(
                    question_prompt_latex=question_prompt_latex,
                    model_answer=model_answer,
                    rubric_criteria=rubric_criteria,
                    wrapped_student_work=wrapped_student_work,
                )
            }
        )
        used_model = self._grade_model

        async def _init() -> tuple[str, int, int]:
            nonlocal used_model
            txt, i_t, o_t, used_model = await self._call_generate(
                model=self._grade_model,
                system_prompt=system_prompt,
                parts=parts,
            )
            return txt, i_t, o_t

        async def _repair(prompt: str) -> tuple[str, int, int]:
            txt, i_t, o_t, _ = await self._call_generate(
                model=used_model,
                system_prompt=system_prompt,
                parts=[{"text": prompt}],
            )
            return txt, i_t, o_t

        return await self._run_json_repair(
            model_name=self._grade_model,
            initial_call=_init,
            repair_call=_repair,
        )
