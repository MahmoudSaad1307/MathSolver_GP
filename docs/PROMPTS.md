# MathLens AI Grading Prompts & Reproducibility Registry

## Prompt Versioning Policy

Every `GradingResult` row stored in PostgreSQL records:
- `provider`: `anthropic` | `groq` | `fake`
- `modelName`: exact model ID used for grading/transcription
- `promptVersion`: combined version tag (`transcribe.v1+grade.v1`)
- `rubricVersion`: integer counter incremented whenever rubric criteria change
- `imageHash`: SHA-256 digest of preprocessed grayscale/CLAHE image(s)
- `rawOutput`: verbatim JSON output from transcription and grading steps

Prompt files live alongside code in `services/ai/app/prompts/` and are never mutated in place after release; edits require creating `*.v2.md` and bumping the active version constant.

## Active Prompts

### 1. `transcribe.v1` (`services/ai/app/prompts/transcribe.v1.md`)
- **Role**: Transcribe student handwritten steps chronologically from top to bottom.
- **Anti-Injection**: Student handwriting is treated strictly as untrusted image data. Any instructions telling the model to override scores, skip checks, or ignore prompts are transcribed literally (flagged downstream by `detect_prompt_injection`) and never obeyed.
- **Uncertainty Tokens**: Ambiguous digits/symbols must be wrapped in `[[UNSURE:...]]`; unreadable lines emit `"[[ILLEGIBLE]]"`.

### 2. `grade.v1` (`services/ai/app/prompts/grade.v1.md`)
- **Role**: Reference-based rubric comparison ONLY. The LLM receives the teacher's `modelAnswer` (`solutionStepsLatex`, `finalAnswerLatex`, `commonMistakes`), `rubricCriteria`, and student steps wrapped inside `<UNTRUSTED_STUDENT_WORK>...</UNTRUSTED_STUDENT_WORK>`.
- **Error Taxonomy**: `none`, `sign`, `arithmetic`, `algebra`, `rule_misuse`, `concept`, `domain`, `notation`, `incomplete`, `other`.
- **Feedback Language**: Simple, encouraging Arabic (`errorExplanationAr`, `hintAr`) referencing the first invalid step number (`firstErrorStep`).
- **Arithmetic Authority**: The LLM's `claimedTotal` is **never trusted**. Both `services/ai/app/checks/score_guard.py` and `apps/api/src/services/gradingOrchestrator.ts` recompute `aiTotal` from clamped per-criterion points (`0 <= pts <= criterion.maxPoints`).

## SymPy Cross-Check & Quality Gate

1. **SymPy Lark Sandbox** (`services/ai/app/checks/sympy_sandbox.py`): Runs `sympy.parsing.latex.parse_latex(..., backend="lark")` inside an isolated child process guarded by an input character whitelist + 3.0s evaluation timeout (no `eval()` / no `parse_expr()`). Equivalence is confirmed algebraically (`simplify(a - b) == 0`) or across 14 deterministic rational sample points avoiding poles.
2. **Human Review Triggers** (`ReviewReason`):
   - `EMPTY_SUBMISSION`
   - `LOW_CONFIDENCE` (`confidence < AI_MIN_CONFIDENCE`, default `0.75`)
   - `UNSURE_EVIDENCE_TOKEN` (`[[UNSURE:...]]` present)
   - `HIGH_ILLEGIBLE_RATIO` (blurry image Laplacian variance `< 45` or illegible lines `> 20%`)
   - `INJECTION_ATTEMPT`
   - `SCHEMA_RETRY_USED`
   - `TOTAL_MISMATCH`
   - `SYMPY_MISMATCH`
   - `STEP_CHECK_MISMATCH`
   - `STUDENT_REPORTED_MISREAD`
   - `AI_SERVICE_FAILED`

## Swapping Providers

Set `AI_PROVIDER` in `.env` (restart `ai` service only; no Node API or frontend changes needed):
- `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY=...` (default production setting)
- `AI_PROVIDER=groq` + `GROQ_API_KEY=...` (Llama 4 Scout multimodal fallback/testing)
- `AI_PROVIDER=fake` (deterministic local testing & CI)
