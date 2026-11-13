from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from pathlib import Path

from app.cache import GradeResultCache
from app.config import Settings
from app.pipeline.service import GradingPipelineService
from app.providers.fake_provider import FakeProvider
from app.schemas import GradeEssayRequest, ImagePayloadIn, ModelAnswerIn, RubricCriterionIn
from eval.fixtures import build_eval_suite, render_synthetic_handwriting_b64


@dataclass(frozen=True)
class EvalCaseReport:
    case_id: str
    passed: bool
    ai_total: float
    max_points: float
    error_type: str
    sympy_status: str
    needs_review: bool
    review_reasons: list[str]
    latency_ms: int
    cost_usd: float


@dataclass(frozen=True)
class EvalSummary:
    total_cases: int
    passed_cases: int
    pass_rate: float
    gate_tp: int
    gate_fp: int
    gate_tn: int
    gate_fn: int
    gate_precision: float
    gate_recall: float
    total_cost_usd: float
    avg_latency_ms: float
    reports: list[EvalCaseReport]


async def run_eval_harness() -> EvalSummary:
    settings = Settings(ai_provider="fake")
    service = GradingPipelineService(
        settings=settings,
        provider=FakeProvider(),
        cache=GradeResultCache(),
    )
    rubric = [
        RubricCriterionIn(
            key="derivative_rule",
            descriptionEn="Applies derivative rule correctly",
            descriptionAr="تطبيق قاعدة الاشتقاق بشكل صحيح",
            maxPoints=10.0,
        ),
        RubricCriterionIn(
            key="final_evaluation",
            descriptionEn="Evaluates final value cleanly",
            descriptionAr="حساب القيمة النهائية بدقة",
            maxPoints=5.0,
        ),
    ]

    cases = build_eval_suite()
    reports: list[EvalCaseReport] = []
    tp = fp = tn = fn = 0

    for item in cases:
        b64, sha = render_synthetic_handwriting_b64(
            item.lines_to_draw,
            blur_radius=item.blur_radius,
            blank=item.blank,
        )
        req = GradeEssayRequest(
            questionPromptLatex=item.question_prompt,
            modelAnswer=ModelAnswerIn(
                solutionStepsLatex=item.expected_steps,
                finalAnswerLatex=item.expected_final_latex,
                finalAnswerSympy=item.expected_final_sympy,
                commonMistakes="Sign errors and missing chain rule factor",
            ),
            rubricCriteria=rubric,
            images=[ImagePayloadIn(dataBase64=b64, mimeType="image/jpeg", sha256=sha)],
            rubricVersion=1,
            forceRefresh=True,
            hintTag=item.hint_tag,
        )
        res = await service.grade_essay(req)

        has_expected_reasons = all(r in res.reviewReasons for r in item.expected_reason_subset)
        passed = (
            res.errorType == item.expected_error_type
            and res.needsReview == item.expect_needs_review
            and has_expected_reasons
            and res.aiTotal <= res.maxPoints
        )

        if item.expect_needs_review and res.needsReview:
            tp += 1
        elif not item.expect_needs_review and res.needsReview:
            fp += 1
        elif not item.expect_needs_review and not res.needsReview:
            tn += 1
        else:
            fn += 1

        reports.append(
            EvalCaseReport(
                case_id=item.case_id,
                passed=passed,
                ai_total=res.aiTotal,
                max_points=res.maxPoints,
                error_type=res.errorType,
                sympy_status=res.sympyCheck.status,
                needs_review=res.needsReview,
                review_reasons=res.reviewReasons,
                latency_ms=res.latencyMs,
                cost_usd=res.costUsd,
            )
        )

    total = len(reports)
    passed_count = sum(1 for r in reports if r.passed)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    avg_latency = sum(r.latency_ms for r in reports) / max(1, total)
    total_cost = sum(r.cost_usd for r in reports)

    return EvalSummary(
        total_cases=total,
        passed_cases=passed_count,
        pass_rate=passed_count / max(1, total),
        gate_tp=tp,
        gate_fp=fp,
        gate_tn=tn,
        gate_fn=fn,
        gate_precision=precision,
        gate_recall=recall,
        total_cost_usd=total_cost,
        avg_latency_ms=avg_latency,
        reports=reports,
    )


def format_evaluation_markdown(summary: EvalSummary) -> str:
    lines = [
        "# MathLens AI Grading Evaluation Report",
        "",
        "Generated automatically by `python -m eval.harness --write-docs` using deterministic "
        "synthetic handwritten fixtures (`FakeProvider` + OpenCV + SymPy Lark + quality gate).",
        "",
        "## Summary Metrics",
        "",
        f"- **Cases Passed**: {summary.passed_cases}/{summary.total_cases} "
        f"({summary.pass_rate * 100:.1f}%)",
        f"- **Quality Gate Precision**: {summary.gate_precision * 100:.1f}% "
        f"(TP={summary.gate_tp}, FP={summary.gate_fp})",
        f"- **Quality Gate Recall**: {summary.gate_recall * 100:.1f}% "
        f"(TN={summary.gate_tn}, FN={summary.gate_fn})",
        f"- **Average Pipeline Latency**: {summary.avg_latency_ms:.1f} ms",
        f"- **Simulated Eval Cost**: ${summary.total_cost_usd:.6f}",
        "",
        "## Per-Case Results",
        "",
        "| Case | Passed | Score | Error Type | SymPy | Review | Reasons | Latency (ms) |",
        "|---|---:|---:|---|---|---:|---|---:|",
    ]
    for r in summary.reports:
        reasons = ", ".join(r.review_reasons) if r.review_reasons else "-"
        status_str = "PASS" if r.passed else "FAIL"
        row = (
            f"| `{r.case_id}` | {status_str} | {r.ai_total:.1f}/{r.max_points:.1f} "
            f"| `{r.error_type}` | `{r.sympy_status}` | `{r.needs_review}` "
            f"| {reasons} | {r.latency_ms} |"
        )
        lines.append(row)
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-docs", action="store_true")
    args = parser.parse_args()

    summary = asyncio.run(run_eval_harness())
    md = format_evaluation_markdown(summary)
    if args.write_docs:
        out_path = Path(__file__).resolve().parents[3] / "docs" / "EVALUATION.md"
        out_path.write_text(md, encoding="utf-8")
    print(md)
    return 0 if summary.passed_cases == summary.total_cases else 1


if __name__ == "__main__":
    raise SystemExit(main())
