from dataclasses import dataclass
from typing import Any, Optional
import sympy as sp
from core.parsing import parse_expr_safe

@dataclass(frozen=True)
class SimpleModeResult:
    success: bool
    latex_output: str
    error_message: Optional[str] = None
    raw_result: Optional[Any] = None

def direct_solve_equation(eq_str: str) -> SimpleModeResult:
    """
    Solve an algebraic equation directly with SymPy.
    """
    try:
        parsed = parse_expr_safe(eq_str)
        if parsed is None:
            return SimpleModeResult(
                success=False,
                latex_output="",
                error_message="تعذر قراءة المعادلة. تأكد من كتابتها بصيغة رياضية صحيحة مثل: x^2 - 4 = 0",
            )

        # If user entered an expression without '=', treat as expr = 0
        if not isinstance(parsed, sp.Eq):
            parsed = sp.Eq(parsed, 0)

        syms = list(parsed.free_symbols)
        if not syms:
            return SimpleModeResult(
                success=False,
                latex_output="",
                error_message="المعادلة لا تحتوي على أي متغير لحلها.",
            )

        target_sym = syms[0]
        # Prefer 'x' if present
        for s in syms:
            if s.name == "x":
                target_sym = s
                break

        solutions = sp.solve(parsed, target_sym)
        if not solutions:
            return SimpleModeResult(
                success=True,
                latex_output=r"\text{لا توجد حلول حقيقية أو تحليلية}",
                raw_result=[],
            )

        # Format solutions nicely into LaTeX
        latex_sols = [f"{sp.latex(target_sym)} = {sp.latex(sol)}" for sol in solutions]
        combined_latex = r" \quad \text{أو} \quad ".join(latex_sols)

        return SimpleModeResult(
            success=True,
            latex_output=combined_latex,
            raw_result=solutions,
        )
    except Exception as e:
        return SimpleModeResult(
            success=False,
            latex_output="",
            error_message=f"حدث خطأ أثناء حل المعادلة: {str(e)[:80]}",
        )

def direct_differentiate(
    expr_str: str,
    var_str: str = "x",
    order: int = 1,
) -> SimpleModeResult:
    """
    Differentiate an expression to order n with respect to var.
    """
    try:
        parsed = parse_expr_safe(expr_str)
        if parsed is None:
            return SimpleModeResult(
                success=False,
                latex_output="",
                error_message="تعذر قراءة التعبير الرياضي للاشتقاق.",
            )

        var = sp.Symbol(var_str.strip() or "x")
        diff_res = sp.diff(parsed, var, order)
        latex_diff = sp.latex(diff_res)

        return SimpleModeResult(
            success=True,
            latex_output=latex_diff,
            raw_result=diff_res,
        )
    except Exception as e:
        return SimpleModeResult(
            success=False,
            latex_output="",
            error_message=f"حدث خطأ أثناء الاشتقاق: {str(e)[:80]}",
        )

def direct_integrate(
    expr_str: str,
    var_str: str = "x",
    lower_bound: Optional[str] = None,
    upper_bound: Optional[str] = None,
) -> SimpleModeResult:
    """
    Compute indefinite or definite integral with SymPy.
    """
    try:
        parsed = parse_expr_safe(expr_str)
        if parsed is None:
            return SimpleModeResult(
                success=False,
                latex_output="",
                error_message="تعذر قراءة التعبير الرياضي للتكامل.",
            )

        var = sp.Symbol(var_str.strip() or "x")

        # Definite integral if bounds provided
        if lower_bound and upper_bound and lower_bound.strip() and upper_bound.strip():
            a = parse_expr_safe(lower_bound)
            b = parse_expr_safe(upper_bound)
            if a is None or b is None:
                return SimpleModeResult(
                    success=False,
                    latex_output="",
                    error_message="حدود التكامل غير صالحة.",
                )
            int_res = sp.integrate(parsed, (var, a, b))
            latex_res = sp.latex(int_res)
        else:
            int_res = sp.integrate(parsed, var)
            # Add + C for indefinite integral display
            latex_res = f"{sp.latex(int_res)} + C"

        return SimpleModeResult(
            success=True,
            latex_output=latex_res,
            raw_result=int_res,
        )
    except Exception as e:
        return SimpleModeResult(
            success=False,
            latex_output="",
            error_message=f"حدث خطأ أثناء حساب التكامل: {str(e)[:80]}",
        )

def direct_solve_ode(ode_str: str) -> SimpleModeResult:
    """
    Solve Ordinary Differential Equations (ODEs) using SymPy's dsolve.
    Accepts y', y'', y''' syntax.
    """
    try:
        parsed = parse_expr_safe(ode_str, ode_mode=True)
        if parsed is None:
            return SimpleModeResult(
                success=False,
                latex_output="",
                error_message="تعذر قراءة المعادلة التفاضلية. تأكد من صيغة y' أو y'' مثل: y'' + y = 0",
            )

        if not isinstance(parsed, sp.Eq):
            parsed = sp.Eq(parsed, 0)

        ode_res = sp.dsolve(parsed)
        latex_res = sp.latex(ode_res)

        return SimpleModeResult(
            success=True,
            latex_output=latex_res,
            raw_result=ode_res,
        )
    except Exception as e:
        return SimpleModeResult(
            success=False,
            latex_output="",
            error_message=f"حدث خطأ أثناء حل المعادلة التفاضلية: {str(e)[:80]}",
        )
