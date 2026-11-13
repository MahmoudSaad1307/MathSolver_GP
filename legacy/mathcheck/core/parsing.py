import functools
import operator
import re
from typing import Any, Dict, Optional
import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

def _build_local_dict(ode_mode: bool = False) -> Dict[str, Any]:
    """
    Build a safe and restricted dictionary for SymPy parser.
    Never exposes raw python eval builtins.
    """
    x, t, z, u, v, w, a, b, c, n, k = sp.symbols("x t z u v w a b c n k")
    C = sp.Symbol("C")  # Integration constant

    # In ODE mode, y is a Function of x; otherwise a Symbol
    if ode_mode:
        y_obj = sp.Function("y")
    else:
        y_obj = sp.Symbol("y")

    safe_dict: Dict[str, Any] = {
        "x": x,
        "y": y_obj,
        "t": t,
        "z": z,
        "u": u,
        "v": v,
        "w": w,
        "a": a,
        "b": b,
        "c": c,
        "n": n,
        "k": k,
        "C": C,
        # Named math functions used in problems — MUST be sp.Function so that
        # implicit_multiplication_application does NOT turn f(x) → f*x.
        "f": sp.Function("f"),
        "g": sp.Function("g"),
        "h": sp.Function("h"),
        # Trig / hyperbolic
        "sin": sp.sin,
        "cos": sp.cos,
        "tan": sp.tan,
        "asin": sp.asin,
        "acos": sp.acos,
        "atan": sp.atan,
        "sinh": sp.sinh,
        "cosh": sp.cosh,
        "tanh": sp.tanh,
        "exp": sp.exp,
        "log": sp.log,
        "ln": sp.log,
        "sqrt": sp.sqrt,
        "Abs": sp.Abs,
        # Calculus & structures
        "Integral": sp.Integral,
        "Derivative": sp.Derivative,
        "Limit": sp.Limit,
        "Eq": sp.Eq,
        # Constants
        "pi": sp.pi,
        "E": sp.E,
        "e": sp.E,
        "I": sp.I,
        "oo": sp.oo,
    }
    return safe_dict

def _ode_preprocess(text: str) -> str:
    """
    Convert ODE prime notation into SymPy Derivative without breaking
    already converted tokens or existing y(x) usages.
    y''' -> Derivative(y(x), x, 3)
    y''  -> Derivative(y(x), x, 2)
    y'   -> Derivative(y(x), x, 1)
    bare y (not followed by '(') -> y(x)
    """
    s = text

    # Handle y''', y'', y'
    # Match y followed by 3, 2, or 1 apostrophes (or prime Unicode symbols)
    s = re.sub(r"y(?:'''|′′′|″′)", "Derivative(y(x), x, 3)", s)
    s = re.sub(r"y(?:''|″|′′)", "Derivative(y(x), x, 2)", s)
    s = re.sub(r"y(?:'|′)", "Derivative(y(x), x)", s)

    # Convert bare y to y(x) only if not already followed by '(' and not part of a word
    # Digits before y (like 2y) are fine; letters/underscore are not.
    s = re.sub(r"(?<![A-Za-z_])y(?![A-Za-z_]|(?:\s*\())", "y(x)", s)

    return s

def _clean_latex_and_text(text: str) -> str:
    """
    Clean basic LaTeX remnants, unicode symbols, and exponents before SymPy parsing.
    """
    s = text.strip()
    # Strip leading/trailing backticks or markdown
    s = re.sub(r"^`+|`+$", "", s).strip()

    # Normalize unicode minuses and dashes to standard ASCII minus
    s = re.sub(r"[\u2212\u2013\u2014\u2015\uFE63\uFF0D]", "-", s)

    # Convert superscript unicode digits (e.g. x⁻¹⁰ -> x**(-10), x⁻² -> x**(-2))
    sup_map = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻", "0123456789+-")
    s = re.sub(
        r"([a-zA-Z0-9_\)]+)([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)",
        lambda m: f"{m.group(1)}**({m.group(2).translate(sup_map)})",
        s,
    )

    # Convert LaTeX exponents ^{...} -> **(...)
    s = re.sub(r"\^\{([^{}]+)\}", r"**(\1)", s)

    # Convert LaTeX fractions \frac{a}{b} -> ((a)/(b))
    for _ in range(5):
        if r"\frac" in s:
            s = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"((\1)/(\2))", s)
        else:
            break

    # Common LaTeX cleanups if LLM/user outputs LaTeX fragments
    s = s.replace(r"\cdot", "*")
    s = s.replace(r"\times", "*")
    s = s.replace(r"\left", "")
    s = s.replace(r"\right", "")
    s = s.replace(r"\int", "Integral")
    s = s.replace(r"\sqrt", "sqrt")
    s = s.replace("===", "=")
    s = s.replace("==", "=")

    return s.strip()

def _parse_single_expr(expr_str: str, ode_mode: bool) -> sp.Basic:
    """
    Parse a single expression (not containing ';' or '=') using restricted local_dict.
    """
    local_dict = _build_local_dict(ode_mode=ode_mode)
    res = parse_expr(
        expr_str,
        local_dict=local_dict,
        transformations=TRANSFORMATIONS,
        evaluate=False,
    )
    # If a bare function name like 'f' was parsed as an UndefinedFunction class,
    # convert it to a Symbol so it can be used in sp.Eq(f, ...)
    if isinstance(res, sp.core.function.UndefinedFunction):
        return sp.Symbol(res.__name__)
    return res

def _handle_multi_root(line: str, ode_mode: bool) -> sp.Basic:
    """
    A line with ';' means several roots: turn into Eq(prod(lhs - rhs), 0)
    so it can be compared to a factored/quadratic form.
    E.g.: 'x = 2; x = -3' -> Eq((x - 2)*(x - (-3)), 0) -> Eq((x - 2)*(x + 3), 0)
    """
    pieces = [p.strip() for p in line.split(";") if p.strip()]
    if not pieces:
        raise ValueError("Empty root list")

    factors = []
    default_var = sp.Symbol("x")

    for piece in pieces:
        if "=" in piece:
            sides = piece.split("=", 1)
            lhs_expr = _parse_single_expr(sides[0].strip(), ode_mode)
            rhs_expr = _parse_single_expr(sides[1].strip(), ode_mode)
            factors.append(lhs_expr - rhs_expr)
            if isinstance(lhs_expr, sp.Symbol):
                default_var = lhs_expr
        else:
            # Standalone root like "-3"
            val = _parse_single_expr(piece, ode_mode)
            factors.append(default_var - val)

    product = functools.reduce(operator.mul, factors, 1)
    return sp.Eq(product, 0)

def _find_toplevel_eq(text: str) -> Optional[int]:
    """
    Return the index of the first '=' that is NOT inside any parentheses
    or brackets. Returns None if every '=' is nested.
    Used to safely split  'f(x) = expr'  without breaking  'Eq(f(x), expr)'.
    """
    depth = 0
    for i, ch in enumerate(text):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "=" and depth == 0:
            return i
    return None

def parse_expr_safe(text: str, ode_mode: bool = False) -> Optional[sp.Basic]:
    """
    Safe parsing of math strings into SymPy expressions or Equations.
    Returns None if the input is empty or cannot be parsed.
    """
    if not text or not text.strip():
        return None

    cleaned = _clean_latex_and_text(text)
    if not cleaned:
        return None

    # Auto-detect ODE if primes are present
    is_ode = ode_mode or bool(re.search(r"y(?:'''|''|'|′′′|″|′)", cleaned))

    if is_ode:
        cleaned = _ode_preprocess(cleaned)

    try:
        # Multi-root check
        if ";" in cleaned:
            return _handle_multi_root(cleaned, ode_mode=is_ode)

        # Equation check — use depth-aware split so that Eq(f(x), expr)
        # or x**(-10) with nested parens is not broken by naive split("=").
        if "=" in cleaned:
            eq_idx = _find_toplevel_eq(cleaned)
            if eq_idx is not None:
                lhs_str = cleaned[:eq_idx].strip()
                rhs_str = cleaned[eq_idx + 1:].strip()
                if not lhs_str or not rhs_str:
                    return None
                lhs = _parse_single_expr(lhs_str, ode_mode=is_ode)
                rhs = _parse_single_expr(rhs_str, ode_mode=is_ode)
                return sp.Eq(lhs, rhs)
            else:
                # '=' is buried inside parens (e.g. inside Eq(...) call) —
                # parse the whole thing as an expression directly.
                return _parse_single_expr(cleaned, ode_mode=is_ode)

        # Normal expression
        return _parse_single_expr(cleaned, ode_mode=is_ode)

    except Exception:
        return None
