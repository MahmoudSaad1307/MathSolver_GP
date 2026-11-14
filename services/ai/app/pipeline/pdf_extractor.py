from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any, Literal, cast

from app.checks.sympy_sandbox import compare_expressions_in_sandbox
from app.config import Settings
from app.pipeline.pdf_preprocess import PreprocessedPdfPage, preprocess_pdf_document
from app.prompts import (
    PROMPT_VERSION_PDF_OCR_WINDOW,
    PROMPT_VERSION_PDF_SEGMENT,
    PROMPT_VERSION_PDF_STRUCTURE_PAIR,
    load_prompt,
)
from app.providers.base import (
    CircuitOpenError,
    LLMProvider,
    PayloadTooLargeError,
    ProviderRequestError,
    ProviderUpstreamError,
    RawProviderCall,
)
from app.schemas_pdf import (
    ExtractedModelOut,
    ExtractedQuestionOut,
    ExtractedQuestionWarningOut,
    ExtractExamPdfRequest,
    ExtractExamPdfResponse,
    McqOptionOut,
    ModelAnswerOut,
    PdfExtractionTelemetryOut,
    PdfExtractModelRequest,
    PdfPageMetaOut,
    PdfPageRole,
    PdfSympyStatus,
    ReferenceTwinQuestion,
    RenderedPageOut,
    RubricCriterionOut,
    TwinSummaryOut,
)

logger = logging.getLogger("mathlens.ai.pdf_extractor")

ARABIC_LABEL_MAP: dict[str, Literal["A", "B", "C", "D"]] = {
    "أ": "A",
    "ا": "A",
    "ب": "B",
    "ج": "C",
    "د": "D",
    "A": "A",
    "B": "B",
    "C": "C",
    "D": "D",
}


class _TelemetryAccumulator:
    def __init__(self, provider: str, secondary: str | None) -> None:
        self.provider = provider
        self.secondary = secondary
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0

    def add(self, call: RawProviderCall) -> None:
        self.input_tokens += call.input_tokens
        self.output_tokens += call.output_tokens
        self.cost_usd += call.cost_usd


def _warning(
    code: str, severity: Literal["info", "warning", "error"], en: str, ar: str
) -> ExtractedQuestionWarningOut:
    return ExtractedQuestionWarningOut(code=code, severity=severity, messageEn=en, messageAr=ar)


def _strip_math_delimiters(expr: str) -> str:
    cleaned = expr.strip()
    if cleaned.startswith("$$") and cleaned.endswith("$$") and len(cleaned) >= 4:
        cleaned = cleaned[2:-2].strip()
    elif cleaned.startswith("$") and cleaned.endswith("$") and len(cleaned) >= 2:
        cleaned = cleaned[1:-1].strip()
    cleaned = re.sub(r"\\text\{[^}]*\}", "", cleaned).strip()
    return cleaned.rstrip(".,;:")


def _extract_rhs_candidate(step_text: str) -> str:
    # Prefer the final inline/display math span when solution steps wrap equations in prose
    math_spans = re.findall(r"\$\$?([^$]+)\$\$?", step_text)
    target = math_spans[-1].strip() if math_spans else step_text
    cleaned = _strip_math_delimiters(target)
    if "=" in cleaned:
        return cleaned.split("=")[-1].strip()
    return cleaned


def _significant_numbers(text: str) -> set[str]:
    return {
        num.lstrip("0") or "0"
        for num in re.findall(r"\b\d+(?:\.\d+)?\b", text)
        if len(num) >= 2 or int(float(num)) >= 2
    }


def _normalize_mcq_options(
    raw_opts: list[dict[str, Any]],
) -> tuple[list[McqOptionOut], bool]:
    mapped_arabic = False
    out: list[McqOptionOut] = []
    for opt in raw_opts:
        raw_lbl = str(opt.get("label", "")).strip()
        upper_lbl = raw_lbl.upper()
        mapped = ARABIC_LABEL_MAP.get(raw_lbl) or ARABIC_LABEL_MAP.get(upper_lbl)
        if raw_lbl in {"أ", "ا", "ب", "ج", "د"}:
            mapped_arabic = True
        if mapped is None:
            continue
        out.append(
            McqOptionOut(
                label=mapped,
                textLatex=str(opt.get("textLatex", "")).strip(),
                isCorrect=bool(opt.get("isCorrect", False)),
            )
        )
    return out, mapped_arabic


def _normalize_rubric_criteria(
    raw_criteria: list[dict[str, Any]],
    total_points: float,
) -> list[RubricCriterionOut]:
    if not raw_criteria:
        method_pts = round(total_points * 0.6, 2)
        final_pts = round(total_points - method_pts, 2)
        if final_pts <= 0:
            return [
                RubricCriterionOut(
                    orderIndex=1,
                    key="solution",
                    descriptionEn="Complete solution and final answer",
                    descriptionAr="الحل الكامل والإجابة النهائية",
                    maxPoints=round(total_points, 2),
                )
            ]
        return [
            RubricCriterionOut(
                orderIndex=1,
                key="method",
                descriptionEn="Method and intermediate steps",
                descriptionAr="خطوات الحل والمنهجية",
                maxPoints=method_pts,
            ),
            RubricCriterionOut(
                orderIndex=2,
                key="final_answer",
                descriptionEn="Accurate final answer",
                descriptionAr="الإجابة النهائية الصحيحة",
                maxPoints=final_pts,
            ),
        ]

    parsed: list[RubricCriterionOut] = []
    raw_sum = sum(max(0.1, float(item.get("maxPoints", 1.0))) for item in raw_criteria)
    scale = total_points / raw_sum if raw_sum > 0 else 1.0
    running = 0.0
    for idx, item in enumerate(raw_criteria, start=1):
        is_last = idx == len(raw_criteria)
        if is_last:
            pts = round(max(0.01, total_points - running), 2)
        else:
            pts = round(max(0.01, float(item.get("maxPoints", 1.0)) * scale), 2)
            if running + pts >= total_points:
                pts = round(max(0.01, (total_points - running) / 2.0), 2)
            running += pts
        parsed.append(
            RubricCriterionOut(
                orderIndex=idx,
                key=str(item.get("key") or f"criterion_{idx}")[:100],
                descriptionEn=str(item.get("descriptionEn") or f"Step {idx}")[:1000],
                descriptionAr=str(item.get("descriptionAr") or f"الخطوة {idx}")[:1000],
                maxPoints=pts,
            )
        )
    return parsed


def _resolve_batch_page_numbers(
    entries: list[dict[str, Any]],
    batch: list[PreprocessedPdfPage],
) -> list[int]:
    """Map model-emitted pageNumber values back to global 1-based PDF page indices."""
    expected = [p.page_number for p in batch]
    expected_set = set(expected)
    raw_nums = [int(e.get("pageNumber", 0) or 0) for e in entries]
    if not raw_nums:
        return []
    if len(expected) == 1:
        return [expected[0] for _ in raw_nums]
    if all(n in expected_set for n in raw_nums):
        return raw_nums
    if len(raw_nums) <= len(expected) and all(1 <= n <= len(expected) for n in raw_nums):
        return [expected[n - 1] for n in raw_nums]
    if any(n in expected_set for n in raw_nums):
        return [n if n in expected_set else 0 for n in raw_nums]
    return [expected[idx] if idx < len(expected) else 0 for idx in range(len(raw_nums))]


async def _segment_pages(
    pages: list[PreprocessedPdfPage],
    *,
    provider: LLMProvider,
    settings: Settings,
    telemetry: _TelemetryAccumulator,
) -> tuple[dict[int, PdfPageRole], list[int], list[int]]:
    non_blank = [p for p in pages if not p.is_blank]
    roles: dict[int, PdfPageRole] = {p.page_number: "COVER_BLANK" for p in pages if p.is_blank}
    q_found: set[int] = set()
    a_found: set[int] = set()

    system_prompt = load_prompt(PROMPT_VERSION_PDF_SEGMENT)
    # Groq on-demand ITPM cap (7000 tokens) requires 1-page batches; Gemini/Anthropic handle <= 3
    max_pages_per_batch = 1 if provider.provider_name == "groq" else 3
    initial_hint_cap = 900 if provider.provider_name == "groq" else 1500
    batches: list[list[PreprocessedPdfPage]] = []
    cur_batch: list[PreprocessedPdfPage] = []
    cur_bytes = 0
    for page in non_blank:
        page_len = len(page.image_b64)
        if cur_batch and (
            len(cur_batch) >= max_pages_per_batch or cur_bytes + page_len > 2_600_000
        ):
            batches.append(cur_batch)
            cur_batch = []
            cur_bytes = 0
        cur_batch.append(page)
        cur_bytes += page_len
    if cur_batch:
        batches.append(cur_batch)

    async def _run_batch(batch: list[PreprocessedPdfPage], *, hint_cap: int) -> None:
        prompt_parts = [
            (
                f"[PAGE {p.page_number}]\nNative text hint:\n"
                f"{(p.native_text[:hint_cap] if hint_cap > 0 else '') or '(omitted)'}"
            )
            for p in batch
        ]
        try:
            call = await provider.extract_json_with_images(
                processed_images=[(p.image_b64, p.mime_type) for p in batch],
                system_prompt=system_prompt,
                user_prompt="\n\n".join(prompt_parts),
                max_tokens=settings.pdf_max_tokens,
                timeout_seconds=settings.pdf_ocr_timeout_seconds,
                hint_tag="pdf_segment",
            )
        except PayloadTooLargeError:
            if len(batch) > 1:
                logger.warning(
                    "Segmentation batch of %d pages hit payload ceiling; splitting to 1-page calls",
                    len(batch),
                )
                for single in batch:
                    await _run_batch([single], hint_cap=min(hint_cap, 800))
                return
            if hint_cap > 0:
                await _run_batch(batch, hint_cap=0)
                return
            raise

        telemetry.add(call)
        page_entries = cast(list[dict[str, Any]], call.parsed_json.get("pages", []))
        resolved_nums = _resolve_batch_page_numbers(page_entries, batch)
        for entry, pno in zip(page_entries, resolved_nums, strict=False):
            raw_role = str(entry.get("role", "QUESTIONS"))
            role: PdfPageRole = (
                cast(PdfPageRole, raw_role)
                if raw_role in ("QUESTIONS", "MODEL_ANSWERS", "MIXED", "COVER_BLANK")
                else "QUESTIONS"
            )
            if pno:
                roles[pno] = role
            for qn in cast(list[Any], entry.get("questionNumbers", [])):
                if isinstance(qn, int):
                    q_found.add(qn)
            for an in cast(list[Any], entry.get("answerNumbers", [])):
                if isinstance(an, int):
                    a_found.add(an)

        for qn in cast(list[Any], call.parsed_json.get("questionNumbersFound", [])):
            if isinstance(qn, int):
                q_found.add(qn)
        for an in cast(list[Any], call.parsed_json.get("answerNumbersFound", [])):
            if isinstance(an, int):
                a_found.add(an)

    if provider.provider_name == "groq" or len(batches) <= 1:
        for batch in batches:
            await _run_batch(batch, hint_cap=initial_hint_cap)
    else:
        seg_sem = asyncio.Semaphore(3)

        async def _bounded_batch(b: list[PreprocessedPdfPage]) -> None:
            async with seg_sem:
                await _run_batch(b, hint_cap=initial_hint_cap)

        await asyncio.gather(*(_bounded_batch(b) for b in batches))

    return roles, sorted(q_found), sorted(a_found)


def _build_windows(
    pages: list[PreprocessedPdfPage],
    roles: dict[int, PdfPageRole],
    *,
    single_page_only: bool = False,
) -> list[list[PreprocessedPdfPage]]:
    active = [p for p in pages if roles.get(p.page_number, "QUESTIONS") != "COVER_BLANK"]
    if not active:
        return []
    if len(active) == 1 or single_page_only:
        return [[p] for p in active]
    windows: list[list[PreprocessedPdfPage]] = []
    if len(active) <= 3:
        for i in range(len(active) - 1):
            pair = [active[i], active[i + 1]]
            if len(pair[0].image_b64) + len(pair[1].image_b64) <= 2_800_000:
                windows.append(pair)
            else:
                windows.append([pair[0]])
                windows.append([pair[1]])
        return windows

    # For 4+ pages on high-capacity providers (Gemini/Anthropic), stitch 3-page stride-2 chunks
    idx = 0
    while idx < len(active):
        chunk = active[idx : idx + 3]
        while len(chunk) > 1 and sum(len(p.image_b64) for p in chunk) > 2_600_000:
            chunk = chunk[:-1]
        windows.append(chunk)
        if idx + len(chunk) >= len(active):
            break
        idx += max(1, len(chunk) - 1)
    return windows


async def _transcribe_windows(
    pages: list[PreprocessedPdfPage],
    roles: dict[int, PdfPageRole],
    *,
    primary: LLMProvider,
    secondary: LLMProvider | None,
    settings: Settings,
    telemetry: _TelemetryAccumulator,
) -> tuple[dict[int, dict[str, Any]], dict[int, bool]]:
    single_only = primary.provider_name == "groq"
    initial_hint_cap = 1000 if single_only else 2500
    windows = _build_windows(pages, roles, single_page_only=single_only)
    system_prompt = load_prompt(PROMPT_VERSION_PDF_OCR_WINDOW)
    page_by_num = {p.page_number: p for p in pages}
    best_blocks: dict[int, dict[str, Any]] = {}
    dual_agreed: dict[int, bool] = {p.page_number: True for p in pages}

    async def _run_window(window: list[PreprocessedPdfPage], *, hint_cap: int) -> None:
        prompt_sections = [
            f"[PAGE {p.page_number}] (Role hint: {roles.get(p.page_number, 'QUESTIONS')})\n"
            "Native text hint:\n"
            f"{(p.native_text[:hint_cap] if hint_cap > 0 else '') or '(omitted)'}"
            for p in window
        ]
        try:
            call = await primary.extract_json_with_images(
                processed_images=[(p.image_b64, p.mime_type) for p in window],
                system_prompt=system_prompt,
                user_prompt="\n\n".join(prompt_sections),
                max_tokens=settings.pdf_max_tokens,
                timeout_seconds=settings.pdf_ocr_timeout_seconds,
                hint_tag="pdf_ocr_window",
            )
        except PayloadTooLargeError:
            if len(window) > 1:
                logger.warning(
                    "OCR window of %d pages hit payload ceiling; splitting into single-page calls",
                    len(window),
                )
                for single in window:
                    await _run_window([single], hint_cap=min(hint_cap, 900))
                return
            if hint_cap > 0:
                await _run_window(window, hint_cap=0)
                return
            raise

        telemetry.add(call)
        blk_entries = cast(list[dict[str, Any]], call.parsed_json.get("blocks", []))
        resolved_nums = _resolve_batch_page_numbers(blk_entries, window)
        for blk, pno in zip(blk_entries, resolved_nums, strict=False):
            if not pno:
                continue
            blk["pageNumber"] = pno
            conf = float(blk.get("confidence", 0.9))
            prev = best_blocks.get(pno)
            if prev is None or conf > float(prev.get("confidence", 0.0)):
                best_blocks[pno] = blk

    if single_only or len(windows) <= 1:
        for window in windows:
            await _run_window(window, hint_cap=initial_hint_cap)
    else:
        win_sem = asyncio.Semaphore(3)

        async def _bounded_window(w: list[PreprocessedPdfPage]) -> None:
            async with win_sem:
                await _run_window(w, hint_cap=initial_hint_cap)

        await asyncio.gather(*(_bounded_window(w) for w in windows))

    # Cross-check low-confidence pages, [[UNSURE:]] markers, or native-text number divergences
    recheck_provider = secondary or primary
    recheck_tag = "pdf_ocr_recheck_secondary" if secondary is not None else "pdf_ocr_recheck"
    for pno, blk in list(best_blocks.items()):
        page_meta = page_by_num.get(pno)
        text = str(blk.get("text", ""))
        conf = float(blk.get("confidence", 0.9))
        text_disagrees = False
        if page_meta and page_meta.has_text_layer and not page_meta.has_equation_artifacts:
            native_nums = _significant_numbers(page_meta.native_text)
            ocr_nums = _significant_numbers(text)
            if native_nums and len(native_nums - ocr_nums) >= max(2, len(native_nums) // 2):
                text_disagrees = True
                blk["textLayerDisagreement"] = True

        needs_recheck = conf < 0.80 or "[[UNSURE:" in text or text_disagrees
        if needs_recheck and page_meta is not None:
            recheck_prompt = (
                f"[PAGE {pno}] Focused accuracy re-verification pass.\n"
                f"Previous transcription (confidence={conf:.2f}):\n{text[:1500]}\n"
                f"Native text hint:\n{page_meta.native_text[:1500] or '(none)'}"
            )
            used_secondary = secondary is not None
            re_call: RawProviderCall | None = None
            try:
                re_call = await recheck_provider.extract_json_with_images(
                    processed_images=[(page_meta.image_b64, page_meta.mime_type)],
                    system_prompt=system_prompt,
                    user_prompt=recheck_prompt,
                    max_tokens=settings.pdf_max_tokens,
                    timeout_seconds=settings.pdf_ocr_timeout_seconds,
                    hint_tag=recheck_tag,
                )
            except (ProviderUpstreamError, ProviderRequestError, CircuitOpenError) as exc:
                logger.warning(
                    "OCR recheck with '%s' on page %d failed (%s)",
                    recheck_provider.provider_name,
                    pno,
                    exc,
                )
                if used_secondary:
                    used_secondary = False
                    try:
                        re_call = await primary.extract_json_with_images(
                            processed_images=[(page_meta.image_b64, page_meta.mime_type)],
                            system_prompt=system_prompt,
                            user_prompt=recheck_prompt,
                            max_tokens=settings.pdf_max_tokens,
                            timeout_seconds=settings.pdf_ocr_timeout_seconds,
                            hint_tag="pdf_ocr_recheck",
                        )
                    except (
                        ProviderUpstreamError,
                        ProviderRequestError,
                        CircuitOpenError,
                    ) as inner_exc:
                        logger.warning(
                            "Primary fallback OCR recheck on page %d failed (%s); keeping OCR",
                            pno,
                            inner_exc,
                        )
                        re_call = None

            if re_call is None:
                continue
            telemetry.add(re_call)
            re_blocks = cast(list[dict[str, Any]], re_call.parsed_json.get("blocks", []))
            if re_blocks:
                re_blk = re_blocks[0]
                re_text = str(re_blk.get("text", ""))
                re_conf = float(re_blk.get("confidence", conf))
                if used_secondary:
                    # Check numeric agreement between primary and secondary readers
                    if _significant_numbers(text) != _significant_numbers(re_text):
                        dual_agreed[pno] = False
                if re_conf > conf and "[[UNSURE:" not in re_text:
                    re_blk["textLayerDisagreement"] = blk.get("textLayerDisagreement", False)
                    best_blocks[pno] = re_blk

    return best_blocks, dual_agreed


async def _verify_question_with_sympy(
    q: ExtractedQuestionOut,
    *,
    timeout_seconds: float,
) -> tuple[PdfSympyStatus, str, list[ExtractedQuestionWarningOut]]:
    warnings: list[ExtractedQuestionWarningOut] = []
    if q.type == "MCQ":
        opts = q.mcqOptions or []
        labels = {o.label for o in opts}
        correct_opts = [o for o in opts if o.isCorrect]
        if len(opts) != 4 or labels != {"A", "B", "C", "D"} or len(correct_opts) != 1:
            warnings.append(
                _warning(
                    "INVALID_MCQ_OPTIONS",
                    "error",
                    "MCQ must have exactly 4 options (A–D) with 1 correct option.",
                    "يجب أن يحتوي سؤال الاختيار من متعدد على ٤ خيارات (A–D) وإجابة صحيحة واحدة.",
                )
            )

        # Duplicate equivalent option detection
        for i in range(len(opts)):
            for j in range(i + 1, len(opts)):
                a = _strip_math_delimiters(opts[i].textLatex)
                b = _strip_math_delimiters(opts[j].textLatex)
                if not a or not b:
                    continue
                if a == b:
                    warnings.append(
                        _warning(
                            "DUPLICATE_MCQ_OPTIONS",
                            "warning",
                            f"Options {opts[i].label} and {opts[j].label} have identical values.",
                            f"الخياران {opts[i].label} و {opts[j].label} لهما نفس القيمة.",
                        )
                    )
                    break
                res = await asyncio.to_thread(
                    compare_expressions_in_sandbox, a, b, timeout_seconds=timeout_seconds
                )
                if res.equivalent is True:
                    warnings.append(
                        _warning(
                            "DUPLICATE_MCQ_OPTIONS",
                            "warning",
                            (
                                f"Options {opts[i].label} and {opts[j].label} are "
                                "mathematically equivalent."
                            ),
                            f"الخياران {opts[i].label} و {opts[j].label} متكافئان رياضياً.",
                        )
                    )
                    break

        # Cross-check marked correct option against worked modelAnswer if one was provided
        if q.modelAnswer and len(correct_opts) == 1:
            expected = q.modelAnswer.finalAnswerSympy or _strip_math_delimiters(
                q.modelAnswer.finalAnswerLatex
            )
            option_expr = _strip_math_delimiters(correct_opts[0].textLatex)
            if expected and option_expr:
                res = await asyncio.to_thread(
                    compare_expressions_in_sandbox,
                    expected,
                    option_expr,
                    timeout_seconds=timeout_seconds,
                )
                if res.equivalent is True:
                    return ("VERIFIED", res.detail, warnings)
                if res.equivalent is False:
                    warnings.append(
                        _warning(
                            "MCQ_ANSWER_CONFLICT",
                            "error",
                            (
                                f"Marked option {correct_opts[0].label} ({option_expr}) "
                                f"conflicts with worked answer ({expected})."
                            ),
                            (
                                f"الخيار المحدد {correct_opts[0].label} "
                                f"لا يتطابق مع ناتج الحل النموذجي ({expected})."
                            ),
                        )
                    )
                    return ("MISMATCH", res.detail, warnings)
                return ("UNPARSABLE", res.detail, warnings)
        return ("NOT_APPLICABLE", "", warnings)

    # ESSAY verification
    if not q.modelAnswer or not q.modelAnswer.finalAnswerLatex.strip():
        warnings.append(
            _warning(
                "UNMATCHED_QUESTION",
                "error",
                "Missing model answer for essay question.",
                "لم يتم العثور على إجابة نموذجية لهذا السؤال المقالي.",
            )
        )
        return ("NOT_APPLICABLE", "No model answer extracted", warnings)

    expected = q.modelAnswer.finalAnswerSympy or _strip_math_delimiters(
        q.modelAnswer.finalAnswerLatex
    )
    steps = [s for s in q.modelAnswer.solutionStepsLatex if s.strip()]
    if not expected or not steps:
        return ("NOT_APPLICABLE", "No final answer or steps to cross-check", warnings)

    last_rhs = _extract_rhs_candidate(steps[-1])
    res = await asyncio.to_thread(
        compare_expressions_in_sandbox, expected, last_rhs, timeout_seconds=timeout_seconds
    )
    if res.equivalent is True:
        return ("VERIFIED", res.detail, warnings)
    if res.equivalent is False and res.expectedFinalSympy and res.studentFinalSympy:
        warnings.append(
            _warning(
                "ANSWER_STEP_MISMATCH",
                "warning",
                (
                    f"Final answer ({expected}) differs mathematically from last solution "
                    f"step ({last_rhs})."
                ),
                (
                    f"الإجابة النهائية ({expected}) تختلف رياضياً عن آخر خطوة في الحل "
                    f"({last_rhs})."
                ),
            )
        )
        return ("MISMATCH", res.detail, warnings)
    warnings.append(
        _warning(
            "SYMPY_UNPARSABLE",
            "info",
            (
                "Symbolic verification could not parse all prose/expressions automatically; "
                "quick teacher check recommended."
            ),
            "تعذر التحقق الجبري التلقائي من التعبير؛ يُنصح بمراجعة سريعة من المعلم.",
        )
    )
    return ("UNPARSABLE", res.detail, warnings)


async def _extract_single_model(
    req: PdfExtractModelRequest,
    *,
    reference_questions: list[ReferenceTwinQuestion],
    primary: LLMProvider,
    secondary: LLMProvider | None,
    settings: Settings,
    telemetry: _TelemetryAccumulator,
) -> tuple[ExtractedModelOut, list[RenderedPageOut]]:
    preprocessed = preprocess_pdf_document(
        req.pdfBase64,
        max_pages=settings.pdf_max_pages,
        dpi=settings.pdf_render_dpi,
    )
    roles, q_found, a_found = await _segment_pages(
        preprocessed, provider=primary, settings=settings, telemetry=telemetry
    )
    blocks_by_page, dual_agreed = await _transcribe_windows(
        preprocessed,
        roles,
        primary=primary,
        secondary=secondary,
        settings=settings,
        telemetry=telemetry,
    )

    q_texts: list[str] = []
    a_texts: list[str] = []
    for p in preprocessed:
        blk = blocks_by_page.get(p.page_number)
        if not blk:
            continue
        role = roles.get(p.page_number, "QUESTIONS")
        header = f"[PAGE {p.page_number} | role={role}]\n{blk.get('text', '')}"
        if role in ("QUESTIONS", "MIXED"):
            q_texts.append(header)
        if role in ("MODEL_ANSWERS", "MIXED"):
            a_texts.append(header)

    def _compact_entries(entries: list[str], budget: int) -> str:
        if not entries:
            return "(none)"
        per_item = max(300, budget // len(entries))
        return "\n\n".join(item[:per_item] for item in entries)

    ref_json = json.dumps([r.model_dump() for r in reference_questions], ensure_ascii=False)
    struct_system = load_prompt(PROMPT_VERSION_PDF_STRUCTURE_PAIR)
    struct_prompt = (
        f"Exam Model Number: {req.modelNumber}\n"
        f"Reference Model 1 Questions (for conceptKey twin alignment):\n{ref_json}\n\n"
        f"=== TRANSCRIBED QUESTION PAGES ===\n" + ("\n\n".join(q_texts) or "(none)") + "\n\n"
        "=== TRANSCRIBED MODEL ANSWER PAGES ===\n" + ("\n\n".join(a_texts) or "(none)")
    )
    struct_max_tokens = (
        settings.pdf_max_tokens
        if primary.provider_name == "groq"
        else max(settings.pdf_max_tokens, 8192)
    )
    try:
        struct_call = await primary.extract_json_with_images(
            processed_images=[],
            system_prompt=struct_system,
            user_prompt=struct_prompt,
            max_tokens=struct_max_tokens,
            timeout_seconds=settings.pdf_ocr_timeout_seconds,
            hint_tag="pdf_structure_pair",
        )
    except PayloadTooLargeError:
        compact_ref = json.dumps(
            [{"conceptKey": r.conceptKey, "type": r.type} for r in reference_questions],
            ensure_ascii=False,
        )
        compact_prompt = (
            f"Exam Model Number: {req.modelNumber}\n"
            f"Reference Model 1 Concept Keys:\n{compact_ref[:2500]}\n\n"
            f"=== TRANSCRIBED QUESTION PAGES ===\n{_compact_entries(q_texts, 5500)}\n\n"
            f"=== TRANSCRIBED MODEL ANSWER PAGES ===\n{_compact_entries(a_texts, 5500)}"
        )
        struct_call = await primary.extract_json_with_images(
            processed_images=[],
            system_prompt=struct_system,
            user_prompt=compact_prompt,
            max_tokens=min(settings.pdf_max_tokens, 3000),
            timeout_seconds=settings.pdf_ocr_timeout_seconds,
            hint_tag="pdf_structure_pair",
        )
    telemetry.add(struct_call)

    raw_questions = cast(list[dict[str, Any]], struct_call.parsed_json.get("questions", []))
    unmatched_q = [
        int(n)
        for n in cast(list[Any], struct_call.parsed_json.get("unmatchedQuestionNumbers", []))
        if isinstance(n, int)
    ]
    unmatched_a = [
        int(n)
        for n in cast(list[Any], struct_call.parsed_json.get("unmatchedAnswerNumbers", []))
        if isinstance(n, int)
    ]

    questions_out: list[ExtractedQuestionOut] = []
    matched_count = 0
    for idx, rq in enumerate(raw_questions, start=1):
        q_type: Literal["MCQ", "ESSAY"] = (
            "MCQ" if str(rq.get("type", "ESSAY")).upper() == "MCQ" else "ESSAY"
        )
        points = max(0.5, float(rq.get("points", 2.0 if q_type == "MCQ" else 5.0)))
        src_q_pages = [
            int(p)
            for p in cast(list[Any], rq.get("sourceQuestionPages", []))
            if isinstance(p, int) and p >= 1
        ]
        src_a_pages = [
            int(p)
            for p in cast(list[Any], rq.get("sourceAnswerPages", []))
            if isinstance(p, int) and p >= 1
        ]

        page_confs = [
            float(blocks_by_page[p].get("confidence", 0.95))
            for p in src_q_pages + src_a_pages
            if p in blocks_by_page
        ]
        ocr_conf = float(rq.get("ocrConfidence", min(page_confs) if page_confs else 0.95))
        dual_ok = all(dual_agreed.get(p, True) for p in src_q_pages + src_a_pages)
        text_disagrees = any(
            bool(blocks_by_page.get(p, {}).get("textLayerDisagreement", False))
            for p in src_q_pages + src_a_pages
        )

        warnings: list[ExtractedQuestionWarningOut] = []
        if ocr_conf < 0.80:
            warnings.append(
                _warning(
                    "OCR_LOW_CONFIDENCE",
                    "warning",
                    f"Low OCR confidence ({int(ocr_conf * 100)}%) on one or more source pages.",
                    f"دقة القراءة البصرية منخفضة ({int(ocr_conf * 100)}%) في إحدى الصفحات المصدر.",
                )
            )
        if not dual_ok:
            warnings.append(
                _warning(
                    "OCR_DISAGREEMENT",
                    "warning",
                    (
                        "Secondary OCR verification differed on numeric tokens; "
                        "please inspect source page."
                    ),
                    "اختلف التحقق البصري الثانوي في بعض الأرقام؛ يرجى مراجعة الصفحة المصدر.",
                )
            )
        if text_disagrees:
            warnings.append(
                _warning(
                    "TEXT_LAYER_DISAGREEMENT",
                    "warning",
                    (
                        "PDF native text layer differed from visual OCR; "
                        "verify numbers/equations visually."
                    ),
                    "اختلف النص المدمج في الملف عن القراءة البصرية؛ يُنصح بمراجعة المعادلات بصرياً.",
                )
            )
        if bool(rq.get("pointsWereInferred", False)):
            warnings.append(
                _warning(
                    "DEFAULT_POINTS_ASSIGNED",
                    "info",
                    f"No explicit mark weight printed; default {points:g} pts assigned.",
                    f"لم تُطبع درجة محددة؛ تم تعيين {points:g} درجة افتراضياً.",
                )
            )

        mcq_opts: list[McqOptionOut] | None = None
        if q_type == "MCQ":
            raw_opts = cast(list[dict[str, Any]], rq.get("mcqOptions") or [])
            mcq_opts, mapped_ar = _normalize_mcq_options(raw_opts)
            if mapped_ar:
                warnings.append(
                    _warning(
                        "ARABIC_LABELS_MAPPED",
                        "info",
                        "Arabic option labels (أ/ب/ج/د) normalized to A–D.",
                        "تم تحويل حروف الخيارات العربية (أ/ب/ج/د) إلى A–D تلقائياً.",
                    )
                )

        raw_ma = cast(dict[str, Any] | None, rq.get("modelAnswer"))
        raw_mistakes = raw_ma.get("commonMistakes", "") if raw_ma is not None else ""
        common_mistakes = (
            "; ".join(str(item).strip() for item in raw_mistakes if str(item).strip())
            if isinstance(raw_mistakes, list)
            else str(raw_mistakes or "")
        )
        model_answer = (
            ModelAnswerOut(
                solutionStepsLatex=[
                    str(s) for s in cast(list[Any], raw_ma.get("solutionStepsLatex", []))
                ],
                finalAnswerLatex=str(raw_ma.get("finalAnswerLatex", "")),
                finalAnswerSympy=cast(str | None, raw_ma.get("finalAnswerSympy")),
                commonMistakes=common_mistakes,
            )
            if raw_ma is not None
            else None
        )

        rubric = (
            _normalize_rubric_criteria(
                cast(list[dict[str, Any]], rq.get("rubricCriteria") or []), points
            )
            if q_type == "ESSAY"
            else None
        )

        has_answer = (
            (len(src_a_pages) > 0)
            or (model_answer is not None)
            or (q_type == "MCQ" and any(o.isCorrect for o in (mcq_opts or [])))
        )
        if has_answer:
            matched_count += 1
        elif q_type == "MCQ":
            warnings.append(
                _warning(
                    "UNMATCHED_QUESTION",
                    "error",
                    "No model answer key matched this MCQ question.",
                    "لم يتم العثور على مفتاح إجابة لهذا السؤال.",
                )
            )

        q_out = ExtractedQuestionOut(
            tempId=str(uuid.uuid4()),
            orderIndex=int(rq.get("orderIndex", idx)),
            conceptKey=str(rq.get("conceptKey") or f"concept-{idx}")[:100],
            type=q_type,
            promptLatex=str(rq.get("promptLatex", "")).strip() or f"Question {idx}",
            points=points,
            solutionUrl=None,
            needsTeacherConfirmation=True,
            mcqOptions=mcq_opts,
            modelAnswer=model_answer if (q_type == "ESSAY" or model_answer is not None) else None,
            rubricCriteria=rubric,
            ocrConfidence=round(ocr_conf, 3),
            dualOcrAgreed=dual_ok,
            sympyStatus="NOT_APPLICABLE",
            sympyDetail="",
            sourceQuestionPages=src_q_pages,
            sourceAnswerPages=src_a_pages,
            warnings=warnings,
            verifiedByTeacher=False,
        )

        sympy_status, sympy_detail, sympy_warnings = await _verify_question_with_sympy(
            q_out, timeout_seconds=settings.ai_sympy_timeout_seconds
        )
        q_out.sympyStatus = sympy_status
        q_out.sympyDetail = sympy_detail
        q_out.warnings.extend(sympy_warnings)
        # Drop MCQ auxiliary worked answer once cross-check is recorded for strict persistence
        if q_out.type == "MCQ":
            q_out.modelAnswer = None

        has_flag = any(w.severity in ("warning", "error") for w in q_out.warnings)
        q_out.needsTeacherConfirmation = (
            has_flag or q_out.ocrConfidence < 0.85 or not q_out.dualOcrAgreed
        )
        questions_out.append(q_out)

    report_warnings: list[ExtractedQuestionWarningOut] = []
    q_count_total = len(q_found) if q_found else len(questions_out)
    a_count_total = len(a_found) if a_found else matched_count
    if unmatched_q or unmatched_a or (q_found and a_found and len(q_found) != len(a_found)):
        report_warnings.append(
            _warning(
                "COUNT_MISMATCH",
                "warning",
                (
                    f"Detected {q_count_total} questions vs {a_count_total} model answers; "
                    "verify unmatched items."
                ),
                (
                    f"تم رصد {q_count_total} سؤالاً مقابل {a_count_total} إجابة نموذجية؛ "
                    "يرجى مراجعة العناصر غير المتطابقة."
                ),
            )
        )

    page_metas = [
        PdfPageMetaOut(
            pageNumber=p.page_number,
            role=roles.get(p.page_number, "QUESTIONS"),
            hasTextLayer=p.has_text_layer,
            isBlank=p.is_blank,
        )
        for p in preprocessed
    ]
    rendered_pages = [
        RenderedPageOut(
            modelNumber=req.modelNumber,
            pageNumber=p.page_number,
            imageBase64=p.image_b64,
            role=roles.get(p.page_number, "QUESTIONS"),
            hasTextLayer=p.has_text_layer,
            isBlank=p.is_blank,
        )
        for p in preprocessed
    ]

    return (
        ExtractedModelOut(
            modelNumber=req.modelNumber,
            title=req.title,
            durationMinutes=req.durationMinutes,
            pageCount=len(preprocessed),
            pages=page_metas,
            questionsFoundCount=q_count_total,
            answersFoundCount=a_count_total,
            matchedCount=matched_count,
            unmatchedQuestionNumbers=unmatched_q,
            unmatchedAnswerNumbers=unmatched_a,
            reportWarnings=report_warnings,
            questions=questions_out,
        ),
        rendered_pages,
    )


def _build_twin_summary(
    models: list[ExtractedModelOut],
    reference_model1: list[ReferenceTwinQuestion],
) -> TwinSummaryOut:
    m1_keys = {q.conceptKey for m in models if m.modelNumber == 1 for q in m.questions}
    if not m1_keys and reference_model1:
        m1_keys = {r.conceptKey for r in reference_model1}
    m2_keys = {q.conceptKey for m in models if m.modelNumber == 2 for q in m.questions}
    return TwinSummaryOut(
        matchedConceptKeys=sorted(m1_keys & m2_keys),
        onlyInModel1=sorted(m1_keys - m2_keys),
        onlyInModel2=sorted(m2_keys - m1_keys),
    )


async def extract_exam_pdfs(
    request: ExtractExamPdfRequest,
    *,
    primary_provider: LLMProvider,
    secondary_provider: LLMProvider | None,
    settings: Settings,
) -> ExtractExamPdfResponse:
    """Orchestrate 4-stage OCR + AI + SymPy extraction for Pre and/or Post exam PDFs."""
    start = time.perf_counter()
    telemetry = _TelemetryAccumulator(
        provider=primary_provider.provider_name,
        secondary=secondary_provider.provider_name if secondary_provider else None,
    )
    models_out: list[ExtractedModelOut] = []
    all_rendered: list[RenderedPageOut] = []
    twin_ref = list(request.referenceModel1Questions)

    if request.preModel is not None:
        m1_out, m1_pages = await _extract_single_model(
            request.preModel,
            reference_questions=[],
            primary=primary_provider,
            secondary=secondary_provider,
            settings=settings,
            telemetry=telemetry,
        )
        models_out.append(m1_out)
        all_rendered.extend(m1_pages)
        twin_ref = [
            ReferenceTwinQuestion(conceptKey=q.conceptKey, promptLatex=q.promptLatex, type=q.type)
            for q in m1_out.questions
        ]

    if request.postModel is not None:
        m2_out, m2_pages = await _extract_single_model(
            request.postModel,
            reference_questions=twin_ref,
            primary=primary_provider,
            secondary=secondary_provider,
            settings=settings,
            telemetry=telemetry,
        )
        models_out.append(m2_out)
        all_rendered.extend(m2_pages)

    latency_ms = max(1, int((time.perf_counter() - start) * 1000))
    return ExtractExamPdfResponse(
        models=models_out,
        renderedPages=all_rendered,
        twinSummary=_build_twin_summary(models_out, request.referenceModel1Questions),
        telemetry=PdfExtractionTelemetryOut(
            provider=telemetry.provider,
            secondaryProvider=telemetry.secondary,
            totalInputTokens=telemetry.input_tokens,
            totalOutputTokens=telemetry.output_tokens,
            totalCostUsd=round(telemetry.cost_usd, 6),
            latencyMs=latency_ms,
        ),
    )
