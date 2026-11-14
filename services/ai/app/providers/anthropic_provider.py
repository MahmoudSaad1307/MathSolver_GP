from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, cast

import anthropic
from anthropic.types import TextBlock
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


class AnthropicProvider(LLMProvider):
    provider_name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        transcribe_model: str,
        grade_model: str,
        timeout_seconds: float = 35.0,
    ) -> None:
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic")
        self._client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout_seconds)
        self._transcribe_model = transcribe_model
        self._grade_model = grade_model
        self._breaker = CircuitBreaker()

    @retry(
        retry=retry_if_exception_type(ProviderUpstreamError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.8, min=0.8, max=6.0),
        reraise=True,
    )
    async def _call_messages(
        self,
        *,
        model: str,
        system_prompt: str,
        content_blocks: list[dict[str, Any]],
        max_tokens: int = 1800,
        timeout_seconds: float | None = None,
    ) -> tuple[str, int, int]:
        self._breaker.before_call()
        client = (
            self._client.with_options(timeout=timeout_seconds)
            if timeout_seconds is not None and hasattr(self._client, "with_options")
            else self._client
        )
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=0.0,
                system=system_prompt,
                messages=cast(Any, [{"role": "user", "content": content_blocks}]),
            )
            self._breaker.record_success()
            text_parts = [block.text for block in response.content if isinstance(block, TextBlock)]
            usage = getattr(response, "usage", None)
            in_tokens = int(getattr(usage, "input_tokens", 0) or 0)
            out_tokens = int(getattr(usage, "output_tokens", 0) or 0)
            return ("\n".join(text_parts), in_tokens, out_tokens)
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500 or exc.status_code == 429:
                self._breaker.record_failure()
                raise ProviderUpstreamError(f"Anthropic HTTP {exc.status_code}: {exc}") from exc
            raise ProviderRequestError(f"Anthropic HTTP {exc.status_code}: {exc}") from exc
        except (anthropic.APIConnectionError, anthropic.APITimeoutError) as exc:
            self._breaker.record_failure()
            raise ProviderUpstreamError(f"Anthropic transport error: {exc}") from exc

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
            raise ProviderRequestError(f"Anthropic returned invalid JSON: {exc}") from exc

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
        blocks: list[dict[str, Any]] = []
        for b64, mime in processed_images:
            blocks.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": mime, "data": b64},
                }
            )
        context_note = (
            f"Question statement (context only): {question_prompt_latex}\n"
            if question_prompt_latex
            else ""
        )
        blocks.append(
            {
                "type": "text",
                "text": f"{context_note}Transcribe the handwritten math lines now as strict JSON.",
            }
        )

        return await execute_with_json_repair(
            model_name=self._transcribe_model,
            initial_call=lambda: self._call_messages(
                model=self._transcribe_model,
                system_prompt=system_prompt,
                content_blocks=blocks,
            ),
            repair_call=lambda prompt: self._call_messages(
                model=self._transcribe_model,
                system_prompt=system_prompt,
                content_blocks=[{"type": "text", "text": prompt}],
            ),
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
        model_name = self._transcribe_model if processed_images else self._grade_model
        blocks: list[dict[str, Any]] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": b64},
            }
            for b64, mime in processed_images
        ]
        blocks.append({"type": "text", "text": user_prompt})
        return await self._run_json_repair(
            model_name=model_name,
            initial_call=lambda: self._call_messages(
                model=model_name,
                system_prompt=system_prompt,
                content_blocks=blocks,
                max_tokens=max_tokens,
                timeout_seconds=timeout_seconds,
            ),
            repair_call=lambda prompt: self._call_messages(
                model=model_name,
                system_prompt=system_prompt,
                content_blocks=[{"type": "text", "text": prompt}],
                max_tokens=max_tokens,
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
        blocks: list[dict[str, Any]] = []
        if include_images:
            for b64, mime in processed_images:
                blocks.append(
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime, "data": b64},
                    }
                )
        blocks.append(
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
            initial_call=lambda: self._call_messages(
                model=self._grade_model,
                system_prompt=system_prompt,
                content_blocks=blocks,
            ),
            repair_call=lambda prompt: self._call_messages(
                model=self._grade_model,
                system_prompt=system_prompt,
                content_blocks=[{"type": "text", "text": prompt}],
            ),
        )
