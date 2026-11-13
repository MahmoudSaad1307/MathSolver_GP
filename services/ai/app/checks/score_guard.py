from __future__ import annotations

from dataclasses import dataclass

from app.schemas import CriterionScoreOut, RubricCriterionIn, SympyCheckResult


@dataclass(frozen=True)
class ScoreGuardOutcome:
    criteria_scores: list[CriterionScoreOut]
    ai_total: float
    max_points: float
    final_answer_correct: bool | None
    total_mismatch: bool
    sympy_mismatch: bool


def enforce_rubric_score_guard(
    *,
    raw_criteria: list[dict[str, object]],
    rubric_criteria: list[RubricCriterionIn],
    claimed_total: float | None,
    llm_final_answer_correct: bool | None,
    sympy_check: SympyCheckResult,
) -> ScoreGuardOutcome:
    raw_by_key: dict[str, dict[str, object]] = {}
    for item in raw_criteria:
        key = str(item.get("criterionKey", "")).strip()
        if key:
            raw_by_key[key] = item

    bounded_scores: list[CriterionScoreOut] = []
    running_sum = 0.0
    max_points = 0.0
    out_of_bounds_detected = False

    for crit in rubric_criteria:
        max_points += float(crit.maxPoints)
        matched = raw_by_key.get(crit.key, {})
        raw_pts_val = matched.get("awardedPoints", 0.0)
        try:
            raw_pts = float(raw_pts_val)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raw_pts = 0.0
            out_of_bounds_detected = True

        if raw_pts < 0.0 or raw_pts > float(crit.maxPoints):
            out_of_bounds_detected = True

        clamped = round(min(max(0.0, raw_pts), float(crit.maxPoints)), 2)
        running_sum += clamped

        ev_step_raw = matched.get("evidenceStep")
        ev_step = int(ev_step_raw) if isinstance(ev_step_raw, int) else None
        comment_ar = str(matched.get("commentAr", "")).strip()
        met_flag = bool(matched.get("met", clamped >= float(crit.maxPoints) - 1e-6))

        bounded_scores.append(
            CriterionScoreOut(
                criterionKey=crit.key,
                awardedPoints=clamped,
                maxPoints=float(crit.maxPoints),
                met=met_flag,
                evidenceStep=ev_step,
                commentAr=comment_ar,
            )
        )

    recomputed_total = round(min(max(0.0, running_sum), max_points), 2)
    total_mismatch = out_of_bounds_detected or (
        claimed_total is not None and abs(float(claimed_total) - recomputed_total) > 0.05
    )

    sympy_mismatch = False
    final_correct = llm_final_answer_correct

    if sympy_check.status == "EQUIVALENT":
        if llm_final_answer_correct is False:
            sympy_mismatch = True
        final_correct = True
    elif sympy_check.status == "NOT_EQUIVALENT":
        if llm_final_answer_correct is True or recomputed_total >= max_points - 1e-6:
            sympy_mismatch = True
        final_correct = False

    return ScoreGuardOutcome(
        criteria_scores=bounded_scores,
        ai_total=recomputed_total,
        max_points=round(max_points, 2),
        final_answer_correct=final_correct,
        total_mismatch=total_mismatch,
        sympy_mismatch=sympy_mismatch,
    )
