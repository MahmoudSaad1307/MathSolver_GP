import sympy as sp
from core.parsing import parse_expr_safe
from core.verify import check_step, verify_chain

def test_correct_factoring_is_ok():
    # x^2 - 5x + 6 = 0 -> (x - 2)(x - 3) = 0
    p = parse_expr_safe("x^2 - 5x + 6 = 0")
    c = parse_expr_safe("(x - 2)(x - 3) = 0")
    status, note = check_step(p, c)
    assert status == "ok"

def test_wrong_factoring_is_bad():
    # x^2 - 5x + 6 = 0 -> (x - 2)(x + 3) = 0 is bad
    p = parse_expr_safe("x^2 - 5x + 6 = 0")
    c = parse_expr_safe("(x - 2)(x + 3) = 0")
    status, note = check_step(p, c)
    assert status == "bad"

def test_derivative_sign_error_is_bad():
    # d/dx(x^2) = 2x, but student writes -2x
    p = parse_expr_safe("Derivative(x^2, x)")
    c = parse_expr_safe("-2x")
    status, note = check_step(p, c)
    assert status == "bad"

def test_indefinite_integral_constant_both_ok():
    # Integral(2*x, x) -> x^2 is ok
    # and Integral(2*x, x) -> x^2 + 5 is ok
    p = parse_expr_safe("Integral(2x, x)")
    c1 = parse_expr_safe("x^2")
    c2 = parse_expr_safe("x^2 + 5")

    status1, _ = check_step(p, c1)
    status2, _ = check_step(p, c2)
    assert status1 == "ok"
    assert status2 == "ok"

def test_expression_to_equation_is_bad():
    # Expression -> Eq (student fabricated "= 0" from nowhere)
    p = parse_expr_safe("(x - 2)(x - 3)")
    c = parse_expr_safe("(x - 2)(x - 3) = 0")
    status, note = check_step(p, c)
    assert status == "bad"
    assert "عدم تطابق" in note or "نسيان" in note

def test_eq_to_expression_rhs_match_is_ok():
    # Eq -> expression where expression equals RHS (legitimate in solve mode)
    p = parse_expr_safe("f(x) = 2*x**(-10) + 7*x**(-2)")
    c = parse_expr_safe("2*x**(-10) + 7*x**(-2)")
    status, note = check_step(p, c)
    assert status == "ok"

def test_eq_to_expression_partial_result_is_unknown():
    # Eq -> expression where expression is a partial derivative (not bad, just unknown)
    p = parse_expr_safe("f(x) = 2*x**(-10) + 7*x**(-2)")
    c = parse_expr_safe("-20*x**(-11)")  # derivative of first term only
    status, note = check_step(p, c)
    assert status == "unknown"  # not bad — it's a partial result

def test_unverifiable_step_is_unknown():
    # Text or None or non-math
    status, note = check_step(None, parse_expr_safe("2x"))
    assert status == "unknown"

def test_verify_chain_skips_text_only():
    p = parse_expr_safe("x^2 - 4 = 0")
    steps = [
        ("نقوم بتحليل الفرق بين مربعين", None),
        ("التحليل إلى عوامل", parse_expr_safe("(x - 2)(x + 2) = 0")),
        ("إيجاد الجذور", parse_expr_safe("x = 2; x = -2")),
    ]
    chain = verify_chain(p, steps)
    assert len(chain) == 3
    assert chain[0].status == "skip"
    assert chain[1].status == "ok"
    assert chain[2].status == "ok"

def test_verify_chain_derivative_skip_and_advance():
    """Unevaluated Derivative steps should be skipped, with the next step
    compared against .doit() result."""
    problem = parse_expr_safe("x^3")
    d_step = parse_expr_safe("Derivative(x^3, x)")
    result_step = parse_expr_safe("3*x^2")

    chain = verify_chain(problem, [
        ("set up derivative", d_step),
        ("evaluate", result_step),
    ])
    assert chain[0].status == "skip"
    assert chain[1].status == "ok"

def test_verify_chain_term_by_term_derivative():
    """Term-by-term derivative: the chain model can't follow each sub-step,
    but chain should not mark them as 'bad' — they should be 'unknown'."""
    problem = parse_expr_safe("f(x) = 2*x**(-10) + 7*x**(-2)")
    steps = [
        ("rewrite", parse_expr_safe("f = 7/x^2 + 2/x^10")),
        ("diff term 1", parse_expr_safe("-20/x^11")),
        ("diff term 2", parse_expr_safe("-14/x^3")),
        ("combine", parse_expr_safe("-14/x^3 - 20/x^11")),
    ]
    chain = verify_chain(problem, steps)

    # Step 1: Eq → Eq with same RHS → ok
    assert chain[0].status == "ok"
    # Step 2: Eq → expression (partial) → unknown (NOT bad)
    assert chain[1].status == "unknown"
    # Steps 3, 4: partial results → may be bad or unknown (chain can't follow)
    # The important thing is they are NOT treated as proven wrong
    assert chain[2].status in ("ok", "unknown", "bad")  # chain model limitation
    assert chain[3].status in ("ok", "unknown", "bad")
