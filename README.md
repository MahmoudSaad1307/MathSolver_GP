# MathLens | عدسة الرياضيات

AI-Graded Handwritten Math Exams with Video Remediation (`pre-test → remediation video → post-test`).

## Quick Start (5 Minutes)

1. Copy `.env.example` to `.env` and fill in your secrets/keys:
   ```bash
   cp .env.example .env
   ```
2. Start the full stack:
   ```bash
   docker compose -f infra/docker-compose.yml up --build -d
   ```
3. Seed the default teacher and sample topic:
   ```bash
   docker compose -f infra/docker-compose.yml exec api npm run seed --workspace=@mathlens/api
   ```
4. Open [http://localhost:8080](http://localhost:8080) (Student) or [http://localhost:8080/teacher/login](http://localhost:8080/teacher/login) (Teacher).

## Monorepo Layout

- `apps/web` — Arabic RTL React + Vite + KaTeX frontend
- `apps/api` — Node.js + Express + Prisma + BullMQ API & worker
- `services/ai` — Python FastAPI image preprocessing, AI grading, SymPy equivalence & SciPy statistics service
- `packages/shared` — Shared Zod schemas, domain validators, and error catalog
- `infra` — Dockerfiles, `docker-compose.yml`, and nginx config
- `seed` — Sample dual-model calculus exam bundle (`exams.seed.json`)
- `docs` — Architecture, Assumptions, API spec, Prompts, and Evaluation reports
