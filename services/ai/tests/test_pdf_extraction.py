from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from typing import Any

import pymupdf  # type: ignore[import-untyped]
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.pipeline.pdf_extractor import extract_exam_pdfs
from app.pipeline.pdf_preprocess import PdfValidationError, preprocess_pdf_document
from app.providers.base import LLMProvider, RawProviderCall
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
