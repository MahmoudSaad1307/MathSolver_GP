import logging
from typing import Any, Dict, Optional
import ollama
from config import Settings, get_settings
from llm.client import extract_json

logger = logging.getLogger(__name__)

class OllamaClientWrapper:
    """
    Fallback client using local Ollama instance when Groq is unavailable,
    quota is exceeded, or USE_GROQ=false is set for privacy.
    """
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._client: Optional[ollama.Client] = None

    @property
    def client(self) -> ollama.Client:
        if self._client is None:
            self._client = ollama.Client(host=self.settings.ollama_host)
        return self._client

    def chat_json(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Chat completion using Ollama expecting JSON output.
        """
        target_model = model or self.settings.ollama_reason_model
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        logger.info(f"Calling Ollama chat with model: {target_model}")
        try:
            response = self.client.chat(
                model=target_model,
                messages=messages,
                format="json",
            )
            content = response["message"]["content"]
            return extract_json(content)
        except Exception as e:
            logger.error(f"Ollama chat error on model {target_model}: {e}")
            raise RuntimeError(f"تعذر الاتصال بـ Ollama: {e}")

    def vision_ocr(
        self,
        image_base64: str,
        prompt: str,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        OCR call using Ollama vision model (e.g. qwen2.5vl:7b).
        """
        target_model = model or self.settings.ollama_vision_model
        logger.info(f"Calling Ollama vision OCR with model: {target_model}")
        try:
            response = self.client.chat(
                model=target_model,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                        "images": [image_base64],
                    }
                ],
                format="json",
            )
            content = response["message"]["content"]
            return extract_json(content)
        except Exception as e:
            logger.error(f"Ollama vision OCR error on model {target_model}: {e}")
            raise RuntimeError(f"تعذر تشغيل قراءة الصورة عبر Ollama: {e}")
