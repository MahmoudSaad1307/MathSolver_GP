from __future__ import annotations

import base64
import json
from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any

import groq
import httpx
import pymupdf  # type: ignore[import-untyped]
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.pipeline.pdf_extractor import _extract_rhs_candidate, extract_exam_pdfs
from app.pipeline.pdf_preprocess import PdfValidationError, preprocess_pdf_document
from app.providers import (
    create_provider,
    create_secondary_provider,
    resolve_primary_provider_name,
)
from app.providers.base import (
    FailoverLLMProvider,
    LLMProvider,
    PayloadTooLargeError,
    ProviderRequestError,
    RawProviderCall,
    extract_json_object,
)
from app.providers.gemini_provider import GeminiProvider
from app.providers.groq_provider import GroqProvider
from app.schemas import ModelAnswerIn, RubricCriterionIn
from app.schemas_pdf import ExtractExamPdfRequest, PdfExtractModelRequest


def _build_pdf_b64(pages_text: list[str], *, image_only: bool = False) -> str:
    doc = pymupdf.open()
    for text in pages_text:
        page = doc.new_page(width=595, height=842)
        if text.strip():
            page.insert_text((50, 70), text, fontsize=12)
    if image_only:
        raster_doc = pymupdf.open()
        for page in doc:
            pix = page.get_pixmap(dpi=120, alpha=False)
            new_page = raster_doc.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, stream=pix.tobytes("png"))
        raw = raster_doc.tobytes()
        raster_doc.close()
        doc.close()
    else:
        raw = doc.tobytes()
        doc.close()
    return base64.b64encode(raw).decode("ascii")


class _ScriptedProvider(LLMProvider):
    def __init__(
        self,
        name: str,
        handler: Callable[[str | None, str], Awaitable[dict[str, Any]] | dict[str, Any]],
    ) -> None:
        self.provider_name = name
        self._handler = handler

    async def transcribe(self, **kwargs: Any) -> RawProviderCall:  # type: ignore[override]
        raise NotImplementedError

    async def grade(self, **kwargs: Any) -> RawProviderCall:  # type: ignore[override]
        raise NotImplementedError

    async def extract_json_with_images(
        self,
        *,
        processed_images: list[tuple[str, str]],
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        timeout_seconds: float | None = None,
        hint_tag: str | None = None,
    ) -> RawProviderCall:
        del processed_images, system_prompt, max_tokens, timeout_seconds
        maybe = self._handler(hint_tag, user_prompt)
        if isinstance(maybe, dict):
            payload = maybe
        else:
            payload = await maybe
        return RawProviderCall(
            raw_text="{}",
            parsed_json=payload,
            input_tokens=100,
            output_tokens=80,
            cost_usd=0.001,
            latency_ms=10,
            model_name=self.provider_name,
            schema_retry_used=False,
        )


def _override_settings() -> Settings:
    return Settings(
        ai_internal_key="test_internal_key",
        ai_provider="fake",
        pdf_max_pages=10,
    )


def _make_client(max_pages: int = 10) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        ai_internal_key="test_internal_key",
        ai_provider="fake",
        pdf_max_pages=max_pages,
    )
    return TestClient(app)


def test_extract_endpoint_requires_internal_key() -> None:
    client = _make_client()
    pdf_b64 = _build_pdf_b64(["Questions\nQ1: 2+2 = ?"])
    res = client.post(
        "/v1/extract-exam-pdf",
        json={"preModel": {"modelNumber": 1, "title": "Pre", "pdfBase64": pdf_b64}},
    )
    assert res.status_code == 401


def test_extract_pre_and_post_exam_pdfs_end_to_end() -> None:
    client = _make_client()
    pre_pdf = _build_pdf_b64(
        [
            "Questions\nQ1: Solve 2x = 10 [2 pts]\nA) 3\nB) 5\nC) 7\nD) 9\n"
            "Q2: Differentiate f(x) = x^2 + 3x [4 pts]",
            "Model Answer\nAns 1: B\nAns 2:\nf'(x) = 2x + 3\n2*x + 3",
        ]
    )
    post_pdf = _build_pdf_b64(
        [
            "Questions\nQ1: Solve 3x = 15 [2 pts]\nA) 5\nB) 6\nC) 7\nD) 8\n"
            "Q2: Differentiate g(x) = x^2 + 5x [4 pts]",
            "Model Answer\nAns 1: A\nAns 2:\ng'(x) = 2x + 5\n2*x + 5",
        ]
    )

    res = client.post(
        "/v1/extract-exam-pdf",
        headers={"X-Internal-Key": "test_internal_key"},
        json={
            "preModel": {"modelNumber": 1, "title": "Pre Exam", "pdfBase64": pre_pdf},
            "postModel": {"modelNumber": 2, "title": "Post Exam", "pdfBase64": post_pdf},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["models"]) == 2
    assert len(body["renderedPages"]) == 4
    m1, m2 = body["models"]
    assert m1["pageCount"] == 2
    assert len(m1["questions"]) == 2
    assert m1["questions"][0]["type"] == "MCQ"
    assert m1["questions"][1]["type"] == "ESSAY"
    assert m1["questions"][1]["sympyStatus"] == "VERIFIED"
    assert round(sum(c["maxPoints"] for c in m1["questions"][1]["rubricCriteria"]), 2) == 4.0
    assert m2["questions"][1]["sympyStatus"] == "VERIFIED"
    assert body["twinSummary"]["matchedConceptKeys"] == ["concept-1", "concept-2"]


def test_preprocess_rejects_invalid_and_oversized_pdfs() -> None:
    bad_b64 = base64.b64encode(b"not-a-pdf").decode("ascii")
    with pytest.raises(PdfValidationError) as exc_bad:
        preprocess_pdf_document(bad_b64)
    assert exc_bad.value.code == "PDF_INVALID"

    three_pages = _build_pdf_b64(["Page 1", "Page 2", "Page 3"])
    with pytest.raises(PdfValidationError) as exc_pages:
        preprocess_pdf_document(three_pages, max_pages=2)
    assert exc_pages.value.code == "PDF_TOO_MANY_PAGES"

    client = _make_client(max_pages=2)
    res = client.post(
        "/v1/extract-exam-pdf",
        headers={"X-Internal-Key": "test_internal_key"},
        json={"preModel": {"modelNumber": 1, "title": "Too Big", "pdfBase64": three_pages}},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "PDF_TOO_MANY_PAGES"


def test_preprocess_rasterized_image_only_pdf_marks_no_text_layer() -> None:
    raster_b64 = _build_pdf_b64(["Q1: x + 1 = 2", ""], image_only=True)
    pages = preprocess_pdf_document(raster_b64, max_pages=5)
    assert len(pages) == 2
    assert pages[0].has_text_layer is False
    assert pages[0].is_blank is False
    assert pages[1].is_blank is True


@pytest.mark.asyncio
async def test_sympy_conflict_arabic_labels_rubric_sum_and_dual_ocr_disagreement() -> None:
    pdf_b64 = _build_pdf_b64(["Questions page 1 [LOW_CONF]", "Model Answer page 2"])

    def primary_handler(tag: str | None, _prompt: str) -> dict[str, Any]:
        if tag == "pdf_segment":
            return {
                "pages": [
                    {
                        "pageNumber": 1,
                        "role": "QUESTIONS",
                        "questionNumbers": [1, 2, 3],
                        "answerNumbers": [],
                    },
                    {
                        "pageNumber": 2,
                        "role": "MODEL_ANSWERS",
                        "questionNumbers": [],
                        "answerNumbers": [1, 2],
                    },
                ],
                "questionNumbersFound": [1, 2, 3],
                "answerNumbersFound": [1, 2],
            }
        if tag and tag.startswith("pdf_ocr"):
            return {
                "blocks": [
                    {
                        "pageNumber": 1,
                        "role": "QUESTIONS",
                        "questionNumbers": [1, 2, 3],
                        "answerNumbers": [],
                        "text": "Q1 value is 150 [[UNSURE: 150]]",
                        "confidence": 0.65,
                    },
                    {
                        "pageNumber": 2,
                        "role": "MODEL_ANSWERS",
                        "questionNumbers": [],
                        "answerNumbers": [1, 2],
                        "text": "Ans 1 = 150",
                        "confidence": 0.96,
                    },
                ]
            }
        return {
            "questions": [
                {
                    "orderIndex": 1,
                    "conceptKey": "fractions-1",
                    "type": "MCQ",
                    "promptLatex": "احسب $\\frac{1}{2}$",
                    "points": 3,
                    "pointsWereInferred": True,
                    "sourceQuestionPages": [1],
                    "sourceAnswerPages": [2],
                    "mcqOptions": [
                        {"label": "أ", "textLatex": "$\\frac{1}{2}$", "isCorrect": True},
                        {"label": "ب", "textLatex": "$0.5$", "isCorrect": False},
                        {"label": "ج", "textLatex": "$1$", "isCorrect": False},
                        {"label": "د", "textLatex": "$2$", "isCorrect": False},
                    ],
                    "modelAnswer": {
                        "solutionStepsLatex": ["$= 3/4$"],
                        "finalAnswerLatex": "\\frac{3}{4}",
                        "finalAnswerSympy": "3/4",
                    },
                },
                {
                    "orderIndex": 2,
                    "conceptKey": "algebra-2",
                    "type": "ESSAY",
                    "promptLatex": "Solve $2x + 4 = 10$",
                    "points": 5,
                    "sourceQuestionPages": [1],
                    "sourceAnswerPages": [2],
                    "modelAnswer": {
                        "solutionStepsLatex": ["$2x = 6$", "$x = 3$"],
                        "finalAnswerLatex": "99",
                        "finalAnswerSympy": "99",
                        "commonMistakes": "",
                    },
                    "rubricCriteria": [
                        {
                            "orderIndex": 1,
                            "key": "step1",
                            "descriptionEn": "Isolate",
                            "descriptionAr": "فصل",
                            "maxPoints": 1,
                        },
                        {
                            "orderIndex": 2,
                            "key": "step2",
                            "descriptionEn": "Solve",
                            "descriptionAr": "حل",
                            "maxPoints": 1,
                        },
                    ],
                },
                {
                    "orderIndex": 3,
                    "conceptKey": "missing-3",
                    "type": "ESSAY",
                    "promptLatex": "Unmatched essay question",
                    "points": 4,
                    "sourceQuestionPages": [1],
                    "sourceAnswerPages": [],
                    "modelAnswer": None,
                    "rubricCriteria": [],
                },
            ],
            "unmatchedQuestionNumbers": [3],
            "unmatchedAnswerNumbers": [],
        }

    def secondary_handler(_tag: str | None, _prompt: str) -> dict[str, Any]:
        return {
            "blocks": [
                {
                    "pageNumber": 1,
                    "role": "QUESTIONS",
                    "questionNumbers": [1, 2, 3],
                    "answerNumbers": [],
                    "text": "Q1 value is 250",
                    "confidence": 0.92,
                }
            ]
        }

    result = await extract_exam_pdfs(
        ExtractExamPdfRequest(
            preModel=PdfExtractModelRequest(modelNumber=1, title="Edge", pdfBase64=pdf_b64)
        ),
        primary_provider=_ScriptedProvider("primary", primary_handler),
        secondary_provider=_ScriptedProvider("secondary", secondary_handler),
        settings=_override_settings(),
    )

    m = result.models[0]
    assert any(w.code == "COUNT_MISMATCH" for w in m.reportWarnings)

    q1, q2, q3 = m.questions
    q1_codes = {w.code for w in q1.warnings}
    assert "ARABIC_LABELS_MAPPED" in q1_codes
    assert "DUPLICATE_MCQ_OPTIONS" in q1_codes
    assert "MCQ_ANSWER_CONFLICT" in q1_codes
    assert "OCR_DISAGREEMENT" in q1_codes
    assert q1.dualOcrAgreed is False
    assert q1.needsTeacherConfirmation is True
    assert q1.modelAnswer is None  # Normalized away for strict MCQ persistence

    q2_codes = {w.code for w in q2.warnings}
    assert "ANSWER_STEP_MISMATCH" in q2_codes
    assert q2.sympyStatus == "MISMATCH"
    assert q2.rubricCriteria is not None
    assert round(sum(c.maxPoints for c in q2.rubricCriteria), 2) == 5.0

    q3_codes = {w.code for w in q3.warnings}
    assert "UNMATCHED_QUESTION" in q3_codes
    assert q3.needsTeacherConfirmation is True


@pytest.mark.asyncio
async def test_groq_fallback_json_latex_recovery_and_rhs_inline_math() -> None:
    # 1. JSON recovery ignores <think> braces and raw single-backslash LaTeX commands
    raw_llm = (
        '<think>Reasoning with set {1, 2} and \\alpha</think>\n'
        '```json\n{"promptLatex": "Solve $\\sqrt{x} = 4$", "ok": true}\n```'
    )
    parsed = extract_json_object(raw_llm)
    assert parsed["ok"] is True
    assert "\\sqrt{x}" in parsed["promptLatex"]

    # Also test literal single backslash `\s` (non-JSON escape)
    raw_unescaped = r'<think>{x}</think> {"expr": "$\sqrt{x} + \cdot 2$"}'
    parsed_unescaped = extract_json_object(raw_unescaped)
    assert "expr" in parsed_unescaped

    # 2. Inline prose math extraction extracts RHS equation cleanly for SymPy
    assert _extract_rhs_candidate("Combine terms to get $f'(x) = 2x + 3$.") == "2x + 3"

    # 3. GroqProvider falls back from deprecated model (404) to qwen/qwen3.8-27b cleanly
    gp = GroqProvider(
        api_key="gsk-test",
        vision_model="meta-llama/llama-4-scout-17b-16e-instruct",
        grade_model="meta-llama/llama-4-scout-17b-16e-instruct",
    )
    models_tried: list[str] = []

    async def mock_create(**kwargs: Any) -> Any:
        m = kwargs["model"]
        models_tried.append(m)
        if m == "meta-llama/llama-4-scout-17b-16e-instruct":
            req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
            resp = httpx.Response(404, request=req)
            raise groq.NotFoundError("model_not_found", response=resp, body=None)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"pages": []}'))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        )

    gp._client = SimpleNamespace(  # type: ignore[assignment]
        chat=SimpleNamespace(completions=SimpleNamespace(create=mock_create))
    )
    res = await gp.extract_json_with_images(
        processed_images=[("aGVsbG8=", "image/jpeg")],
        system_prompt="segment",
        user_prompt="page 1",
    )
    assert res.parsed_json == {"pages": []}
    assert models_tried == [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "qwen/qwen3.8-27b",
    ]

    # 4. Non-retryable 400 becomes ProviderRequestError (mapped to 502 instead of HTTP 500)
    async def mock_bad_req(**_kwargs: Any) -> Any:
        req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
        resp = httpx.Response(400, request=req)
        raise groq.BadRequestError("too many images", response=resp, body=None)

    gp._client = SimpleNamespace(  # type: ignore[assignment]
        chat=SimpleNamespace(completions=SimpleNamespace(create=mock_bad_req))
    )
    with pytest.raises(ProviderRequestError):
        await gp.extract_json_with_images(
            processed_images=[("aGVsbG8=", "image/jpeg")],
            system_prompt="segment",
            user_prompt="page 1",
        )


@pytest.mark.asyncio
async def test_segmentation_batches_respect_image_cap_and_route_maps_request_errors() -> None:
    pdf_b64 = _build_pdf_b64([f"Page {i} text content here" for i in range(1, 6)])
    batch_sizes: list[int] = []

    class _CountingProvider(LLMProvider):
        provider_name = "counting"

        async def transcribe(self, **kwargs: Any) -> RawProviderCall:  # type: ignore[override]
            raise NotImplementedError

        async def grade(self, **kwargs: Any) -> RawProviderCall:  # type: ignore[override]
            raise NotImplementedError

        async def extract_json_with_images(
            self,
            *,
            processed_images: list[tuple[str, str]],
            system_prompt: str,
            user_prompt: str,
            max_tokens: int = 4096,
            timeout_seconds: float | None = None,
            hint_tag: str | None = None,
        ) -> RawProviderCall:
            del system_prompt, user_prompt, max_tokens, timeout_seconds
            if hint_tag == "pdf_segment":
                batch_sizes.append(len(processed_images))
                return RawProviderCall(
                    raw_text="{}",
                    parsed_json={
                        "pages": [{"pageNumber": i, "role": "QUESTIONS"} for i in range(1, 6)]
                    },
                    input_tokens=10,
                    output_tokens=10,
                    cost_usd=0.0,
                    latency_ms=1,
                    model_name="counting",
                    schema_retry_used=False,
                )
            if hint_tag == "pdf_structure_pair":
                return RawProviderCall(
                    raw_text="{}",
                    parsed_json={"questions": []},
                    input_tokens=10,
                    output_tokens=10,
                    cost_usd=0.0,
                    latency_ms=1,
                    model_name="counting",
                    schema_retry_used=False,
                )
            return RawProviderCall(
                raw_text="{}",
                parsed_json={"blocks": []},
                input_tokens=10,
                output_tokens=10,
                cost_usd=0.0,
                latency_ms=1,
                model_name="counting",
                schema_retry_used=False,
            )

    await extract_exam_pdfs(
        ExtractExamPdfRequest(
            preModel=PdfExtractModelRequest(modelNumber=1, title="5 Pages", pdfBase64=pdf_b64)
        ),
        primary_provider=_CountingProvider(),
        secondary_provider=None,
        settings=_override_settings(),
    )
    assert batch_sizes
    assert max(batch_sizes) <= 3

    # Verify /v1/extract-exam-pdf maps ProviderRequestError -> HTTP 502 (never bare HTTP 500)
    app = create_app()
    app.dependency_overrides[get_settings] = _override_settings
    client = TestClient(app)

    from app import routes_pdf

    class _FailingProvider(_CountingProvider):
        async def extract_json_with_images(self, **_kwargs: Any) -> RawProviderCall:
            raise ProviderRequestError("Simulated upstream 400")

    orig = routes_pdf.get_provider_cached
    routes_pdf.get_provider_cached = lambda *_args, **_kwargs: _FailingProvider()  # type: ignore[assignment]
    try:
        resp = client.post(
            "/v1/extract-exam-pdf",
            headers={"X-Internal-Key": "test_internal_key"},
            json={"preModel": {"modelNumber": 1, "title": "Pre", "pdfBase64": pdf_b64}},
        )
        assert resp.status_code == 502
        assert resp.json()["detail"]["code"] == "PDF_EXTRACTION_FAILED"
    finally:
        routes_pdf.get_provider_cached = orig  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_gemini_priority_routing_mock_client_and_failover() -> None:
    # 1. Gemini takes top priority even if AI_PROVIDER=groq in Render/local env
    s_both = Settings(
        ai_internal_key="k",
        ai_provider="groq",
        gemini_api_key="AQ.test-key",
        groq_api_key="gsk-test-key",
    )
    assert resolve_primary_provider_name(s_both) == "gemini"
    primary = create_provider(s_both)
    secondary = create_secondary_provider(s_both)
    assert primary.provider_name == "gemini"
    assert isinstance(primary, FailoverLLMProvider)
    assert secondary is not None
    assert secondary.provider_name == "groq"

    # Fake mode keeps deterministic isolation even when real keys exist in environment
    s_fake = Settings(
        ai_internal_key="k",
        ai_provider="fake",
        gemini_api_key="AQ.test-key",
        groq_api_key="gsk-test-key",
    )
    assert resolve_primary_provider_name(s_fake) == "fake"
    assert create_secondary_provider(s_fake) is None

    # 2. GeminiProvider handles generateContent JSON, 503 model fallback, and usage tokens
    called_models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "gemini-3.8-flash:generateContent" in url:
            called_models.append("gemini-3.8-flash")
            return httpx.Response(503, json={"error": {"message": "high demand"}})
        if "gemini-flash-latest:generateContent" in url:
            called_models.append("gemini-flash-latest")
            body = json.loads(request.content.decode("utf-8"))
            assert body["generationConfig"]["responseMimeType"] == "application/json"
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [{"text": '{"pages": [{"pageNumber": 1}], "ok": true}'}]
                            }
                        }
                    ],
                    "usageMetadata": {
                        "promptTokenCount": 120,
                        "candidatesTokenCount": 30,
                        "thoughtsTokenCount": 10,
                    },
                },
            )
        return httpx.Response(400, json={"error": {"message": "unexpected"}})

    async_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    gem = GeminiProvider(
        api_key="AQ.test-key",
        vision_model="gemini-3.8-flash",
        grade_model="gemini-3.8-flash",
        client=async_client,
    )
    out = await gem.extract_json_with_images(
        processed_images=[("aGVsbG8=", "image/jpeg")],
        system_prompt="segment",
        user_prompt="page 1",
    )
    assert called_models == ["gemini-3.8-flash", "gemini-flash-latest"]
    assert out.parsed_json["ok"] is True
    assert out.input_tokens == 120
    assert out.output_tokens == 40

    g_out = await gem.grade(
        system_prompt="grade",
        question_prompt_latex="2+2",
        model_answer=ModelAnswerIn(solutionStepsLatex=["$4$"], finalAnswerLatex="$4$"),
        rubric_criteria=[
            RubricCriterionIn(key="c1", descriptionEn="d", descriptionAr="و", maxPoints=5)
        ],
        wrapped_student_work="<UNTRUSTED_STUDENT_WORK>4</UNTRUSTED_STUDENT_WORK>",
        processed_images=[("aGVsbG8=", "image/jpeg")],
        include_images=True,
    )
    assert g_out.parsed_json["ok"] is True

    # 3. FailoverLLMProvider falls back cleanly to backup provider when primary rejects (400)
    def bad_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "invalid argument"}})

    bad_gem = GeminiProvider(
        api_key="AQ.test-key",
        vision_model="gemini-flash-latest",
        client=httpx.AsyncClient(transport=httpx.MockTransport(bad_handler)),
    )
    backup = _ScriptedProvider("groq", lambda _tag, _prompt: {"pages": [{"pageNumber": 1}]})
    failover = FailoverLLMProvider(bad_gem, backup)
    fo_out = await failover.extract_json_with_images(
        processed_images=[("aGVsbG8=", "image/jpeg")],
        system_prompt="segment",
        user_prompt="page 1",
    )
    assert fo_out.model_name == "groq"
    await async_client.aclose()


@pytest.mark.asyncio
async def test_payload_too_large_splits_batches_handles_recheck_and_timeout_pin() -> None:
    pdf_b64 = _build_pdf_b64(["Page 1 Q1: 2x=4", "Page 2 Q2: 3x=9", "Page 3 Answers: A1=2, A2=3"])

    # 1. Multi-page batches split down to 1-page calls on PayloadTooLargeError (HTTP 413),
    #    structuring retries compactly, and secondary 413 during recheck never crashes extraction.
    seg_sizes: list[int] = []
    win_sizes: list[int] = []
    struct_attempts = 0

    class _SplitOn413Provider(LLMProvider):
        provider_name = "gemini"

        async def extract_json_with_images(
            self,
            *,
            processed_images: list[tuple[str, str]],
            system_prompt: str,
            user_prompt: str,
            max_tokens: int = 4096,
            timeout_seconds: float | None = None,
            hint_tag: str | None = None,
        ) -> RawProviderCall:
            nonlocal struct_attempts
            del system_prompt, user_prompt, max_tokens, timeout_seconds
            if hint_tag == "pdf_segment":
                seg_sizes.append(len(processed_images))
                if len(processed_images) > 1:
                    raise PayloadTooLargeError("Groq HTTP 413: too many pages")
                pno = 1 if seg_sizes.count(1) == 1 else (2 if seg_sizes.count(1) == 2 else 3)
                role = "MODEL_ANSWERS" if pno == 3 else "QUESTIONS"
                return RawProviderCall(
                    raw_text="{}",
                    parsed_json={
                        "pages": [{"pageNumber": pno, "role": role}],
                        "questionNumbersFound": [1, 2],
                        "answerNumbersFound": [1, 2],
                    },
                    input_tokens=50,
                    output_tokens=20,
                    cost_usd=0.0,
                    latency_ms=1,
                    model_name="split-test",
                    schema_retry_used=False,
                )
            if hint_tag in ("pdf_ocr_window", "pdf_ocr_recheck"):
                win_sizes.append(len(processed_images))
                if len(processed_images) > 1:
                    raise PayloadTooLargeError("Groq HTTP 413: window too large")
                idx = min(3, max(1, win_sizes.count(1)))
                return RawProviderCall(
                    raw_text="{}",
                    parsed_json={
                        "blocks": [
                            {
                                "pageNumber": idx,
                                "confidence": 0.7 if idx == 1 else 0.95,
                                "text": "ok",
                            }
                        ]
                    },
                    input_tokens=50,
                    output_tokens=20,
                    cost_usd=0.0,
                    latency_ms=1,
                    model_name="split-test",
                    schema_retry_used=False,
                )
            struct_attempts += 1
            if struct_attempts == 1:
                raise PayloadTooLargeError("Groq HTTP 413: struct prompt too large")
            return RawProviderCall(
                raw_text="{}",
                parsed_json={
                    "questions": [
                        {
                            "orderIndex": 1,
                            "conceptKey": "linear",
                            "type": "MCQ",
                            "promptLatex": "Solve $2x=4$",
                            "points": 2,
                            "sourceQuestionPages": [1],
                            "sourceAnswerPages": [3],
                            "mcqOptions": [
                                {"label": "A", "textLatex": "$1$", "isCorrect": False},
                                {"label": "B", "textLatex": "$2$", "isCorrect": True},
                                {"label": "C", "textLatex": "$3$", "isCorrect": False},
                                {"label": "D", "textLatex": "$4$", "isCorrect": False},
                            ],
                        }
                    ],
                    "unmatchedQuestionNumbers": [],
                    "unmatchedAnswerNumbers": [],
                },
                input_tokens=40,
                output_tokens=20,
                cost_usd=0.0,
                latency_ms=1,
                model_name="split-test",
                schema_retry_used=False,
            )

        async def transcribe(self, **_kwargs: Any) -> RawProviderCall:
            raise NotImplementedError

        async def grade(self, **_kwargs: Any) -> RawProviderCall:
            raise NotImplementedError

    class _FailingSecondary413(_SplitOn413Provider):
        provider_name = "groq"

        async def extract_json_with_images(self, **_kwargs: Any) -> RawProviderCall:
            raise PayloadTooLargeError("Groq HTTP 413 during secondary recheck")

    res = await extract_exam_pdfs(
        ExtractExamPdfRequest(
            preModel=PdfExtractModelRequest(modelNumber=1, title="Split413", pdfBase64=pdf_b64)
        ),
        primary_provider=_SplitOn413Provider(),
        secondary_provider=_FailingSecondary413(),
        settings=_override_settings(),
    )
    assert seg_sizes == [3, 1, 1, 1]
    assert 2 in win_sizes and 1 in win_sizes
    assert struct_attempts == 2
    assert len(res.models[0].questions) == 1

    # 2. GroqProvider raises PayloadTooLargeError on 413 when multi-image,
    #    and recovers via single-image compacted retry when single-image returns 413 once.
    groq_prov = GroqProvider(
        api_key="gsk-test",
        vision_model="qwen/qwen3.8-27b",
        grade_model="qwen/qwen3.8-27b",
    )
    req_count = 0

    async def _fake_create_413_then_ok(**_kwargs: Any) -> Any:
        nonlocal req_count
        req_count += 1
        if req_count == 1:
            fake_req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
            fake_resp = httpx.Response(413, request=fake_req)
            raise groq.APIStatusError(
                "too large",
                response=fake_resp,
                body={"error": {"code": "rate_limit_exceeded"}},
            )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok": true}'))],
            usage=SimpleNamespace(prompt_tokens=30, completion_tokens=10),
        )

    groq_prov._client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=_fake_create_413_then_ok))
    )  # type: ignore[assignment]
    g_res = await groq_prov.extract_json_with_images(
        processed_images=[("aGVsbG8=", "image/jpeg")],
        system_prompt="s",
        user_prompt="u" * 3000,
    )
    assert g_res.parsed_json["ok"] is True
    assert req_count == 2

    # 3. GeminiProvider pins gemini-flash-latest when preview model times out
    timeout_models: list[str] = []

    def timeout_handler(request: httpx.Request) -> httpx.Response:
        if "gemini-3.8-flash:generateContent" in str(request.url):
            timeout_models.append("gemini-3.8-flash")
            raise httpx.ReadTimeout("timed out", request=request)
        timeout_models.append("gemini-flash-latest")
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}],
                "usageMetadata": {"promptTokenCount": 20, "candidatesTokenCount": 5},
            },
        )

    t_client = httpx.AsyncClient(transport=httpx.MockTransport(timeout_handler))
    t_gem = GeminiProvider(
        api_key="AQ.test-key",
        vision_model="gemini-3.8-flash",
        grade_model="gemini-3.8-flash",
        client=t_client,
    )
    t_out = await t_gem.extract_json_with_images(
        processed_images=[],
        system_prompt="s",
        user_prompt="u",
    )
    assert t_out.parsed_json["ok"] is True
    assert t_gem._grade_model == "gemini-flash-latest"
    assert timeout_models == ["gemini-3.8-flash", "gemini-flash-latest"]
    await t_client.aclose()
