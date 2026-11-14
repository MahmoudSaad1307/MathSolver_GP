from __future__ import annotations

import logging
import time
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
_FALLBACK_GEMINI_MODEL = "gemini-flash-lite-latest"
_GEMINI_FALLBACK_ORDER: tuple[str, ...] = (
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
)


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
        self._model_cooldowns: dict[str, float] = {}

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

    def _candidate_models(self, preferred: str) -> list[str]:
        now = time.monotonic()
        ordered = [preferred, *(m for m in _GEMINI_FALLBACK_ORDER if m != preferred)]
        available = [m for m in ordered if self._model_cooldowns.get(m, 0.0) <= now]
        return available or ordered

    def _pin_fallback_model(self, failed_model: str, replacement: str) -> None:
        if failed_model == self._vision_model:
            self._vision_model = replacement
        if failed_model == self._grade_model:
            self._grade_model = replacement

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
        candidates_to_try = self._candidate_models(model)
        last_upstream_err: str | None = None
        last_status = 503

        for idx, candidate_model in enumerate(candidates_to_try):
            has_next = idx + 1 < len(candidates_to_try)
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
            except httpx.TimeoutException as exc:
                self._model_cooldowns[candidate_model] = time.monotonic() + 60.0
                if has_next:
                    nxt = candidates_to_try[idx + 1]
                    logger.warning(
                        "Gemini model '%s' timed out; switching to '%s'",
                        candidate_model,
                        nxt,
                    )
                    self._pin_fallback_model(model, nxt)
                    last_upstream_err = f"Gemini timeout: {exc}"
                    continue
                self._breaker.record_failure()
                raise ProviderUpstreamError(f"Gemini timeout: {exc}") from exc
            except httpx.HTTPError as exc:
                self._breaker.record_failure()
                raise ProviderUpstreamError(f"Gemini transport error: {exc}") from exc

            if resp.status_code in (404, 429, 503) and has_next:
                cooldown = 300.0 if resp.status_code in (404, 429) else 45.0
                self._model_cooldowns[candidate_model] = time.monotonic() + cooldown
                nxt = candidates_to_try[idx + 1]
                logger.warning(
                    "Gemini model '%s' returned HTTP %d; falling back to '%s'",
                    candidate_model,
                    resp.status_code,
                    nxt,
                )
                self._pin_fallback_model(model, nxt)
                last_status = resp.status_code
                last_upstream_err = f"Gemini HTTP {resp.status_code}: {resp.text[:300]}"
                continue

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

        self._breaker.record_failure()
        raise ProviderUpstreamError(last_upstream_err or f"Gemini HTTP {last_status}: exhausted")

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
