import logging
import random
from dataclasses import dataclass
from typing import Any, List, Literal, Optional, Sequence, Tuple
import sympy as sp

logger = logging.getLogger(__name__)

StatusType = Literal["ok", "bad", "unknown", "skip"]

@dataclass(frozen=True)
class StepVerification:
    index: int
    status: StatusType
    note: str
    explain: str = ""
    expr_str: str = ""
    raw_expr: Optional[sp.Basic] = None

def _substitute_c(expr: sp.Basic) -> sp.Basic:
    """Substitute integration constant C with 0."""
    try:
        C = sp.Symbol("C")
        if C in expr.free_symbols:
            return expr.subs(C, 0)
    except Exception:
        pass
    return expr

def _numeric_sample_compare(
    expr_a: sp.Basic,
    expr_b: sp.Basic,
    num_samples: int = 14,
) -> Tuple[Literal["ok", "bad", "unknown"], str]:
    """
    Compare two mathematical expressions via numeric sampling at random rational points.
    Avoids poles and non-finite values. Requires at least 3 valid sample points.
    """
    a_clean = _substitute_c(expr_a)
    b_clean = _substitute_c(expr_b)

    syms = list(a_clean.free_symbols.union(b_clean.free_symbols))

    if not syms:
        try:
            val_a = complex(a_clean.evalf())
            val_b = complex(b_clean.evalf())
            if abs(val_a - val_b) < 1e-7:
                return ("ok", "القيمتان متطابقتان")
            else:
                return ("bad", "القيمتان غير متطابقتين")
        except Exception as e:
            logger.debug(f"Constant evaluation error: {e}")
            return ("unknown", "تعذر حساب القيم الثابتة عددياً")

    rng = random.Random(42)
    diffs: List[float] = []

    max_trials = max(num_samples * 3, 30)
    for _ in range(max_trials):
        if len(diffs) >= num_samples:
            break

        point = {}
        for s in syms:
            num = rng.randint(-8, 8)
            den = rng.choice([1, 2, 3, 4, 5])
            point[s] = sp.Rational(num, den)

        try:
            val_a = a_clean.subs(point)
            val_b = b_clean.subs(point)

            num_a = val_a.evalf()
            num_b = val_b.evalf()

            if (
                num_a.has(sp.zoo, sp.nan, sp.oo, -sp.oo)
                or num_b.has(sp.zoo, sp.nan, sp.oo, -sp.oo)
            ):
                continue

            c_a = complex(num_a)
            c_b = complex(num_b)

            # Use Python's .imag (sp.im() only works on SymPy objects, not
            # Python complex — calling it on complex always returned 0).
            if abs(c_a.imag) > 1e-9 or abs(c_b.imag) > 1e-9:
                diff_val = abs(c_a - c_b)
            else:
                diff_val = abs(c_a.real - c_b.real)

            diffs.append(diff_val)
        except Exception:
            continue

    if len(diffs) < 3:
        return ("unknown", "عدد نقاط الفحص الصالحة غير كافٍ لتأكيد الخطوة")

    if all(abs(d) < 1e-6 for d in diffs):
        return ("ok", "الخطوة صحيحة حسابياً")

    c0 = diffs[0]
    if abs(c0) >= 1e-6 and all(abs(d - c0) < 1e-6 for d in diffs):
        return ("ok", "الخطوة صحيحة (تختلف بثابت تكامل فقط)")

    return ("bad", "الخطوة غير صحيحة رياضياً")

def _compare_equations(
    eq_prev: sp.Eq,
    eq_cur: sp.Eq,
) -> Tuple[Literal["ok", "bad", "unknown"], str]:
    """
    Compare two equations.

    Fast-paths (tried first):
      1. RHS numeric equality — handles function-definition equations like
         f(x) = expr_a  vs  f = expr_b  where sp.solve gives meaningless results.
         Only fires when RHS is non-zero on both sides (zero-RHS algebraic
         equations must go through sp.solve to compare solution sets correctly).
      2. Algebraic (lhs-rhs) equivalence via sp.simplify.

    Falls back to solution-set comparison via sp.solve.
    """
    # --- Fast-path 1: RHS numeric equality (non-zero RHS only) ---
    try:
        rhs_a = eq_prev.rhs
        rhs_b = eq_cur.rhs
        both_rhs_zero = (
            sp.simplify(rhs_a) == sp.Integer(0) and
            sp.simplify(rhs_b) == sp.Integer(0)
        )
        if not both_rhs_zero:
            rhs_status, _ = _numeric_sample_compare(rhs_a, rhs_b)
            if rhs_status == "ok":
                return ("ok", "قيم الطرف الأيمن للمعادلتين متطابقة")
    except Exception:
        pass

    # --- Fast-path 2: algebraic (lhs-rhs) equivalence ---
    try:
        moved_prev = sp.expand(eq_prev.lhs - eq_prev.rhs)
        moved_cur  = sp.expand(eq_cur.lhs  - eq_cur.rhs)
        diff = sp.simplify(moved_prev - moved_cur)
        if diff == 0:
            return ("ok", "المعادلتان متكافئتان جبرياً")
    except Exception:
        pass

    syms_prev = eq_prev.free_symbols
    syms_cur  = eq_cur.free_symbols

    if not syms_prev or not syms_cur:
        return ("unknown", "إحدى المعادلتين لا تحتوي على متغيرات")

    common_syms = sorted(
        syms_prev.intersection(syms_cur),
        key=lambda s: (s.name != "x", s.name),
    )
    if not common_syms:
        return ("bad", "المعادلتان تستخدمان متغيرات مختلفة")

    sym = common_syms[0]

    try:
        sols_prev = sp.solve(eq_prev, sym)
        sols_cur  = sp.solve(eq_cur, sym)
    except Exception as e:
        logger.debug(f"sp.solve failed during equation comparison: {e}")
        return ("unknown", "تعذر حل المعادلة بدقة للمقارنة")

    def normalize_sols(raw_sols: Any) -> List[sp.Basic]:
        if isinstance(raw_sols, dict):
            return list(raw_sols.values())
        if isinstance(raw_sols, (list, tuple, set)):
            res = []
            for item in raw_sols:
                if isinstance(item, dict):
                    res.extend(item.values())
                elif isinstance(item, (tuple, list)):
                    res.extend(item)
                else:
                    res.append(item)
            return res
        return [raw_sols]

    p_list = normalize_sols(sols_prev)
    c_list = normalize_sols(sols_cur)

    if len(p_list) != len(c_list):
        return ("bad", f"عدد حلول المعادلة اختلف ({len(p_list)} مقابل {len(c_list)})")

    unmatched_cur = list(c_list)
    for p in p_list:
        matched_idx = -1
        for idx, c in enumerate(unmatched_cur):
            try:
                diff = sp.simplify(p - c)
                if diff == 0:
                    matched_idx = idx
                    break
                if abs(complex((p - c).evalf())) < 1e-9:
                    matched_idx = idx
                    break
            except Exception:
                continue

        if matched_idx >= 0:
            unmatched_cur.pop(matched_idx)
        else:
            return ("bad", "مجموعة حلول المعادلة غير متطابقة")

    return ("ok", "مجموعة حلول المعادلة متطابقة تماماً")

def check_step(
    prev: Any,
    cur: Any,
    original_ode: Optional[sp.Basic] = None,
    num_samples: int = 14,
) -> Tuple[Literal["ok", "bad", "unknown"], str]:
    """
    Check the validity of a transition from `prev` to `cur`.
    Never raises an exception; returns ('unknown', note) on unexpected error.
    """
    if prev is None or cur is None:
        return ("unknown", "خطوة غير قابلة للقراءة أو التحقق الرمزي")

    try:
        # 1. Evaluate calculus objects (.doit())
        prev_eval = prev.doit() if hasattr(prev, "doit") else prev
        cur_eval  = cur.doit()  if hasattr(cur,  "doit") else cur

        # 2. ODE verification if ODE is present
        target_ode = original_ode
        if target_ode is None and isinstance(prev_eval, sp.Eq):
            if any(isinstance(node, sp.Derivative) for node in sp.preorder_traversal(prev_eval)):
                target_ode = prev_eval

        if target_ode is not None and isinstance(cur_eval, sp.Eq):
            cur_lhs_str = str(cur_eval.lhs)
            if cur_lhs_str in ("y(x)", "y"):
                try:
                    ode_ok, _ = sp.checkodesol(target_ode, cur_eval)
                    if ode_ok:
                        return ("ok", "حل سليم للمعادلة التفاضلية")
                    else:
                        return ("bad", "الحل لا يحقق المعادلة التفاضلية")
                except Exception as e:
                    logger.debug(f"checkodesol error: {e}")
                    return ("unknown", "تعذر التحقق التام من حل المعادلة التفاضلية")

        # 3. Equation vs Non-Equation mismatch
        prev_is_eq = isinstance(prev_eval, sp.Eq)
        cur_is_eq  = isinstance(cur_eval,  sp.Eq)

        if prev_is_eq and not cur_is_eq:
            # Eq → expression: before declaring "forgot = 0", check if cur
            # is related to the RHS of prev (e.g. partial derivative of a term,
            # or the full derivative/integral of the RHS).
            rhs = prev_eval.rhs
            rhs_status, rhs_note = _numeric_sample_compare(rhs, cur_eval, num_samples=num_samples)
            if rhs_status == "ok":
                return ("ok", "التعبير يطابق الطرف الأيمن للمعادلة السابقة")
            # Not the full RHS — could be a partial result or derivative.
            # Mark as unknown (not bad) so solve mode can handle it gracefully.
            return ("unknown", "انتقال من معادلة إلى تعبير — غير قابل للتحقق المباشر")

        if not prev_is_eq and cur_is_eq:
            # Expression → Eq: this is genuinely suspicious (student forgot context)
            return ("bad", "عدم تطابق في نوع التعبير: تم نسيان أحد أطراف المعادلة أو '= 0'")

        # 4. Both are equations
        if prev_is_eq and cur_is_eq:
            return _compare_equations(prev_eval, cur_eval)

        # 5. Both are expressions
        return _numeric_sample_compare(prev_eval, cur_eval, num_samples=num_samples)

    except Exception as exc:
        logger.warning(f"Unexpected error in check_step: {exc}")
        return ("unknown", f"تعذر التحقق من الخطوة: {str(exc)[:50]}")

def verify_chain(
    first: Optional[sp.Basic],
    steps: Sequence[Any],
    num_samples: int = 14,
) -> List[StepVerification]:
    """
    Verifies a sequential chain of steps starting from `first`.
    `steps` can be a list of sp.Basic, or tuples/dicts (explain_str, sp.Basic).
    """
    results: List[StepVerification] = []
    current_prev = first

    # Precompute derivative context only if 'first' is a function or expression,
    # NOT a standard algebraic equation to solve (expr = 0).
    first_rhs: Optional[sp.Basic] = None
    full_diff: Optional[sp.Basic] = None
    term_diffs: List[sp.Basic] = []

    is_algebraic_solve = False
    if first is not None:
        try:
            if isinstance(first, sp.Eq):
                if first.rhs == 0 and not isinstance(first.lhs, sp.core.function.AppliedUndef):
                    is_algebraic_solve = True
                first_rhs = first.rhs if not is_algebraic_solve else None
            else:
                first_rhs = first

            if first_rhs is not None and not is_algebraic_solve:
                # Sort symbols deterministically; prefer 'x' as the derivative
                # variable since free_symbols iteration order is non-deterministic.
                syms = sorted(first_rhs.free_symbols, key=lambda s: (s.name != "x", s.name))
                var = syms[0] if syms else sp.Symbol("x")
                full_diff = sp.diff(first_rhs, var)
                terms = first_rhs.as_ordered_terms() if hasattr(first_rhs, "as_ordered_terms") else [first_rhs]
                if len(terms) > 1:
                    term_diffs = [sp.diff(t, var) for t in terms if sp.diff(t, var) != 0]
        except Exception as ex:
            logger.debug(f"Could not compute derivative context: {ex}")

    for i, step in enumerate(steps, start=1):
        explain = ""
        expr: Optional[sp.Basic] = None

        if isinstance(step, tuple):
            explain = str(step[0])
            expr = step[1]
        elif isinstance(step, dict):
            explain = str(step.get("explain", ""))
            expr = step.get("expr")
        else:
            expr = step

        # ── Pure text / explanation step ──────────────────────────────────
        if expr is None:
            results.append(
                StepVerification(
                    index=i,
                    status="skip",
                    note="خطوة شرح توضيحي بدون تعبير رياضي",
                    explain=explain,
                    expr_str="",
                    raw_expr=None,
                )
            )
            continue

        # ── Unevaluated calculus objects: Derivative / Integral / Limit ───
        if isinstance(expr, (sp.Derivative, sp.Integral, sp.Limit)):
            try:
                evaluated = expr.doit()
            except Exception:
                evaluated = expr
            results.append(
                StepVerification(
                    index=i,
                    status="skip",
                    note="خطوة إعداد العملية الحسابية (مشتقة/تكامل/نهاية) — يتم التحقق من الناتج في الخطوة التالية",
                    explain=explain,
                    expr_str=str(expr),
                    raw_expr=expr,
                )
            )
            current_prev = evaluated   # next step compared against doit() result
            continue

        # ── No previous expression to compare against ─────────────────────
        if current_prev is None:
            results.append(
                StepVerification(
                    index=i,
                    status="unknown",
                    note="لا يمكن التحقق لعدم توفر تعبير سابق صالح",
                    explain=explain,
                    expr_str=str(expr),
                    raw_expr=expr,
                )
            )
            current_prev = expr
            continue

        # ── Normal algebraic step: compare to previous ────────────────────
        status, note = check_step(current_prev, expr, num_samples=num_samples)

        # Contextual rescue for derivative problems (only if not solving an algebraic equation)
        if status == "bad" and not is_algebraic_solve:
            target_expr = expr.rhs if (isinstance(expr, sp.Eq) and expr.rhs != 0) else expr
            if full_diff is not None:
                fd_status, _ = _numeric_sample_compare(full_diff, target_expr, num_samples=num_samples)
                if fd_status == "ok":
                    status = "ok"
                    note = "الخطوة تطابق المشتقة التامة للدالة الأصلية"

            if status == "bad" and term_diffs:
                for td in term_diffs:
                    td_status, _ = _numeric_sample_compare(td, target_expr, num_samples=num_samples)
                    if td_status == "ok":
                        status = "unknown"
                        note = "خطوة وسيطة صحيحة تمثل اشتقاق أحد حدود الدالة"
                        break

        results.append(
            StepVerification(
                index=i,
                status=status,
                note=note,
                explain=explain,
                expr_str=str(expr),
                raw_expr=expr,
            )
        )
        current_prev = expr

    return results
