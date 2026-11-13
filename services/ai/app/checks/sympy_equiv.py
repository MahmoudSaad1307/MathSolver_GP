from __future__ import annotations

from app.checks.sympy_sandbox import compare_expressions_in_sandbox
from app.schemas import ModelAnswerIn, SympyCheckResult, TranscriptionResult


def verify_final_answer_equivalence(
    transcription: TranscriptionResult,
    model_answer: ModelAnswerIn,
    *,
    timeout_seconds: float = 3.0,
) -> SympyCheckResult:
    expected = model_answer.finalAnswerSympy or model_answer.finalAnswerLatex
    if not expected or not expected.strip():
        return SympyCheckResult(
            checked=False,
            status="NOT_APPLICABLE",
            studentFinalSympy=transcription.finalAnswerLatex,
            expectedFinalSympy=None,
            equivalent=None,
            detail="No model answer reference provided for SymPy check",
        )

    student_candidate = transcription.finalAnswerLatex
    if not student_candidate:
        non_empty = [
            line.textLatex
            for line in transcription.lines
            if not line.crossedOut and not line.illegible and line.textLatex.strip()
        ]
        student_candidate = non_empty[-1] if non_empty else None

    if (
        not student_candidate
        or "[[ILLEGIBLE]]" in student_candidate
        or "[[UNSURE:" in student_candidate
    ):
        return SympyCheckResult(
            checked=False,
            status="UNPARSABLE",
            studentFinalSympy=student_candidate,
            expectedFinalSympy=expected,
            equivalent=None,
            detail="Student final expression missing or contains uncertainty marker",
        )

    return compare_expressions_in_sandbox(
        student_candidate,
        expected,
        timeout_seconds=timeout_seconds,
    )
