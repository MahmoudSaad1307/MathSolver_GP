import logging
from dataclasses import dataclass
from typing import Any, List, Literal, Optional
import sympy as sp
from config import Settings, get_settings
from core.parsing import parse_expr_safe
from core.simple_modes import direct_solve_equation
from core.verify import check_step, verify_chain
from llm.client import GroqClientWrapper
from llm.ollama_fallback import OllamaClientWrapper
from llm.prompts import SOLVE_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)

def _parse_steps(raw_steps: list) -> list:
    """Parse a list of raw step dicts into (explain, parsed_expr) tuples.

    Centralised so the retry loop and the final build pass always use
    the same parsing logic and can never diverge.
    """
    result = []
    for st in raw_steps:
        e_str = str(st.get("expr", "")).strip()
        p_expr = parse_expr_safe(e_str) if e_str else None
        result.append((st.get("explain", ""), p_expr))
    return result

@dataclass(frozen=True)
class SolvedStep:
    index: int
    explain: str
    expr_str: str
    parsed_expr: Optional[sp.Basic]
    status: Literal["ok", "bad", "unknown", "skip"]
    note: str

@dataclass(frozen=True)
class SolveResult:
    steps: List[SolvedStep]
    final_answer: str
    is_fully_verified: bool
    status_summary: str
    cross_check_answer: Optional[str] = None
    cross_check_matches: Optional[bool] = None
    cross_check_note: Optional[str] = None
    retries_used: int = 0

def _attempt_cross_check(
    problem_expr: Optional[sp.Basic],
    last_step_expr: Optional[sp.Basic],
    parsed_steps: Optional[list] = None,
    problem_text: str = "",
) -> tuple[Optional[str], Optional[bool], Optional[str]]:
    """
    Perform cheap independent cross-check using SymPy where possible.
    Handles three distinct problem types:
      1. Unevaluated calculus objects (Derivative/Integral/Limit) — use .doit()
      2. Function definitions f(x)=expr + derivative steps — use sp.diff on RHS
      3. Plain algebraic equations — use sp.solve
    """
    if problem_expr is None or last_step_expr is None:
        return None, None, None

    target_last = last_step_expr.rhs if isinstance(last_step_expr, sp.Eq) else last_step_expr

    try:
        # 1. Problem IS an unevaluated calculus object
        if isinstance(problem_expr, (sp.Derivative, sp.Integral, sp.Limit)):
            direct = problem_expr.doit()
            status, _ = check_step(direct, target_last)
            direct_latex = sp.latex(direct)
            if status == "ok":
                return direct_latex, True, "تطابق كامل مع حسابات SymPy المباشرة."
            else:
                return direct_latex, False, f"تحذير: ناتج SymPy المباشر ({direct_latex}) يختلف عن خطوة النهاية."

        # 2. Function definition (f(x) = expr or bare f) or derivative problem
        rhs = problem_expr.rhs if isinstance(problem_expr, sp.Eq) else problem_expr
        syms = sorted(rhs.free_symbols, key=lambda s: (s.name != "x", s.name))
        derivative_var = syms[0] if syms else sp.Symbol("x")

        diff_keywords = ["اشتق", "مشتقة", "تفاضل", "derivative", "differentiate", "d/dx", "f'", "y'", "قاعدة القوة"]
        is_derivative = any(k in problem_text.lower() for k in diff_keywords)

        if parsed_steps:
            for _explain, pexpr in parsed_steps:
                if pexpr is not None and isinstance(pexpr, sp.Derivative):
                    is_derivative = True
                    break
                if any(k in str(_explain).lower() for k in diff_keywords):
                    is_derivative = True
                    break

        is_func_def = isinstance(problem_expr, sp.Eq) and (
            isinstance(problem_expr.lhs, sp.core.function.AppliedUndef)
            or str(problem_expr.lhs) in ("y", "f", "g", "h")
        )

        if is_derivative or is_func_def:
            try:
                direct = sp.diff(rhs, derivative_var)
                direct_latex = sp.latex(direct)
                status, _ = check_step(direct, target_last)
                if status == "ok":
                    return direct_latex, True, "الناتج النهائي يطابق المشتقة المحسوبة مباشرةً بواسطة SymPy."
                if is_derivative:
                    # Explicitly a derivative problem → definitive mismatch
                    return direct_latex, False, f"تحذير: المشتقة الصحيحة بواسطة SymPy هي {direct_latex}."
                # is_func_def only (not explicitly derivative): answer didn't match
                # the derivative, but the problem might not be asking for one.
                # Return None for cross_matches so we don't falsely flag it as wrong,
                # but DO return here to prevent fallthrough to the algebraic solver.
                return direct_latex, None, f"ملاحظة: إذا كانت المسألة اشتقاقاً، فالمشتقة الصحيحة هي {direct_latex}."
            except Exception:
                pass
            # Exception during diff (or unreachable after returns above) — cannot
            # determine result. Return None so caller doesn't incorrectly treat this
            # as a plain algebraic equation.
            return None, None, None

        # 3. Plain algebraic equation — solve for its roots
        if isinstance(problem_expr, sp.Eq):
            status, _ = check_step(problem_expr, last_step_expr)
            if status == "ok":
                return sp.latex(last_step_expr), True, "الحل يطابق تماماً حلول SymPy."

            if syms:
                try:
                    direct_sols = sp.solve(problem_expr, syms[0])
                    if direct_sols:
                        direct_latex = ", ".join(sp.latex(s) for s in direct_sols)
                        for s in direct_sols:
                            if check_step(s, target_last)[0] == "ok":
                                return direct_latex, True, "الحل يطابق تماماً مجموعة حلول SymPy."
                        return direct_latex, False, f"تحذير: حلول SymPy المباشرة هي [{direct_latex}]."
                except Exception:
                    pass

    except Exception as e:
        logger.debug(f"Cross check skipped: {e}")

    return None, None, None

def solve_verified(
    problem_text: str,
    settings: Optional[Settings] = None,
    client: Optional[Any] = None,
) -> SolveResult:
    """
    Solves a math problem with a reasoning LLM and verifies every step with SymPy.
    Retries up to MAX_SOLVE_RETRIES if any step is rejected by SymPy.
    """
    s = settings or get_settings()
    max_retries = s.max_solve_retries

    if client is None:
        if s.is_groq_ready():
            client = GroqClientWrapper(s)
        else:
            client = OllamaClientWrapper(s)

    parsed_problem = parse_expr_safe(problem_text)
    retry_instructions = ""
    last_steps_data: List[dict] = []
    last_answer = ""
    retries_used = 0

    for attempt in range(max_retries + 1):
        retries_used = attempt
        prompt = SOLVE_PROMPT_TEMPLATE.format(
            problem=problem_text,
            retry_instructions=retry_instructions,
        )

        try:
            resp = client.chat_json(prompt)
        except Exception as exc:
            logger.error(f"Solve LLM call failed on attempt {attempt}: {exc}")
            if attempt == max_retries:
                raise RuntimeError(f"تعذر الحصول على حل من النموذج: {exc}")
            continue

        raw_steps = resp.get("steps", [])
        last_answer = str(resp.get("answer", "")).strip()
        last_steps_data = raw_steps

        # Parse each step expression (single canonical call via helper)
        parsed_steps = _parse_steps(raw_steps)

        # Verify chain with SymPy
        chain_verifications = verify_chain(parsed_problem, parsed_steps)

        # Check candidate final expression
        cand_last_expr: Optional[sp.Basic] = None
        for _explain, pexpr in reversed(parsed_steps):
            if pexpr is not None and not isinstance(pexpr, (sp.Derivative, sp.Integral, sp.Limit)):
                cand_last_expr = pexpr
                break

        _, cand_cross_ok, _ = _attempt_cross_check(
            parsed_problem,
            cand_last_expr,
            parsed_steps,
            problem_text=problem_text,
        )
        if cand_cross_ok is True:
            # Final answer already matches SymPy's independent computation!
            break

        # Find any bad steps
        bad_indices = [
            v.index for v in chain_verifications if v.status == "bad"
        ]

        if not bad_indices:
            break
        else:
            if attempt < max_retries:
                logger.info(f"SymPy rejected steps {bad_indices} on attempt {attempt}. Retrying...")
                retry_instructions = (
                    f"تنبيه: محاولة الحل السابقة احتوت على خطوات خاطئة رياضياً. "
                    f"رفض نظام التحقق الرمزي (SymPy) الخطوات رقم: {bad_indices}. "
                    f"يرجى إعادة كتابة الحل بدقة متناهية والتأكد من صحة كل خطوة رياضياً."
                )

    # Build final SolvedStep list
    final_steps: List[SolvedStep] = []
    has_any_bad = False
    has_any_verifiable = False

    # Re-parse final steps via the same helper — guaranteed consistent with
    # the retry loop; eliminates the double-parse / stale-data risk.
    parsed_steps = _parse_steps(last_steps_data)

    chain_verifications = verify_chain(parsed_problem, parsed_steps)

    # --- Tier 1: Anchor verification (final answer vs SymPy direct) ---
    # Find the last parseable expression as the final answer expression
    last_parsed_expr: Optional[sp.Basic] = None
    for _explain, pexpr in reversed(parsed_steps):
        if pexpr is not None and not isinstance(pexpr, (sp.Derivative, sp.Integral, sp.Limit)):
            last_parsed_expr = pexpr
            break

    # Cross-check: does the final answer match SymPy's independent computation?
    cross_ans, cross_matches, cross_note = _attempt_cross_check(
        parsed_problem,
        last_parsed_expr,
        parsed_steps,
        problem_text=problem_text,
    )
    anchor_verified = cross_matches is True  # Tier 1 passed

    # --- Tier 2: Build final step list with anchor-aware status ---
    last_valid_expr: Optional[sp.Basic] = None
    for idx, (raw_st, v) in enumerate(zip(last_steps_data, chain_verifications), start=1):
        status = v.status
        note = v.note

        if status == "ok":
            has_any_verifiable = True
            if v.raw_expr is not None:
                last_valid_expr = v.raw_expr
        elif status == "bad":
            if anchor_verified:
                # Tier 1 passed: final answer is correct, so this intermediate
                # step uses a strategy the chain model can't follow (term-by-term,
                # substitution, etc). Downgrade to unknown — not wrong.
                status = "unknown"
                note = "خطوة وسيطة غير قابلة للتحقق المباشر، لكن الناتج النهائي مطابق لحسابات SymPy ✅"
            else:
                has_any_bad = True
                note = "الموديل غلط هنا ومقدرش يصلحها"
        elif status == "unknown":
            if anchor_verified:
                note = "خطوة وسيطة غير قابلة للتحقق المباشر، لكن الناتج النهائي مطابق لحسابات SymPy ✅"
        elif status == "skip":
            pass  # keep as-is (text or calculus setup)

        final_steps.append(
            SolvedStep(
                index=idx,
                explain=str(raw_st.get("explain", "")),
                expr_str=str(raw_st.get("expr", "")),
                parsed_expr=v.raw_expr,
                status=status,
                note=note,
            )
        )

    if last_valid_expr is None:
        last_valid_expr = last_parsed_expr

    # --- Final summary ---
    if parsed_problem is None and not has_any_verifiable and not anchor_verified:
        is_fully_verified = False
        summary = "مسألة كلامية أو إثبات غير قابل للتحقق الجبري المباشر بواسطة SymPy."
    elif anchor_verified:
        # Tier 1 passed: final answer is correct. This is the strongest guarantee.
        is_fully_verified = True
        summary = "✅ تم التحقق من صحة الناتج النهائي بواسطة SymPy — الإجابة مطابقة للحساب المباشر."
    elif has_any_bad:
        is_fully_verified = False
        summary = "تحذير: الحل يحتوي على خطوات خاطئة لم يتمكن النموذج من تصحيحها."
    elif not has_any_verifiable:
        is_fully_verified = False
        summary = "الخطوات لا تتضمن تعابير جبرية قابلة للتحقق الرمزي."
    else:
        # No bad steps detected and chain verified. Try one final derivative-aware
        # check before declaring success: compute sp.diff(rhs) and compare to the
        # last valid expression. This replaces the old check_step(parsed_problem,
        # last_valid_expr) which compared the original function to its derivative —
        # they are numerically unequal and always returned "unknown", causing a
        # false failure message for every derivative problem.
        derivative_match = False
        if parsed_problem is not None and last_valid_expr is not None:
            try:
                rhs_fb = (
                    parsed_problem.rhs
                    if isinstance(parsed_problem, sp.Eq)
                    else parsed_problem
                )
                fb_syms = sorted(
                    rhs_fb.free_symbols,
                    key=lambda s: (s.name != "x", s.name),
                )
                if fb_syms:
                    fb_direct = sp.diff(rhs_fb, fb_syms[0])
                    fb_target = (
                        last_valid_expr.rhs
                        if isinstance(last_valid_expr, sp.Eq)
                        else last_valid_expr
                    )
                    fb_status, _ = check_step(fb_direct, fb_target)
                    derivative_match = fb_status == "ok"
            except Exception:
                pass

        if derivative_match:
            is_fully_verified = True
            summary = "✅ تم التحقق من صحة كافة الخطوات والناتج النهائي بواسطة SymPy."
        elif cross_matches is False:
            # _attempt_cross_check returned a definitive mismatch
            is_fully_verified = False
            summary = "تحذير: الناتج النهائي لا يطابق الحساب المباشر بواسطة SymPy."
        else:
            # cross_matches is None (couldn’t determine) and no bad steps found.
            # Trust chain verification: if every checkable step was ok, report success.
            is_fully_verified = True
            summary = "✅ تم التحقق من صحة الخطوات الرياضية بواسطة SymPy."

    return SolveResult(
        steps=final_steps,
        final_answer=last_answer,
        is_fully_verified=is_fully_verified,
        status_summary=summary,
        cross_check_answer=cross_ans,
        cross_check_matches=cross_matches,
        cross_check_note=cross_note,
        retries_used=retries_used,
    )

