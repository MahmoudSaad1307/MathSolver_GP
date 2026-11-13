from unittest.mock import MagicMock
from core.check import check_student_steps

def test_four_step_solution_with_error_in_step_3():
    # 4-step solution with error in step 3:
    # Problem: x^2 - 5x + 6 = 0
    # Step 1: x^2 - 2x - 3x + 6 = 0  (ok)
    # Step 2: x*(x - 2) - 3*(x - 2) = 0  (ok)
    # Step 3: (x - 2)*(x + 3) = 0  (BAD, wrong sign +3 instead of -3)
    # Step 4: x = 2; x = -3  (downstream ok from step 3)
    lines = [
        "x^2 - 5x + 6 = 0",
        "x^2 - 2x - 3x + 6 = 0",
        "x*(x - 2) - 3*(x - 2) = 0",
        "(x - 2)*(x + 3) = 0",
        "x = 2; x = -3",
    ]

    mock_client = MagicMock()
    mock_client.chat_json.return_value = {
        "mistake": "إشارة القوس الثاني +3 بدلاً من -3",
        "rule": "قاعدة الإشارات عند إخراج العامل المشترك السالب",
        "correct_step": "(x - 2)*(x - 3) = 0",
    }

    result = check_student_steps(lines, client=mock_client)

    assert result.success is False
    assert result.first_bad_step == 3
    assert len(result.steps) == 4

    # Step 1 is OK
    assert result.steps[0].status == "ok"
    # Step 2 is OK
    assert result.steps[1].status == "ok"
    # Step 3 is BAD
    assert result.steps[2].status == "bad"
    assert result.steps[2].explanation is not None
    assert result.steps[2].explanation.mistake == "إشارة القوس الثاني +3 بدلاً من -3"
    # Step 4 is downstream_ok
    assert result.steps[3].status == "downstream_ok"
    assert "مبنية على الغلط اللي فات" in result.steps[3].note

def test_all_steps_correct():
    lines = [
        "x^2 - 4 = 0",
        "(x - 2)*(x + 2) = 0",
        "x = 2; x = -2",
    ]
    result = check_student_steps(lines)
    assert result.success is True
    assert result.first_bad_step is None
    assert "كل خطواتك سليمة" in result.summary_message
    assert all(s.status == "ok" for s in result.steps)

def test_unparsable_line_stops_immediately():
    lines = [
        "x^2 - 4 = 0",
        "??? unparsable line ???",
        "x = 2",
    ]
    result = check_student_steps(lines)
    assert result.success is False
    assert result.parse_error_line == 2
    assert "تعذر تفسير الخطوة 2" in result.summary_message
