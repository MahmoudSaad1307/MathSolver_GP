from __future__ import annotations

import hashlib
import json
from collections import OrderedDict

from app.schemas import GradeEssayResponse


def build_grade_cache_key(
    *,
    image_hashes: list[str],
    prompt_version: str,
    rubric_version: int,
    question_prompt_latex: str,
    provider: str,
    model_name: str,
) -> str:
    payload = json.dumps(
        {
            "image_hashes": image_hashes,
            "prompt_version": prompt_version,
            "rubric_version": rubric_version,
            "question_prompt_latex": question_prompt_latex.strip(),
            "provider": provider,
            "model_name": model_name,
        },
        sort_keys=True,
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"mathlens:ai:grade:{digest}"


class GradeResultCache:
    """In-memory bounded LRU cache avoiding repeated grading on identical content hashes."""

    def __init__(self, max_entries: int = 256) -> None:
        self._max_entries = max_entries
        self._store: OrderedDict[str, GradeEssayResponse] = OrderedDict()

    def get(self, key: str) -> GradeEssayResponse | None:
        item = self._store.get(key)
        if item is None:
            return None
        self._store.move_to_end(key)
        return item.model_copy(update={"cached": True})

    def set(self, key: str, value: GradeEssayResponse) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = value.model_copy(update={"cached": False})
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)

    def clear(self) -> None:
        self._store.clear()
