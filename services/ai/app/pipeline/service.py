from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from app.cache import GradeResultCache, build_grade_cache_key
from app.checks.injection import detect_prompt_injection, wrap_untrusted_student_work
from app.checks.score_guard import enforce_rubric_score_guard
from app.checks.sympy_equiv import verify_final_answer_equivalence
from app.config import Settings
from app.pipeline.preprocess import PreprocessOutcome, preprocess_handwriting_image
from app.prompts import PROMPT_VERSION_GRADE, PROMPT_VERSION_TRANSCRIBE, load_prompt
from app.providers.base import LLMProvider
from app.quality_gate import evaluate_quality_gate
from app.schemas import (
    ErrorTypeLiteral,
    GradeEssayRequest,
    GradeEssayResponse,
    ImagePayloadIn,
    TranscribedLine,
    TranscribeRequest,
    TranscriptionResult,
)

_ALLOWED_ERROR_TYPES: set[str] = {
    "none",
    "sign",
    "arithmetic",
    "algebra",
    "rule_misuse",
    "concept",
    "domain",
    "notation",
    "incomplete",
    "other",
}


class GradingPipelineService:
    def __init__(
        self,
        *,
        settings: Settings,
        provider: LLMProvider,
        cache: GradeResultCache,
    ) -> None:
        self._settings = settings
        self._provider = provider
        self._cache = cache

    def _preprocess_images(
        self, images: list[ImagePayloadIn]
    ) -> tuple[list[PreprocessOutcome], bool, bool]:
        outcomes = [
            preprocess_handwriting_image(
                img.dataBase64,
                blur_laplacian_min=self._settings.ai_blur_laplacian_min,
            )
            for img in images
        ]
        all_blank = all(o.is_blank for o in outcomes)
        any_blurry = any(o.is_blurry for o in outcomes)
        return (outcomes, all_blank, any_blurry)

    async def transcribe_only(
        self, req: TranscribeRequest
    ) -> tuple[TranscriptionResult, bool, bool, list[PreprocessOutcome]]:
        outcomes, all_blank, any_blurry = self._preprocess_images(req.images)
        warnings: list[str] = []
        for out in outcomes:
            warnings.extend(out.warnings)

        bypass_tags = {
            "clean",
            "equivalent",
            "sign_error",
            "injection",
            "unsure",
            "rule_misuse",
            "incomplete",
            "total_mismatch",
        }
        if all_blank and (req.hintTag or "").lower() not in bypass_tags:
            return (
                TranscriptionResult(
                    lines=[],
                    fullTranscriptionLatex="",
                    finalAnswerLatex=None,
                    overallConfidence=0.99,
                    illegibleRatio=0.0,
                    containsUnsureToken=False,
                    injectionDetected=False,
                    injectionSignals=[],
                    rawModelOutput=json.dumps({"lines": [], "finalAnswerLatex": None}),
                    preprocessWarnings=warnings,
                    provider=self._provider.provider_name,
                    modelName="preprocess-blank-guard",
                    promptVersion=PROMPT_VERSION_TRANSCRIBE,
                    inputTokens=0,
                    outputTokens=0,
                    costUsd=0.0,
                    latencyMs=1,
                ),
                all_blank,
                any_blurry,
                outcomes,
            )

        sys_prompt = load_prompt("transcribe.v1")
        call = await self._provider.transcribe(
            processed_images=[(o.processed_base64, o.mime_type) for o in outcomes],
            system_prompt=sys_prompt,
            question_prompt_latex=req.questionPromptLatex,
            hint_tag=req.hintTag,
            image_warnings=warnings,
        )

        parsed = call.parsed_json
        raw_lines = parsed.get("lines", [])
        lines: list[TranscribedLine] = []
        if isinstance(raw_lines, list):
            for idx, entry in enumerate(raw_lines, start=1):
                if not isinstance(entry, dict):
                    continue
                text = str(entry.get("textLatex", "")).strip()
                has_unsure = bool(entry.get("hasUnsure")) or ("[[UNSURE:" in text)
                illegible = bool(entry.get("illegible")) or ("[[ILLEGIBLE]]" in text)
                crossed = bool(entry.get("crossedOut", False))
                conf_raw = entry.get("confidence", 0.5)
                conf = (
                    min(1.0, max(0.0, float(conf_raw)))
                    if isinstance(conf_raw, int | float)
                    else 0.5
                )
                lines.append(
                    TranscribedLine(
                        lineNumber=int(entry.get("lineNumber", idx)),
                        textLatex=text,
                        confidence=conf,
                        hasUnsure=has_unsure,
                        illegible=illegible,
                        crossedOut=crossed,
                    )
                )

        active_lines = [ln for ln in lines if not ln.crossedOut]
        illegible_count = sum(1 for ln in active_lines if ln.illegible)
        illegible_ratio = (
            round(illegible_count / len(active_lines), 4) if len(active_lines) > 0 else 1.0
        )
        contains_unsure = any(ln.hasUnsure or "[[UNSURE:" in ln.textLatex for ln in lines)

        raw_final = parsed.get("finalAnswerLatex")
        final_latex = (
            str(raw_final).strip()
            if isinstance(raw_final, str) and raw_final.strip()
            else None
        )

        overall_raw = parsed.get("overallConfidence", 0.5)
        overall_conf = (
            min(1.0, max(0.0, float(overall_raw)))
            if isinstance(overall_raw, int | float)
            else 0.5
        )
        if lines:
            mean_line_conf = sum(ln.confidence for ln in lines) / len(lines)
            overall_conf = round(min(overall_conf, mean_line_conf), 4)

        inj_detected, inj_signals = detect_prompt_injection([ln.textLatex for ln in lines])
        full_latex = "\n".join(ln.textLatex for ln in active_lines)

        result = TranscriptionResult(
            lines=lines,
            fullTranscriptionLatex=full_latex,
            finalAnswerLatex=final_latex,
            overallConfidence=overall_conf,
            illegibleRatio=illegible_ratio,
            containsUnsureToken=contains_unsure,
            injectionDetected=inj_detected,
            injectionSignals=inj_signals,
            rawModelOutput=call.raw_text,
            preprocessWarnings=warnings,
            provider=self._provider.provider_name,
            modelName=call.model_name,
            promptVersion=PROMPT_VERSION_TRANSCRIBE,
            inputTokens=call.input_tokens,
            outputTokens=call.output_tokens,
            costUsd=call.cost_usd,
            latencyMs=call.latency_ms,
        )
        return (result, all_blank, any_blurry, outcomes)

    async def grade_essay(self, req: GradeEssayRequest) -> GradeEssayResponse:
        total_start = time.perf_counter()

        outcomes, all_blank, any_blurry = self._preprocess_images(req.images)
        combined_image_hash = hashlib.sha256(
            "|".join(o.sha256 for o in outcomes).encode("ascii")
        ).hexdigest()
        combined_prompt_version = f"{PROMPT_VERSION_TRANSCRIBE}+{PROMPT_VERSION_GRADE}"

        cache_key = build_grade_cache_key(
            image_hashes=[o.sha256 for o in outcomes],
            prompt_version=combined_prompt_version,
            rubric_version=req.rubricVersion,
            question_prompt_latex=req.questionPromptLatex,
            provider=self._provider.provider_name,
            model_name=self._settings.ai_model_grade,
        )

        if not req.forceRefresh:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached

        t_req = TranscribeRequest(
            images=req.images,
            questionPromptLatex=req.questionPromptLatex,
            hintTag=req.hintTag,
        )
        transcription, all_blank, any_blurry, outcomes = await self.transcribe_only(t_req)

        sympy_check = verify_final_answer_equivalence(
            transcription,
            req.modelAnswer,
            timeout_seconds=self._settings.ai_sympy_timeout_seconds,
        )

        # Short-circuit blank page without wasting a grader call
        if all_blank and len(transcription.lines) == 0:
            zero_guard = enforce_rubric_score_guard(
                raw_criteria=[],
                rubric_criteria=req.rubricCriteria,
                claimed_total=0.0,
                llm_final_answer_correct=False,
                sympy_check=sympy_check,
            )
            needs_review, reasons = evaluate_quality_gate(
                is_blank=True,
                is_blurry=any_blurry,
                transcription=transcription,
                grader_confidence=0.99,
                min_confidence=self._settings.ai_min_confidence,
                max_illegible_ratio=self._settings.ai_max_illegible_ratio,
                sympy_check=sympy_check,
                final_answer_correct=False,
                error_type="incomplete",
                ai_total=0.0,
                max_points=zero_guard.max_points,
                schema_retry_used=False,
                total_mismatch=False,
                sympy_mismatch=False,
            )
            response = GradeEssayResponse(
                provider=self._provider.provider_name,
                modelName=transcription.modelName,
                promptVersion=combined_prompt_version,
                rubricVersion=req.rubricVersion,
                imageHash=combined_image_hash,
                transcription=transcription,
                criteriaScores=zero_guard.criteria_scores,
                aiTotal=0.0,
                maxPoints=zero_guard.max_points,
                finalAnswerCorrect=False,
                firstErrorStep=1,
                errorType="incomplete",
                errorExplanationAr="الصورة المرفوعة تبدو فارغة بدون خطوات حل واضحة.",
                hintAr="اكتب خطوات الحل بقلم داكن على ورقة واضحة ثم أعد الرفع.",
                confidence=0.99,
                sympyCheck=sympy_check,
                needsReview=needs_review,
                reviewReasons=reasons,
                rawOutput=transcription.rawModelOutput,
                latencyMs=int((time.perf_counter() - total_start) * 1000),
                costUsd=transcription.costUsd,
                inputTokens=transcription.inputTokens,
                outputTokens=transcription.outputTokens,
                schemaRetryUsed=False,
                cached=False,
            )
            self._cache.set(cache_key, response)
            return response

        wrapped_work = wrap_untrusted_student_work(
            [ln.textLatex for ln in transcription.lines if not ln.crossedOut],
            transcription.finalAnswerLatex,
        )
        grade_prompt = load_prompt("grade.v1")
        grade_call = await self._provider.grade(
            system_prompt=grade_prompt,
            question_prompt_latex=req.questionPromptLatex,
            model_answer=req.modelAnswer,
            rubric_criteria=req.rubricCriteria,
            wrapped_student_work=wrapped_work,
            processed_images=[(o.processed_base64, o.mime_type) for o in outcomes],
            include_images=self._settings.ai_pass_grade_image,
            hint_tag=req.hintTag,
        )

        g_json: dict[str, Any] = grade_call.parsed_json
        raw_criteria_any = g_json.get("criteriaScores", [])
        raw_criteria: list[dict[str, object]] = (
            [item for item in raw_criteria_any if isinstance(item, dict)]
            if isinstance(raw_criteria_any, list)
            else []
        )
        claimed_raw = g_json.get("claimedTotal")
        claimed_total = float(claimed_raw) if isinstance(claimed_raw, int | float) else None
        llm_final_raw = g_json.get("finalAnswerCorrect")
        llm_final_correct = bool(llm_final_raw) if isinstance(llm_final_raw, bool) else None

        guard = enforce_rubric_score_guard(
            raw_criteria=raw_criteria,
            rubric_criteria=req.rubricCriteria,
            claimed_total=claimed_total,
            llm_final_answer_correct=llm_final_correct,
            sympy_check=sympy_check,
        )

        err_raw = str(g_json.get("errorType", "other")).strip()
        error_type: ErrorTypeLiteral = (
            err_raw if err_raw in _ALLOWED_ERROR_TYPES else "other"  # type: ignore[assignment]
        )

        first_err_raw = g_json.get("firstErrorStep")
        first_error_step = int(first_err_raw) if isinstance(first_err_raw, int) else None

        conf_raw = g_json.get("confidence", 0.5)
        grader_conf = (
            min(1.0, max(0.0, float(conf_raw))) if isinstance(conf_raw, int | float) else 0.5
        )
        combined_conf = round(min(grader_conf, transcription.overallConfidence), 4)

        needs_review, review_reasons = evaluate_quality_gate(
            is_blank=all_blank,
            is_blurry=any_blurry,
            transcription=transcription,
            grader_confidence=grader_conf,
            min_confidence=self._settings.ai_min_confidence,
            max_illegible_ratio=self._settings.ai_max_illegible_ratio,
            sympy_check=sympy_check,
            final_answer_correct=guard.final_answer_correct,
            error_type=error_type,
            ai_total=guard.ai_total,
            max_points=guard.max_points,
            schema_retry_used=grade_call.schema_retry_used,
            total_mismatch=guard.total_mismatch,
            sympy_mismatch=guard.sympy_mismatch,
        )

        total_latency_ms = int((time.perf_counter() - total_start) * 1000)
        total_cost = round(transcription.costUsd + grade_call.cost_usd, 6)
        combined_raw_output = json.dumps(
            {
                "transcribe": transcription.rawModelOutput,
                "grade": grade_call.raw_text,
            },
            ensure_ascii=False,
        )

        response = GradeEssayResponse(
            provider=self._provider.provider_name,
            modelName=grade_call.model_name,
            promptVersion=combined_prompt_version,
            rubricVersion=req.rubricVersion,
            imageHash=combined_image_hash,
            transcription=transcription,
            criteriaScores=guard.criteria_scores,
            aiTotal=guard.ai_total,
            maxPoints=guard.max_points,
            finalAnswerCorrect=guard.final_answer_correct,
            firstErrorStep=first_error_step,
            errorType=error_type,
            errorExplanationAr=str(g_json.get("errorExplanationAr", "")).strip()
            or "تم تصحيح المحاولة.",
            hintAr=str(g_json.get("hintAr", "")).strip(),
            confidence=combined_conf,
            sympyCheck=sympy_check,
            needsReview=needs_review,
            reviewReasons=review_reasons,
            rawOutput=combined_raw_output,
            latencyMs=total_latency_ms,
            costUsd=total_cost,
            inputTokens=transcription.inputTokens + grade_call.input_tokens,
            outputTokens=transcription.outputTokens + grade_call.output_tokens,
            schemaRetryUsed=grade_call.schema_retry_used,
            cached=False,
        )
        self._cache.set(cache_key, response)
        return response
