from __future__ import annotations

from typing import Any, cast

import groq
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.providers.base import (
    CircuitBreaker,
    LLMProvider,
    ProviderUpstreamError,
    RawProviderCall,
)
from app.providers.json_helper import build_grading_user_message, execute_with_json_repair
from app.schemas import ModelAnswerIn, RubricCriterionIn


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
        content_parts: list[dict[str, Any]],
    ) -> tuple[str, int, int]:
        self._breaker.before_call()
        try:
            messages_payload = cast(
                Any,
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": content_parts},
                ],
            )
            response = await self._client.chat.completions.create(
                model=model,
                temperature=0.0,
                max_tokens=1800,
                messages=messages_payload,
            )
            self._breaker.record_success()
            content = response.choices[0].message.content or ""
            usage = getattr(response, "usage", None)
            in_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            out_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            return (content, in_tokens, out_tokens)
        except groq.APIStatusError as exc:
            if exc.status_code >= 500 or exc.status_code == 429:
                self._breaker.record_failure()
                raise ProviderUpstreamError(f"Groq HTTP {exc.status_code}: {exc}") from exc
            raise
        except (groq.APIConnectionError, groq.APITimeoutError) as exc:
            self._breaker.record_failure()
            raise ProviderUpstreamError(f"Groq transport error: {exc}") from exc

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
        for b64, mime in processed_images:
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
