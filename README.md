# MathLens | عدسة الرياضيات

AI-Graded Handwritten Math Exams with Video Remediation (`pre-test → remediation video → post-test`).

## Quick Start (Docker Compose)

1. Copy `.env.example` to `.env` and set your secrets and AI provider keys (`ANTHROPIC_API_KEY` or `GROQ_API_KEY`, or `AI_PROVIDER=fake` for local dry runs):
   ```bash
   cp .env.example .env
   ```
2. Build and start PostgreSQL, Redis, MinIO, AI service, API, BullMQ worker, and Nginx web frontend:
   ```bash
   docker compose -f infra/docker-compose.yml up --build -d
   ```
3. Run database migrations and seed the default teacher + sample topic bundle:
   ```bash
   docker compose -f infra/docker-compose.yml exec api npm run seed --workspace=@mathlens/api
   ```
4. Open [http://localhost:8080](http://localhost:8080) (Student Portal) or [http://localhost:8080/teacher/login](http://localhost:8080/teacher/login) (Teacher Dashboard).

## Local Development (Without Full Docker Build)

1. Start backing services with dev ports exposed:
   ```bash
   docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml up -d postgres redis minio minio-init
   ```
2. Install Node dependencies, generate Prisma client, and migrate:
   ```bash
   npm ci
   npm run prisma:generate
   npm --workspace=@mathlens/api run prisma:migrate
   npm run seed
   ```
3. Start the Python AI service (`services/ai`):
   ```bash
   cd services/ai
   python -m venv .venv
   # Activate venv, then:
   pip install -r requirements.txt -r requirements-dev.txt
   uvicorn app.main:app --reload --port 8000
   ```
4. Start the API, BullMQ worker, and Vite dev server in separate terminals:
   ```bash
   npm run dev:api
   npm run dev:worker
   npm run dev:web
   ```

## Verification Commands

- **JS / TS full check**:
  ```bash
  npm run build:shared && npm run lint && npm run format:check && npm run typecheck && npm run test && npm --workspace=@mathlens/api run test:coverage && npm run build
  ```
- **Generate OpenAPI spec (`docs/API.md`)**:
  ```bash
  npm run docs:openapi
  ```
- **Python AI service & evaluation harness**:
  ```bash
  cd services/ai
  ruff check app tests eval
  mypy app
  pytest --cov=app --cov-fail-under=80
  python -m eval.run_eval --provider fake --output-md ../../docs/EVALUATION.md --check-regression
  ```

## Monorepo Layout & Documentation

- `apps/web` — Arabic RTL React 18 + Vite + Tailwind + KaTeX + Recharts frontend
- `apps/api` — Node.js 20 + Express + Prisma + BullMQ REST API, image sanitizer & retention worker
- `services/ai` — Python FastAPI OpenCV preprocessing, reference-based rubric grading, SymPy Lark sandbox & SciPy/statsmodels analytics service
- `packages/shared` — Shared Zod schemas, domain validators, and bilingual error catalog
- `infra` — Dockerfiles (`Dockerfile.api`, `Dockerfile.ai`, `Dockerfile.web`), `docker-compose.yml`, and `nginx.conf`
- `seed` — Sample dual-model calculus exam bundle (`exams.seed.json`)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System topology, state machine, grading sequence & security safeguards
- [`docs/API.md`](docs/API.md) — Generated OpenAPI 3.0.3 reference
- [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) — Recorded architectural defaults
- [`docs/PROMPTS.md`](docs/PROMPTS.md) — Prompt versioning & human-review quality gate policy
- [`docs/EVALUATION.md`](docs/EVALUATION.md) — Deterministic evaluation suite results
