# MathLens System Architecture

## 1. Service Topology

```mermaid
flowchart LR
  Browser["Browser (Arabic RTL React + KaTeX SPA)"] -->|"HTTP / Cookies"| Nginx["Nginx Reverse Proxy (:8080)"]
  Nginx -->|"Static Assets"| SPA["React Vite Dist"]
  Nginx -->|"/api/v1/*"| API["Node 20 Express API (:4000)"]
  API -->|"SQL / Prisma"| PG[("PostgreSQL 16")]
  API -->|"Rate Limit & Queues"| Redis[("Redis 7")]
  API -->|"Put / Presign / Delete"| S3[("MinIO / S3 Bucket")]
  Worker["BullMQ Grading & Retention Worker"] -->|"Pop Jobs"| Redis
  Worker -->|"Read & Update Results"| PG
  Worker -->|"Fetch / Delete Images"| S3
  Worker -->|"X-Internal-Key POST /v1/grade/essay"| AI["Python 3.11 FastAPI AI Service (:8000)"]
  API -->|"X-Internal-Key POST /v1/stats/*"| AI
  AI -->|"Multimodal Vision / Rubric Grading"| LLM["Anthropic / Groq / Fake Provider"]
  AI -->|"Subprocess Isolated parse_latex"| SymPy["SymPy Lark Sandbox"]
```

## 2. Student Learning & Evaluation State Machine

```mermaid
stateDiagram-v2
  [*] --> JOIN: Enter cohort joinCode & displayName
  JOIN --> CONSENT: Receive 6-char resumeCode
  CONSENT --> PRETEST_IN_PROGRESS: Accept privacy notice
  PRETEST_IN_PROGRESS --> PRETEST_SUBMITTED: Idempotent submit
  PRETEST_SUBMITTED --> PRETEST_GRADING: MCQ scored + Essays queued
  PRETEST_GRADING --> PRETEST_RESULTS: Essays reach GRADED / NEEDS_REVIEW / FINAL
  PRETEST_RESULTS --> REMEDIATION: Treatment cohort required to watch video
  PRETEST_RESULTS --> POSTTEST_UNLOCKED: Control cohort past postTestOpensAt / teacher opened
  REMEDIATION --> POSTTEST_UNLOCKED: Server-verified watchedSeconds >= minWatchSeconds
  POSTTEST_UNLOCKED --> POSTTEST_IN_PROGRESS: Start Model 2
  POSTTEST_IN_PROGRESS --> POSTTEST_GRADING: Submit Model 2
  POSTTEST_GRADING --> COMPARISON: Compute Pre vs Post & Hake <g>
```

## 3. Asynchronous Reference-Based Essay Grading Pipeline

```mermaid
sequenceDiagram
  participant Student as "Student Phone"
  participant API as "Node API"
  participant S3 as "MinIO / S3"
  participant Worker as "BullMQ Worker"
  participant AI as "FastAPI AI Service"
  participant DB as "PostgreSQL"

  Student->>API: PUT image (multipart)
  API->>API: Magic bytes + virus scan hook + sharp EXIF strip (max 1600px JPEG)
  API->>S3: Put sanitized image
  Student->>API: POST /attempts/:id/submit
  API->>DB: Grade MCQs synchronously
  API->>Worker: Enqueue mathlens-grading job per essay
  Worker->>S3: Fetch sanitized JPEG(s)
  Worker->>AI: POST /v1/grade/essay (rubric + modelAnswer + image)
  AI->>AI: OpenCV deskew, crop & Laplacian blur gate
  AI->>AI: Transcribe steps + Detect injection/unsure tokens
  AI->>AI: Grade against rubric inside UNTRUSTED_STUDENT_WORK boundary
  AI->>AI: SymPy Lark subprocess equivalence check (3s timeout, no eval)
  AI->>AI: Server score guard (clamp per criterion & recompute total)
  AI-->>Worker: Structured grading JSON + needsReview + confidence
  Worker->>DB: Persist GradingResult (recompute score & cap) + AiUsage
```

## 4. Security, Privacy & Statistical Safeguards

- **Prompt Injection Defense**: Student handwriting is treated strictly as untrusted data wrapped in `<UNTRUSTED_STUDENT_WORK>...</UNTRUSTED_STUDENT_WORK>`, scanned for override phrases (`detect_prompt_injection`), and NEVER trusted to compute final numeric scores (`score_guard.py` + `GradingOrchestrator` recompute totals from clamped rubric criteria).
- **Eval-Free Math Parsing**: Student and teacher LaTeX expressions pass through `sympy.parsing.latex.parse_latex(..., backend="lark")` inside an isolated subprocess with a character whitelist and 3-second timeout (no Python `eval()`).
- **Minors Privacy & Retention**: Only a `displayName` and random unambiguous `resumeCode` are collected (no emails, phones, or analytics pixels for students). Uploaded images have EXIF/GPS metadata stripped via `sharp`, can be erased immediately via `DELETE /api/v1/student/data` or `DELETE /api/v1/cohorts/:id/data`, and non-pinned images older than `RETENTION_DAYS` after `FINAL` are purged nightly at 02:00 UTC by the BullMQ retention worker.
- **Anti-Cheat Video Gate**: `VideoService` merges client heartbeat playback intervals `[start, end]` on the server while rejecting forward seek jumps (`delta > 15s`), background tab intervals (`tabVisible=false`), and speeds above `1.5x`.
- **Statistical Engine & Export Safety**: `services/ai/app/routes_stats.py` computes paired tests (Shapiro-Wilk, paired _t_, Wilcoxon signed-rank, Cohen's _d_z_ + bootstrap 95% CI, Hake `<g>`, IQR outliers), between-group tests (Welch's _t_, Mann-Whitney _U_, Hedges' _g_ + CI, OLS Difference-in-Differences with student-clustered SEs), per-concept exact McNemar with Holm-Bonferroni correction, and AI reliability metrics. CSV/XLSX exports include UTF-8 BOM and neutralize leading formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
