# Clipstack Core

The institutional memory layer for marketing teams. Open-source orchestration, UI shell, and adapter scaffolding for an AI-native marketing-comms platform.

> **Models commoditise. Memory doesn't.**
> Every approval, every correction, every shipped post becomes part of your team's persistent memory — and the next post is shaped by it.

## What this repo is

This is the MIT-licensed engine of the Clipstack platform. It contains:

- **Orchestration framework** — n8n workflow templates, CrewAI crew scaffolding, LangGraph stateful workflows
- **Mission Control UI** — Next.js 15 + shadcn/ui (new-york) Approval Queue, Workspace, and Mission Control surfaces
- **Adapter interfaces** — abstract `CRMAdapter`, `CMSAdapter`, `AnalyticsAdapter`, `AdsAdapter` contracts; bring your own backend
- **Critic-reviser loop** — generalised review cycle for any agent action
- **Mistake-ledger mechanism** — `company_lessons` schema + distill-lesson + recall infrastructure
- **Multi-tenancy + RBAC scaffolding** — row-level security, per-workspace encryption hooks
- **Metering schema** — per-output counter for transparency (USP 10)
- **x402 server middleware** — agentic-payments support via Coinbase CDP Facilitator
- **Journalist/media CRM** — the one workflow we build ourselves (no viable open-source alternative)
- **Feature-flag harness** — `CRYPTO_ENABLED` / `EVENTBUS_ENABLED` / `BANDITS_ENABLED` / `SIGNALS_LOADED` orthogonal switches

This repo **does not** contain:

- **`signals/`** — regulatory regime YAMLs (MiCA / FCA / ASA / FDA), per-platform algorithm heuristics, crisis playbooks, vertical-pack persona libraries, KOL roster sub-product. Proprietary; sold separately.
- **`hosted/`** — Stripe billing, USDC settlement, workspace provisioning, onboarding flows, customer-success tooling, marketing site. Powers the SaaS offering at clipstack.app.

The `core/` tree is designed to **build and run end-to-end with `signals/` deleted from disk**. CI enforces this: any PR that imports from `signals/` inside `core/` fails the build.

## Architecture

Four-layer stack:

| Layer | Choice | Why |
|---|---|---|
| **Workflow glue** | n8n (self-hosted, Docker) | Largest integration library, queue mode, mature |
| **Agent orchestration** | CrewAI for role-based pipelines, LangGraph for stateful workflows | Prototype in CrewAI, promote to LangGraph when production-critical |
| **Models** | LiteLLM unified router | Model-agnostic non-negotiable. Named profiles: `WRITER_MODEL` / `CLASSIFIER_MODEL` / `JUDGE_MODEL` / `VOICE_EMBED_MODEL` |
| **Knowledge + observability** | Postgres + Qdrant + Langfuse | Editorial memory in Postgres, vector recall in Qdrant, distributed tracing in Langfuse |

Plus a real-time layer:

- **Redpanda** event bus (Kafka-compatible) — 9 named topics close 12 strategy-refinement loopholes
- **Thompson-sampling bandits** — `bandit-orchestrator` runs N=3–5 variants per piece on Beta-prior posteriors via Python's stdlib `random.betavariate` (no `mabwiser`/`numpy` needed at K≤5); contextual-bandit upgrade gated behind the `[ml]` extra
- **LightGBM** percentile predictor — pre-publish percentile prediction calibrated within ±15 points

## Quick start

Requires Docker + Docker Compose, Node 20+, Python 3.11+, pnpm 9+.

For the fastest path to a logged-in Mission Control on a fresh checkout, use the one-command setup script — it brings up Postgres, applies migrations, seeds a demo workspace, writes `.env.local` with `AUTH_STUB` bypass, and tells you what to run next:

```bash
bash services/approval-ui/scripts/dev-setup.sh
cd services/approval-ui && pnpm dev --ignore-workspace
# → http://localhost:3000
```

Mission Control's surface — every tile is real data, every tile click-throughs to a detail page:

| Surface | What it shows |
|---|---|
| `/` | Mission Control bento — 9 real-data tiles (HeroKpi, ApprovalQueue, AgentActivity, Experiments, Anomalies, InstitutionalMemory, BusHealth, plus CTR/Reach/Spend metric tiles); every tile has a header link to its detail surface |
| `/inbox` | Full approval queue, grouped by channel, oldest-first |
| `/drafts/[id]` | Per-draft detail with approve/deny actions + USP 5 lesson-capture form |
| `/pipeline` | Publish-pipeline visualization — 5 happy-path stages + 2 terminal branches, with current draft counts at each node |
| `/performance` | KPI history with 7d/30d/12w range toggle |
| `/experiments` + `/experiments/[id]` | Bandit list + per-bandit posterior + arm/reward drill-down |
| `/memory` | Institutional-memory archive — every lesson grouped by scope (forever / topic / client) |
| `/agents` | Full agent directory with role-mapped AgentMarks, status, job descriptions, tools |
| `/activity` | Audit-log feed grouped by date |
| `/system` | Service + bus health detail (3 tiers: closed-loop bus, models + scoring, safety + compliance) |
| `/workspace` | Workspace at-a-glance — identity, agent roster, codified voice (top forever-scope lessons) |
| `/calendar` | Editorial calendar — upcoming scheduled drafts + recent published, with unscheduled-loose-ends rail |
| `/members` | Workspace member directory (active memberships + MFA + WorkOS link status) |
| `/settings` | Configuration readout: identity, active regimes, integration + features checklist |
| `/pitch` | Guided tour — 5-beat narrative walkthrough with talking points lifted verbatim for live demos. Bookmarkable; not in sidebar nav |

For a deeper walkthrough of the closed-loop story across these surfaces, open `http://localhost:3000/pitch` after running the seed — it's the in-app teleprompter for investor + design-partner demos. The seeded "Demo Workspace" tenant surfaces a `DEMO DATA · seeded workspace` badge top-right on every page, so live audiences always know whether they're seeing seed data or production.

For the full stack including agent services:

```bash
# 1. Start the stack
cp .env.example .env  # edit with your keys
docker compose up -d  # n8n + postgres + qdrant + langfuse + redpanda + ollama + litellm + traefik

# 2. Wait for health checks
docker compose ps     # all services should be healthy within ~5 minutes

# 3. Mission Control UI
cd services/approval-ui && pnpm install && pnpm dev
# → http://localhost:3000

# 4. CrewAI service
cd services/agent-crewai && uv sync && uv run uvicorn main:app --reload --port 8001
# → http://localhost:8001/health

# 5. LangGraph service
cd services/agent-langgraph && uv sync && uv run uvicorn main:app --reload --port 8002
# → http://localhost:8002/health
```

The closed-loop bandit pipeline (`generate → publish → measure → learn`) is documented step-by-step in `docs/closed-loop.md`. The full service mesh + data plane reference is `docs/architecture.md`. Approval-ui's API surface is in `docs/api.md` + `docs/openapi.yaml`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The hard rule: `core/` cannot import from `signals/`. Period.

## Legal templates

Procurement-ready templates for ToS, Privacy, IP ownership, AI-content disclosure, and DPA live under [`legal/`](./legal/). They are starting points, not legal advice — counsel must review before any production deployment.

## License

MIT — see [LICENSE](./LICENSE).

The proprietary `signals/` and `hosted/` trees ship under separate licenses and are not in this repo.
