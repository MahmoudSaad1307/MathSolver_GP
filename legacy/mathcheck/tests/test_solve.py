from unittest.mock import MagicMock
from core.solve import solve_verified

def test_solve_retry_on_bad_step():
    # Attempt 0: LLM returns a mathematically wrong step
    # Attempt 1: LLM corrects the step and returns valid math
    mock_client = MagicMock()
    mock_client.chat_json.side_effect = [
        # Attempt 0
        {
            "steps": [
                {"explain": "تحليل غير سليم", "expr": "(x - 1)*(x - 6) = 0"},
                {"explain": "الجذور", "expr": "x = 1; x = 6"},
            ],
            "answer": "x = 1, x = 6",
        },
        # Attempt 1
        {
            "steps": [
                {"explain": "هنحلل المعادلة بالشكل السليم", "expr": "(x - 2)*(x - 3) = 0"},
                {"explain": "قيم x", "expr": "x = 2; x = 3"},
            ],
            "answer": "x = 2, x = 3",
        },
    ]

    result = solve_verified("x^2 - 5x + 6 = 0", client=mock_client)

    assert mock_client.chat_json.call_count == 2
    assert result.retries_used == 1
    assert result.is_fully_verified is True
    assert len(result.steps) == 2
    assert result.steps[0].status == "ok"
    assert result.steps[1].status == "ok"
    assert "✅" in result.status_summary

def test_solve_reaches_max_retries_and_marks_failure():
    # Model consistently returns a wrong step
    mock_client = MagicMock()
    mock_client.chat_json.return_value = {
        "steps": [
            {"explain": "خطوة خاطئة مستمرة", "expr": "(x - 10)*(x + 10) = 0"},
        ],
        "answer": "x = 10",
    }

    result = solve_verified("x^2 - 4 = 0", client=mock_client)

    assert result.is_fully_verified is False
    assert any(s.status == "bad" for s in result.steps)
    assert any("الموديل غلط هنا ومقدرش يصلحها" in s.note for s in result.steps)
