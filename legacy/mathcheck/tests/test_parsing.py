import sympy as sp
from core.parsing import parse_expr_safe

def test_implicit_multiplication():
    res = parse_expr_safe("2x")
    assert res is not None
    x = sp.Symbol("x")
    assert res == 2 * x

def test_power_xor_conversion():
    res = parse_expr_safe("x^2")
    assert res is not None
    x = sp.Symbol("x")
    assert res == x**2

def test_multi_root_semicolon():
    res = parse_expr_safe("x = 2; x = -3")
    assert res is not None
    assert isinstance(res, sp.Eq)
    x = sp.Symbol("x")
    # Eq((x - 2)*(x + 3), 0)
    expected = sp.Eq((x - 2) * (x + 3), 0)
    assert sp.simplify(res.lhs - expected.lhs) == 0

def test_ode_primes_conversion():
    res = parse_expr_safe("y'' + y = 0")
    assert res is not None
    assert isinstance(res, sp.Eq)
    x = sp.Symbol("x")
    y = sp.Function("y")
    expected = sp.Eq(sp.Derivative(y(x), x, 2) + y(x), 0)
    assert res == expected

def test_ode_first_derivative():
    res = parse_expr_safe("y' - 2y = 0")
    assert res is not None
    assert isinstance(res, sp.Eq)
    x = sp.Symbol("x")
    y = sp.Function("y")
    expected = sp.Eq(sp.Derivative(y(x), x) - 2 * y(x), 0)
    assert sp.simplify(res.lhs - expected.lhs) == 0

def test_invalid_and_empty():
    assert parse_expr_safe("") is None
    assert parse_expr_safe("   ") is None
    assert parse_expr_safe("??? not math ???") is None

def test_negative_exponents_various_formats():
    x = sp.Symbol("x")
    assert parse_expr_safe("x**(-10)") == x**(-10)
    assert parse_expr_safe("x**-10") == x**(-10)
    assert parse_expr_safe("x^-10") == x**(-10)
    assert parse_expr_safe("x^{-10}") == x**(-10)
    assert parse_expr_safe("x\u207b\u00b9\u2070") == x**(-10)
    assert parse_expr_safe("x**(\u221210)") == x**(-10)

def test_latex_fractions_and_negative_powers():
    x = sp.Symbol("x")
    frac_parsed = parse_expr_safe(r"\frac{-20}{x^{11}} - \frac{14}{x^3}")
    expected = -20/x**11 - 14/x**3
    assert sp.simplify(frac_parsed - expected) == 0

def test_bare_function_assignment():
    res = parse_expr_safe("f = 7/x^2 + 2/x^10")
    assert res is not None
    assert isinstance(res, sp.Eq)
    assert res.lhs == sp.Symbol("f")

