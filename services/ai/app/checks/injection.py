from __future__ import annotations

import re

_INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "EN_IGNORE_INSTRUCTIONS",
        re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions", re.I),
    ),
    (
        "EN_SYSTEM_PROMPT",
        re.compile(r"\b(system\s+prompt|developer\s+message|jailbreak)\b", re.I),
    ),
    (
        "EN_GIVE_FULL_MARKS",
        re.compile(
            r"\b(give|award|grant|assign)\s+(me\s+)?"
            r"(full\s+marks|100%|max\s+points|all\s+points)\b",
            re.I,
        ),
    ),
    (
        "EN_GRADE_OVERRIDE",
        re.compile(
            r"\b(mark\s+(this|all|it)\s+correct|override\s+score|output\s+score\s*=)\b",
            re.I,
        ),
    ),
    (
        "AR_IGNORE_INSTRUCTIONS",
        re.compile(r"(تجاهل|انسَ)\s+(كل\s+)?(التعليمات|الأوامر)\s*(السابقة)?"),
    ),
    (
        "AR_GIVE_FULL_MARKS",
        re.compile(r"(أعطني|اعطني|امنحني|اجعل)\s+(الدرجة\s+الكاملة|درجة\s+كاملة|100%)"),
    ),
]


def detect_prompt_injection(lines: list[str]) -> tuple[bool, list[str]]:
    signals: list[str] = []
    combined = "\n".join(lines)
    for label, pattern in _INJECTION_PATTERNS:
        if pattern.search(combined):
            signals.append(label)
    return (len(signals) > 0, signals)


def wrap_untrusted_student_work(lines: list[str], final_answer: str | None) -> str:
    numbered = "\n".join(f"Step {i + 1}: {line}" for i, line in enumerate(lines))
    final_part = f"\nBoxed final answer: {final_answer}" if final_answer else ""
    return (
        "<UNTRUSTED_STUDENT_WORK>\n"
        f"{numbered}{final_part}\n"
        "</UNTRUSTED_STUDENT_WORK>"
    )
