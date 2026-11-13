import logging
from dataclasses import dataclass
from typing import Any, List, Literal, Optional
import sympy as sp
from config import Settings, get_settings
from core.parsing import parse_expr_safe
from core.verify import check_step
from llm.client import GroqClientWrapper
from llm.ollama_fallback import OllamaClientWrapper
from llm.prompts import EXPLAIN_MISTAKE_TEMPLATE

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class MistakeExplanation:
    mistake: str
    rule: str
    correct_step_raw: str
    correct_step_latex: Optional[str] = None

@dataclass(frozen=True)
class StudentStepResult:
    step_number: int
    raw_text: str
    parsed_expr: Optional[sp.Basic]
    status: Literal["ok", "bad", "unknown", "downstream_ok", "parse_error"]
    note: str
    explanation: Optional[MistakeExplanation] = None

@dataclass(frozen=True)
class CheckResult:
    success: bool
    summary_message: str
    steps: List[StudentStepResult]
    first_bad_step: Optional[int] = None
    parse_error_line: Optional[int] = None

def _compute_trusted_reference(expr: sp.Basic) -> str:
    """
    Compute trusted mathematical reference from step A using SymPy
    so the LLM explains using verified math rather than hallucinating.
    """
    try:
        if isinstance(expr, sp.Eq):
            syms = list(expr.free_symbols)
            if syms:
                sols = sp.solve(expr, syms[0])
                return f"حلول المعادلة بواسطة SymPy: {sols}"
            return f"معادلة مبسطة: {sp.simplify(expr.lhs - expr.rhs)} = 0"
        
        # Calculus or expressions
        evaluated = expr.doit() if hasattr(expr, "doit") else expr
        simplified = sp.simplify(evaluated)
        return f"الناتج الرياضي الدقيق المبسط: {simplified}"
    except Exception as e:
        return f"التعبير الرياضي: {expr}"

def check_student_steps(
    lines: List[str],
    settings: Optional[Settings] = None,
    client: Optional[Any] = None,
) -> CheckResult:
    """
    Checks handwritten student steps line-by-line.
    Line 1 (index 0) is the problem.
    Lines 2..N (index 1..N-1) are student steps.
    """
    clean_lines = [line.strip() for line in lines if line.strip()]
    if not clean_lines:
        return CheckResult(
            success=False,
            summary_message="لم يتم إدخال أي أسطر للفحص.",
            steps=[],
        )

    if len(clean_lines) < 2:
        return CheckResult(
            success=False,
            summary_message="يرجى كتابة سطر للمسألة وسطر واحد على الأقل للخطوات.",
            steps=[],
        )

    # 1. Parse all lines.
    # The problem line (index 0) is allowed to be a natural-language sentence
    # that parse_expr_safe can't handle — store it as None and let verify_chain
    # cope (it already handles None as 'no previous expression to compare').
    # Only STEP lines (index >= 1) must be parseable; abort immediately if not.
    parsed_items: List[Optional[sp.Basic]] = []
    for idx, line in enumerate(clean_lines, start=1):
        parsed = parse_expr_safe(line)
        if parsed is None and idx > 1:
            # A step line that can't be parsed is a hard blocker
            return CheckResult(
                success=False,
                summary_message=f"تعذر تفسير الخطوة {idx}: '{line}'. يرجى تعديلها في مربع النص أعلاه.",
                steps=[],
                parse_error_line=idx,
            )
        parsed_items.append(parsed)

    problem_expr = parsed_items[0]
    student_steps = parsed_items[1:]
    student_lines = clean_lines[1:]

    s = settings or get_settings()
    if client is None:
        if s.is_groq_ready():
            client = GroqClientWrapper(s)
        else:
            client = OllamaClientWrapper(s)

    results: List[StudentStepResult] = []
    first_bad_step_num: Optional[int] = None
    first_bad_explanation: Optional[MistakeExplanation] = None

    current_prev = problem_expr

    for i, (expr, raw_txt) in enumerate(zip(student_steps, student_lines), start=1):
        status, note = check_step(current_prev, expr)

        if first_bad_step_num is None:
            # We haven't hit the first error yet
            if status == "ok":
                results.append(
                    StudentStepResult(
                        step_number=i,
                        raw_text=raw_txt,
                        parsed_expr=expr,
                        status="ok",
                        note=note,
                    )
                )
                current_prev = expr
            elif status == "bad":
                # FIRST BAD STEP: Call LLM with SymPy trusted reference!
                first_bad_step_num = i
                ref = _compute_trusted_reference(current_prev)
                prompt = EXPLAIN_MISTAKE_TEMPLATE.format(
                    problem=clean_lines[0],
                    step_a=str(current_prev),
                    step_b=raw_txt,
                    reference=ref,
                )

                try:
                    resp = client.chat_json(prompt)
                    correct_raw = str(resp.get("correct_step", "")).strip()
                    correct_parsed = parse_expr_safe(correct_raw)
                    correct_latex = sp.latex(correct_parsed) if correct_parsed is not None else None

                    first_bad_explanation = MistakeExplanation(
                        mistake=str(resp.get("mistake", "خطأ في تطبيق العملية الرياضية")),
                        rule=str(resp.get("rule", "قواعد الحساب الجبري")),
                        correct_step_raw=correct_raw,
                        correct_step_latex=correct_latex,
                    )
                except Exception as exc:
                    logger.warning(f"Mistake explanation LLM call failed: {exc}")
                    first_bad_explanation = MistakeExplanation(
                        mistake="الخطوة غير متكافئة رياضياً مع الخطوة السابقة.",
                        rule="قواعد التحويل الرياضي",
                        correct_step_raw="",
                    )

                results.append(
                    StudentStepResult(
                        step_number=i,
                        raw_text=raw_txt,
                        parsed_expr=expr,
                        status="bad",
                        note="الخطأ الأول ظهر هنا",
                        explanation=first_bad_explanation,
                    )
                )
                # Next step compares against this bad step to see if algebra was valid downstream
                current_prev = expr
            else:
                # unknown
                results.append(
                    StudentStepResult(
                        step_number=i,
                        raw_text=raw_txt,
                        parsed_expr=expr,
                        status="unknown",
                        note=note,
                    )
                )
                current_prev = expr
        else:
            # After first bad step: check but label as downstream
            if status == "ok":
                results.append(
                    StudentStepResult(
                        step_number=i,
                        raw_text=raw_txt,
                        parsed_expr=expr,
                        status="downstream_ok",
                        note="سليمة بس مبنية على الغلط اللي فات",
                    )
                )
            else:
                results.append(
                    StudentStepResult(
                        step_number=i,
                        raw_text=raw_txt,
                        parsed_expr=expr,
                        status="bad",
                        note="خطأ إضافي",
                    )
                )
            current_prev = expr

    if first_bad_step_num is None:
        return CheckResult(
            success=True,
            summary_message="كل خطواتك سليمة! أحسنت 🎉",
            steps=results,
        )
    else:
        return CheckResult(
            success=False,
            summary_message=f"تم رصد أول خطأ في الخطوة رقم {first_bad_step_num}.",
            steps=results,
            first_bad_step=first_bad_step_num,
        )
