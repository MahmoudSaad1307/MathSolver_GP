# MathLens Design Decisions & Assumptions

This document records every design decision and default chosen where the Master Build Prompt left details open.

## 1. Existing Repository Prototype (`legacy/mathcheck`)

- **Archive location**: The pre-existing MathCheck Streamlit prototype (`mathcheck/`, `conftest.py`, `requirements.txt`, `README.md`) was moved to `/legacy/mathcheck/` and excluded from CI and workspaces so the MathLens monorepo lives cleanly at the repository root as specified in Section 3.
- **Reused ideas and code**:
  - `verify.py` (`_numeric_sample_compare`, `_compare_equations`) forms the basis of the SymPy symbolic equivalence cross-checker in `services/ai`.
  - `ocr.py` preprocessing and uncertainty/disagreement flagging informs `services/ai` image preprocessing and quality gate heuristics.
  - `client.py` Groq integration informs an optional `GroqProvider` alongside the default `AnthropicProvider` and test `FakeProvider`.
  - `parsing.py`'s `parse_expr` is **not** reused on student text because SymPy `parse_expr` invokes Python `eval` internally, violating Section 19. Instead, student and teacher expressions are parsed via `parse_latex` (Lark backend) inside an isolated subprocess with a strict character whitelist and 3-second timeout.
- **Not reused**: Streamlit UI (`app.py`), problem-solving loops (`solve.py`), and calculator modes (`simple_modes.py`), because MathLens strictly requires reference-based grading rather than solving problems independently.

## 2. Environment & Tooling Defaults

- **AI provider**: `AI_PROVIDER=anthropic` is the default in `.env.example` and application defaults per Section 8.2, with `GroqProvider` (`AI_PROVIDER=groq`) and `FakeProvider` (`AI_PROVIDER=fake`) implemented behind the same `LLMProvider` protocol.
- **Node & Docker base images**: Dockerfiles for `apps/api` and worker use `node:20-bookworm-slim` (instead of Alpine) because `sharp` prebuilt binaries with libvips + HEIC (`libheif`) support run reliably on Debian glibc without compiling native C++ deps.
- **Python runtime**: `services/ai` targets Python 3.11 in Docker and CI (`python:3.11-slim`), compatible with Python 3.12 locally.
- **Queue worker topology**: The BullMQ grading and retention worker runs as a dedicated `worker` container built from the same `apps/api` image (`node dist/worker.js`), sharing Prisma and domain logic cleanly without blocking HTTP requests.

## 3. Data Model & State Machine Additions

- **`RefreshToken` table**: Added to Prisma schema (hashed opaque token + `familyId` + `revokedAt` + `replacedById`) to support Section 7 rotating refresh tokens and "logout everywhere" revocation.
- **`VideoAlert` table**: Added to record YouTube player errors (`100`, `101`, `150`, etc.) reported by students so teachers see actionable alerts in the dashboard (Section 9).
- **Cohort flags**: Added `requireWrongSegmentVisits` (default `false`) and `showProvisionalScore` (default `false`) to `Cohort` so teachers can toggle optional behaviors described in Sections 8.3 and 9.
- **Topic `correctnessThreshold`**: Added `correctnessThreshold` (Float, default `0.60`) to `Topic` so McNemar per-question pass thresholds are configurable per Section 7.
- **Image pinning**: Added `pinnedByTeacher` (Boolean, default `false`) to `AnswerImage` so the retention job skips pinned images per Section 11.
- **Resume & join codes**: 6 characters drawn from the 31-character unambiguous uppercase alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (excludes `0`, `O`, `1`, `I`, and `L` for handwriting/print clarity; wait — let's verify exact 31 chars: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` is 8 digits + 23 letters = 31 chars! That leaves out `0, 1, I, O` and `L` or let's verify: 26 letters minus I,O,L = 23 + 8 digits (2..9) = 31!).
- **Exam state machine**:
  - `POSTTEST_UNLOCKED` is allowed when Pre-Test `Attempt.status` is `FINAL` (or `GRADED` when no answer has `needsReview = true`) AND either `cohort.group == CONTROL` (with `postTestOpensAt` reached or teacher `open-posttest` triggered) OR `VideoSession.unlockedPostAt != null`.
  - Submitting an exam moves `Attempt.status` to `SUBMITTED`, grades MCQs synchronously, and sets status to `FINAL` immediately if zero essays exist; otherwise essay jobs are queued (`GRADING`). When all essay jobs complete, attempts transition to `FINAL` when zero answers require review, or `NEEDS_REVIEW` until a teacher submits overrides or approves remaining flags.
- **Grace period on deadline**: Server accepts submissions up to 30 seconds after `deadlineAt` to account for mobile network latency on auto-submit, and auto-submits expired `IN_PROGRESS` attempts on access.

## 4. Security, Privacy & Grading Rules

- **Image pipeline separation**: Node (`apps/api`) validates magic bytes (`file-type`), enforces 8 MB and 2-image limits, runs the virus-scan hook (`NoopVirusScanner` by default, `ClamAV` TCP scanner optional), and re-encodes via `sharp` (auto-orient, resize ≤ 1600 px, strip EXIF/GPS, JPEG output) before uploading to S3/MinIO. Python (`services/ai`) runs quality preprocessing (deskew, margin crop, CLAHE, blur rejection).
- **Teacher ownership isolation**: Every teacher endpoint uses explicit `ownerId` / `teacherId` scoping so one teacher can never read or modify another teacher's topics, exams, cohorts, overrides, analytics, or exports.
- **Student session cookie**: Signed `httpOnly` JWT bound to `{ studentId, cohortId, type: 'student' }`, 12-hour TTL, `SameSite=Lax`.
- **Privacy erasure & nightly retention**: In addition to nightly cleanup at 02:00 UTC (`RETENTION_DAYS` after `FINAL`, respecting `pinnedByTeacher`), students can erase their own images and display name via `DELETE /api/v1/student/data`, and teachers can erase cohort student data via `DELETE /api/v1/cohorts/:id/data`.
- **Statistical fallback & spreadsheet safety**: When the Python statistical service is temporarily offline, `/api/v1/analytics` continues serving descriptive summaries, McNemar counts, and reliability pairs while surfacing warnings rather than failing the dashboard. CSV and XLSX exports neutralize formula-injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
- **Synthetic evaluation set**: Because no minors' handwriting may be stored in version control, `services/ai/eval/` generates deterministic synthetic handwritten-style PNG fixtures rendered with a cursive/handwriting font plus mild noise/skew and labeled ground-truth scores.
