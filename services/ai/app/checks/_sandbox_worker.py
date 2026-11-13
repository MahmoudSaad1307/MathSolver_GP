from __future__ import annotations

import json
import random
import re
import sys
from typing import Any, Literal

import sympy as sp
from sympy.parsing.latex import parse_latex


def _clean_latex(expr: str) -> str:
    s = expr.strip()
    if s.startswith("$$") and s.endswith("$$") and len(s) >= 4:
        s = s[2:-2].strip()
    elif s.startswith("$") and s.endswith("$") and len(s) >= 2:
        s = s[1:-1].strip()
    # Strip trailing punctuation or common LHS labels like f'(x) = or dy/dx =
    s = s.rstrip(".,;")
    s = re.sub(r"\\(quad|qquad|text\{[^}]*\}|mbox\{[^}]*\})", " ", s)
    return s.strip()


def _extract_rhs_if_assignment(latex_str: str) -> str:
    # For final-answer comparisons like "y' = 2e^{2x}" vs "2e^{2x}", compare RHS
    if "=" in latex_str and latex_str.count("=") == 1:
        lhs, rhs = [part.strip() for part in latex_str.split("=", 1)]
        if re.fullmatch(r"(y'?|f'?\([a-zA-Z]\)|\\frac\{d[a-zA-Z]\}\{d[a-zA-Z]\})", lhs):
            return rhs
    return latex_str


def _safe_parse_latex(raw: str) -> sp.Basic:
    cleaned = _clean_latex(raw)
    if not cleaned:
        raise ValueError("Empty expression")
    if "=" in cleaned and cleaned.count("=") == 1:
        lhs_s, rhs_s = [p.strip() for p in cleaned.split("=", 1)]
        lhs = parse_latex(lhs_s, backend="lark")
        rhs = parse_latex(rhs_s, backend="lark")
        return sp.Eq(lhs, rhs)
    return parse_latex(cleaned, backend="lark")


def _substitute_c(expr: sp.Basic) -> sp.Basic:
    c_sym = sp.Symbol("C")
    if c_sym in expr.free_symbols:
        return expr.subs(c_sym, 0)
    return expr


def _numeric_sample_compare(
    expr_a: sp.Basic,
    expr_b: sp.Basic,
    num_samples: int = 14,
) -> tuple[Literal["ok", "bad", "unknown"], str]:
    a_clean = _substitute_c(expr_a)
    b_clean = _substitute_c(expr_b)
    syms = sorted(a_clean.free_symbols.union(b_clean.free_symbols), key=lambda s: str(s))

    if not syms:
        try:
            val_a = complex(a_clean.evalf())
            val_b = complex(b_clean.evalf())
            if abs(val_a - val_b) < 1e-7:
                return ("ok", "Constant values match")
            return ("bad", "Constant values differ")
        except Exception as exc:
            return ("unknown", f"Constant eval failed: {exc}")

    rng = random.Random(42)
    diffs: list[float] = []
    for _ in range(max(num_samples * 3, 30)):
        if len(diffs) >= num_samples:
            break
        point = {s: sp.Rational(rng.randint(1, 8), rng.choice([1, 2, 3, 4])) for s in syms}
        try:
            num_a = a_clean.subs(point).evalf()
            num_b = b_clean.subs(point).evalf()
            if num_a.has(sp.zoo, sp.nan, sp.oo, -sp.oo) or num_b.has(
                sp.zoo, sp.nan, sp.oo, -sp.oo
            ):
                continue
            c_a = complex(num_a)
            c_b = complex(num_b)
            diffs.append(abs(c_a - c_b))
        except Exception:
            continue

    if len(diffs) < 3:
        return ("unknown", "Insufficient finite numeric sample points")
    if all(d < 1e-6 for d in diffs):
        return ("ok", "Numeric sample checks agree")
    first_d = diffs[0]
    if abs(first_d) >= 1e-6 and all(abs(d - first_d) < 1e-6 for d in diffs):
        return ("ok", "Equivalent up to additive constant")
    return ("bad", "Numeric sample values differ")


def _compare_equations(eq_a: sp.Eq, eq_b: sp.Eq) -> tuple[bool, str]:
    rhs_status, rhs_detail = _numeric_sample_compare(eq_a.rhs, eq_b.rhs)
    lhs_status, _ = _numeric_sample_compare(eq_a.lhs, eq_b.lhs)
    if rhs_status == "ok" and lhs_status == "ok":
        return (True, f"Equations match ({rhs_detail})")
    diff_a = eq_a.lhs - eq_a.rhs
    diff_b = eq_b.lhs - eq_b.rhs
    try:
        if sp.simplify(diff_a - diff_b) == 0 or sp.simplify(diff_a + diff_b) == 0:
            return (True, "Equations are algebraically equivalent")
    except Exception:
        pass
    return (False, "Equations differ")


def run_compare(student_raw: str, expected_raw: str) -> dict[str, Any]:
    s_clean = _clean_latex(student_raw)
    e_clean = _clean_latex(expected_raw)
    both_have_eq = ("=" in s_clean) and ("=" in e_clean)
    s_norm = s_clean if both_have_eq else _extract_rhs_if_assignment(s_clean)
    e_norm = e_clean if both_have_eq else _extract_rhs_if_assignment(e_clean)

    try:
        s_expr = _safe_parse_latex(s_norm)
        e_expr = _safe_parse_latex(e_norm)
    except Exception as exc:
        return {
            "status": "UNPARSABLE",
            "equivalent": None,
            "studentSympy": None,
            "expectedSympy": None,
            "detail": f"LaTeX parse failed: {exc}",
        }

    s_repr = str(s_expr)
    e_repr = str(e_expr)

    if isinstance(s_expr, sp.Eq) and isinstance(e_expr, sp.Eq):
        ok, detail = _compare_equations(s_expr, e_expr)
        return {
            "status": "EQUIVALENT" if ok else "NOT_EQUIVALENT",
            "equivalent": ok,
            "studentSympy": s_repr,
            "expectedSympy": e_repr,
            "detail": detail,
        }

    if isinstance(s_expr, sp.Eq) != isinstance(e_expr, sp.Eq):
        if isinstance(s_expr, sp.Eq):
            s_expr = s_expr.rhs
        if isinstance(e_expr, sp.Eq):
            e_expr = e_expr.rhs

    try:
        if sp.simplify(s_expr - e_expr) == 0:
            return {
                "status": "EQUIVALENT",
                "equivalent": True,
                "studentSympy": s_repr,
                "expectedSympy": e_repr,
                "detail": "Algebraically identical via SymPy simplify",
            }
    except Exception:
        pass

    num_status, num_detail = _numeric_sample_compare(s_expr, e_expr)
    if num_status == "ok":
        return {
            "status": "EQUIVALENT",
            "equivalent": True,
            "studentSympy": s_repr,
            "expectedSympy": e_repr,
            "detail": num_detail,
        }
    if num_status == "bad":
        return {
            "status": "NOT_EQUIVALENT",
            "equivalent": False,
            "studentSympy": s_repr,
            "expectedSympy": e_repr,
            "detail": num_detail,
        }
    return {
        "status": "UNPARSABLE",
        "equivalent": None,
        "studentSympy": s_repr,
        "expectedSympy": e_repr,
        "detail": num_detail,
    }


def main() -> int:
    # Pre-warm Lark LaTeX parser and SymPy simplify caches once at worker startup
    # so per-expression timeouts measure evaluation work rather than cold JIT setup.
    run_compare(r"\frac{1}{2x+1}", r"\frac{3}{2x+1}")
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    while True:
        line = sys.stdin.readline()
        if not line:
            return 0
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
            result = run_compare(
                str(payload.get("student", "")),
                str(payload.get("expected", "")),
            )
            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            sys.stdout.write(
                json.dumps(
                    {
                        "status": "UNPARSABLE",
                        "equivalent": None,
                        "studentSympy": None,
                        "expectedSympy": None,
                        "detail": f"Sandbox execution failed: {exc}",
                    }
                )
                + "\n"
            )
            sys.stdout.flush()


if __name__ == "__main__":
    raise SystemExit(main())
