from __future__ import annotations

from app.schemas import ErrorTypeLiteral, SympyCheckResult, TranscriptionResult


def evaluate_quality_gate(
    *,
    is_blank: bool,
    is_blurry: bool,
    transcription: TranscriptionResult,
    grader_confidence: float,
    min_confidence: float,
    max_illegible_ratio: float,
    sympy_check: SympyCheckResult,
    final_answer_correct: bool | None,
    error_type: ErrorTypeLiteral,
    ai_total: float,
    max_points: float,
    schema_retry_used: bool,
    total_mismatch: bool,
    sympy_mismatch: bool,
) -> tuple[bool, list[str]]:
    reasons: list[str] = []

    def add_reason(code: str) -> None:
        if code not in reasons:
            reasons.append(code)

    if is_blank or len(transcription.lines) == 0:
        add_reason("EMPTY_SUBMISSION")

    if grader_confidence < min_confidence or transcription.overallConfidence < min_confidence:
        add_reason("LOW_CONFIDENCE")

    if transcription.containsUnsureToken or any(line.hasUnsure for line in transcription.lines):
        add_reason("UNSURE_EVIDENCE_TOKEN")

    if is_blurry or transcription.illegibleRatio > max_illegible_ratio:
        add_reason("HIGH_ILLEGIBLE_RATIO")

    if transcription.injectionDetected:
        add_reason("INJECTION_ATTEMPT")

    if schema_retry_used:
        add_reason("SCHEMA_RETRY_USED")

    if total_mismatch:
        add_reason("TOTAL_MISMATCH")

    if sympy_mismatch:
        add_reason("SYMPY_MISMATCH")

    if error_type == "none" and (final_answer_correct is False or ai_total < max_points - 1e-6):
        add_reason("STEP_CHECK_MISMATCH")

    if sympy_check.status == "TIMEOUT":
        add_reason("SYMPY_MISMATCH")

    return (len(reasons) > 0, reasons)
