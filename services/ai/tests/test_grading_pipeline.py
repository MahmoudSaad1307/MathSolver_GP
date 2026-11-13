from types import SimpleNamespace

import pytest
from anthropic.types import TextBlock
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import CircuitBreaker, CircuitOpenError
from app.providers.groq_provider import GroqProvider
from app.providers.json_helper import execute_with_json_repair
from app.routes_grading import get_grade_cache
from app.schemas import ModelAnswerIn, RubricCriterionIn
from eval.fixtures import render_synthetic_handwriting_b64
from eval.harness import run_eval_harness


def _override_settings() -> Settings:
    return Settings(
        ai_internal_key="test_internal_key",
        ai_provider="fake",
        ai_blur_laplacian_min=120.0,
    )


def _make_client() -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = _override_settings
    get_grade_cache().clear()
    return TestClient(app)


def test_grading_endpoints_require_internal_key() -> None:
    client = _make_client()
    res = client.post(
        "/v1/transcribe",
        json={"images": [{"dataBase64": "aGVsbG8=", "mimeType": "image/jpeg"}]},
    )
    assert res.status_code == 401


def test_grade_essay_clean_cache_and_force_refresh() -> None:
    client = _make_client()
    b64, sha = render_synthetic_handwriting_b64(["y' = 2e^{2x}", "y'(0) = 2"])

    payload = {
        "questionPromptLatex": "Find slope of $y = e^{2x}$ at $x=0$.",
        "modelAnswer": {
            "solutionStepsLatex": ["$y' = 2e^{2x}$", "$y'(0) = 2$"],
            "finalAnswerLatex": "2",
            "finalAnswerSympy": "2",
            "commonMistakes": "Missing chain factor",
        },
        "rubricCriteria": [
            {
                "key": "derivative_rule",
                "descriptionEn": "Derivative rule",
                "descriptionAr": "قاعدة المشتقة",
                "maxPoints": 10,
            },
            {
                "key": "final_eval",
                "descriptionEn": "Evaluate at 0",
                "descriptionAr": "التعويض النهائي",
                "maxPoints": 5,
            },
        ],
        "images": [{"dataBase64": b64, "mimeType": "image/jpeg", "sha256": sha}],
        "rubricVersion": 1,
        "hintTag": "clean",
    }

    r1 = client.post(
        "/v1/grade-essay",
        headers={"X-Internal-Key": "test_internal_key"},
        json=payload,
    )
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["aiTotal"] == 15.0
    assert body1["sympyCheck"]["status"] == "EQUIVALENT"
    assert body1["needsReview"] is False
    assert body1["cached"] is False

    # Second identical call serves cached result
    r2 = client.post(
        "/v1/grade-essay",
        headers={"X-Internal-Key": "test_internal_key"},
        json=payload,
    )
    assert r2.status_code == 200
    assert r2.json()["cached"] is True

    # forceRefresh bypasses cache
    r3 = client.post(
        "/v1/grade-essay",
        headers={"X-Internal-Key": "test_internal_key"},
        json={**payload, "forceRefresh": True},
    )
    assert r3.status_code == 200
    assert r3.json()["cached"] is False


@pytest.mark.asyncio
async def test_json_repair_and_circuit_breaker_and_eval_harness() -> None:
    calls = 0

    async def bad_first() -> tuple[str, int, int]:
        nonlocal calls
        calls += 1
        return ("not valid json output", 10, 5)

    async def fixed_second(_prompt: str) -> tuple[str, int, int]:
        nonlocal calls
        calls += 1
        return ('{"ok": true, "score": 5}', 8, 6)

    repaired = await execute_with_json_repair(
        model_name="fake-grader-v1",
        initial_call=bad_first,
        repair_call=fixed_second,
    )
    assert calls == 2
    assert repaired.schema_retry_used is True
    assert repaired.parsed_json["ok"] is True

    breaker = CircuitBreaker(failure_threshold=2, reset_seconds=60.0)
    breaker.before_call()
    breaker.record_failure()
    breaker.record_failure()
    with pytest.raises(CircuitOpenError):
        breaker.before_call()

    summary = await run_eval_harness()
    assert summary.total_cases == 10
    assert summary.passed_cases == 10


@pytest.mark.asyncio
async def test_anthropic_and_groq_providers_with_mock_clients() -> None:
    anth = AnthropicProvider(
        api_key="sk-ant-test",
        transcribe_model="claude-sonnet-4-20250514",
        grade_model="claude-sonnet-4-20250514",
    )

    async def fake_anth_create(**_kwargs: object) -> object:
        return SimpleNamespace(
            content=[TextBlock(type="text", text='{"lines": [], "overallConfidence": 0.9}')],
            usage=SimpleNamespace(input_tokens=100, output_tokens=40),
        )

    anth._client = SimpleNamespace(  # type: ignore[assignment]
        messages=SimpleNamespace(create=fake_anth_create)
    )
    t_out = await anth.transcribe(
        processed_images=[("aGVsbG8=", "image/jpeg")],
        system_prompt="transcribe",
        question_prompt_latex="Find $y'$",
    )
    assert t_out.parsed_json["overallConfidence"] == 0.9
    assert t_out.input_tokens == 100

    g_out = await anth.grade(
        system_prompt="grade",
        question_prompt_latex="Find $y'$",
        model_answer=ModelAnswerIn(solutionStepsLatex=["$2$"], finalAnswerLatex="$2$"),
        rubric_criteria=[
            RubricCriterionIn(key="c1", descriptionEn="d", descriptionAr="و", maxPoints=5)
        ],
        wrapped_student_work="<UNTRUSTED_STUDENT_WORK>2</UNTRUSTED_STUDENT_WORK>",
        processed_images=[("aGVsbG8=", "image/jpeg")],
        include_images=True,
    )
    assert g_out.model_name == "claude-sonnet-4-20250514"

    groq_p = GroqProvider(
        api_key="gsk-test",
        vision_model="meta-llama/llama-4-scout-17b-16e-instruct",
        grade_model="meta-llama/llama-4-scout-17b-16e-instruct",
    )

    async def fake_groq_create(**_kwargs: object) -> object:
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content='{"lines": [], "overallConfidence": 0.85}')
                )
            ],
            usage=SimpleNamespace(prompt_tokens=90, completion_tokens=30),
        )

    groq_p._client = SimpleNamespace(  # type: ignore[assignment]
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_groq_create))
    )
    gt_out = await groq_p.transcribe(
        processed_images=[("aGVsbG8=", "image/jpeg")],
        system_prompt="transcribe",
        question_prompt_latex=None,
    )
    assert gt_out.parsed_json["overallConfidence"] == 0.85
    gg_out = await groq_p.grade(
        system_prompt="grade",
        question_prompt_latex="Find $y'$",
        model_answer=ModelAnswerIn(solutionStepsLatex=["$2$"], finalAnswerLatex="$2$"),
        rubric_criteria=[
            RubricCriterionIn(key="c1", descriptionEn="d", descriptionAr="و", maxPoints=5)
        ],
        wrapped_student_work="<UNTRUSTED_STUDENT_WORK>2</UNTRUSTED_STUDENT_WORK>",
        processed_images=[("aGVsbG8=", "image/jpeg")],
        include_images=True,
    )
    assert gg_out.input_tokens == 90

