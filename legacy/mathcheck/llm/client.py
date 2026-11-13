import json
import logging
import re
import time
from typing import Any, Dict, List, Optional
import groq
from config import Settings, get_settings

logger = logging.getLogger(__name__)

def extract_json(raw_text: str) -> Dict[str, Any]:
    """
    Robust JSON extraction: slices from the first '{' to the last '}'
    to strip thoughts, preamble, or trailing text produced by reasoning models.
    """
    if not raw_text or not raw_text.strip():
        raise ValueError("Empty response text cannot be parsed as JSON.")

    text = raw_text.strip()
    first_brace = text.find("{")
    last_brace = text.rfind("}")

    if first_brace == -1 or last_brace == -1 or last_brace < first_brace:
        raise ValueError(f"No valid JSON object found in response: {text[:100]}...")

    sliced = text[first_brace : last_brace + 1]

    try:
        return json.loads(sliced)
    except json.JSONDecodeError:
        # Fallback: remove markdown block markers or trailing commas
        cleaned = re.sub(r",\s*([\]}])", r"\1", sliced)
        return json.loads(cleaned)

class GroqClientWrapper:
    """
    Wrapper for Groq API with ordered model fallback, 429 rate limit retry,
    and automatic JSON slicing.
    """
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._client: Optional[groq.Groq] = None
        if self.settings.is_groq_ready():
            self._client = groq.Groq(api_key=self.settings.groq_api_key)

    @property
    def client(self) -> groq.Groq:
        if self._client is None:
            if not self.settings.groq_api_key:
                raise RuntimeError("مفتاح GROQ_API_KEY غير موجود في الإعدادات.")
            self._client = groq.Groq(api_key=self.settings.groq_api_key)
        return self._client

    def _execute_with_retry(self, call_fn: Any, model_name: str) -> Any:
        """
        Executes an API call with up to 2 retries on 429 rate limit errors.
        """
        max_retries = 2
        backoff_seconds = 2.0

        for attempt in range(max_retries + 1):
            try:
                return call_fn()
            except groq.RateLimitError as rle:
                if attempt == max_retries:
                    logger.warning(f"Groq Rate limit (429) retries exhausted for model {model_name}")
                    raise
                # Check for retry-after in headers or message
                sleep_time = backoff_seconds * (2 ** attempt)
                try:
                    if hasattr(rle, "response") and rle.response and "retry-after" in rle.response.headers:
                        sleep_time = float(rle.response.headers["retry-after"])
                except Exception:
                    pass
                logger.info(f"Rate limited (429) on {model_name}. Retrying in {sleep_time:.1f}s...")
                time.sleep(sleep_time)
            except Exception as e:
                logger.warning(f"Error calling Groq model {model_name}: {e}")
                raise

    def chat_json(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        candidate_models: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Send a chat completion request to Groq expecting JSON.
        Tries candidate models in order. Falls back to next model on failure.
        """
        models = candidate_models or self.settings.groq_reason_models
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        last_error: Optional[Exception] = None

        for model in models:
            logger.info(f"Attempting Groq chat with model: {model}")
            try:
                def call():
                    return self.client.chat.completions.create(
                        model=model,
                        messages=messages,
                        response_format={"type": "json_object"},
                        temperature=0.1,
                    )
                response = self._execute_with_retry(call, model)
                content = response.choices[0].message.content or ""
                return extract_json(content)
            except Exception as exc:
                logger.warning(f"Model {model} failed in chat_json: {exc}")
                last_error = exc
                continue

        raise RuntimeError(f"All Groq reason models failed: {last_error}")

    def vision_ocr(
        self,
        image_base64: str,
        prompt: str,
        model: str,
    ) -> Dict[str, Any]:
        """
        Send an OCR request with an image to a specific Groq vision model.
        """
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                    },
                ],
            }
        ]

        def call():
            return self.client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.0,
            )

        response = self._execute_with_retry(call, model)
        content = response.choices[0].message.content or ""
        return extract_json(content)
