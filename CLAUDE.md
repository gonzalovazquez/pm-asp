# Agentic Skills Platform

> Working title — an AI-native platform for enterprise product/engineering work. A
> conversational interface backed by a catalog of reusable **skills** (e.g. generate PRD,
> identify risks, prep roadmap), executed through orchestrated workflows with human
> approval where needed, grounded in enterprise knowledge (Jira, Confluence), and capable
> of producing real documents.
>
> Full design doc (business/technical/NFR requirements, architecture decisions, milestones):
> Notion — "Agentic Skills Platform (PRD v1)"

## Core domain objects

Skills, Workflows, Intents, Context, Artifacts, Executions. Keep these names consistent
across code, schema, and docs — they're the shared language between the design doc and
the implementation.

## Current status: POC, Phase 1 (Proof of Concept)

A **runnable vertical slice** now exists (see "What already exists" below): a Next.js chat
UI → FastAPI (API gateway + intent router + skill dispatcher) → n8n workflows → agentgateway
(LLM + MCP) → Anthropic, with Postgres/Redis as the data layer, all wired together via Docker
Compose. `README.md` is the run guide. Two demo journeys work end to end: an Author creates a
PRD artifact; a Consumer asks for a project's requirements and gets a summary of the stored
artifact.

The stack has an `OFFLINE_MODE` (default on) that uses the Level-1 keyword router + a canned
PRD so the whole flow is testable with no `ANTHROPIC_API_KEY` and no running MCP servers. In
**real mode** it calls Claude (via agentgateway) for both routing and skill execution; the
one remaining seam is the MCP context fetch inside the n8n workflow, which depends on the
user's self-hosted Atlassian/GitHub MCP servers being up (see decision 3).

---

## Tech stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js | Chat UI |
| Backend | FastAPI | API Gateway + Intent Router + Skill Runtime |
| Workflow engine | n8n | Orchestrates multi-step skill workflows; also owns approval state (see below) |
| Database | Postgres + pgvector | Skill Registry, Conversation Store, Artifact Store |
| Cache/session | Redis | See `redis-key-patterns.md` for key conventions |
| MCP + LLM Gateway | [agentregistry](https://aregistry.ai) (`arctl`) + `agentgateway` | Open source (Apache 2.0), Solo.io-backed. `arctl` publishes/curates MCP servers, agents, prompts; `agentgateway` is the runtime — single authenticated endpoint, tool routing, multi-provider LLM gateway |
| Observability (LLM/GenAI) | [MLflow](https://mlflow.org) | Tracing (OTel-based), evaluation, Prompt Registry. **Not** MLflow's own AI Gateway — `agentgateway` already owns that role |
| Observability (workflow) | n8n's built-in execution log | POC only; revisit OpenTelemetry instrumentation at M8 |
| Local dev | Docker Compose | Production: Kubernetes / Helm |

### Important vocabulary collision

**agentregistry's "Skill" ≠ our "Skill."** Theirs is a `SKILL.md` knowledge bundle
(instructions + docs/code, packaged as a Docker image) — closer to a RAG-style knowledge
pack than an intent-triggered, workflow-dispatching capability. It has no concept of
required context sources, approval flags, or n8n workflow references. **Our** Skill
Registry (a Postgres table, see `schema.sql`) is what the Intent Router actually queries.
A skill row can optionally point at an agentregistry skill by name/version to attach a
knowledge pack, but agentregistry never owns our routing metadata.

---

## Architecture decisions already made

Treat these as settled unless explicitly revisited — don't re-litigate them without a
good reason, and if you do change one, update this file and the Notion doc together.

1. **Intent Router — now LLM-based (revised).** *Original decision was Level 1 only
   (rule-based phrase matching, no LLM).* Per an explicit product decision, the running
   platform routes with an **LLM** (Claude via agentgateway): it reads the message + the
   skills registry and picks the best skill. `backend/app/router.py` is the implementation.
   The zero-dependency Level-1 router (`intent_router.py`) is retained as **(a)** the
   authoritative definition of the execution-plan CONTRACT and **(b)** the offline / on-error
   fallback. **The contract shape is unchanged and must stay stable:**
   `{skill, context_sources, requires_approval, status, candidates}` where `status` is
   `matched | no_match | ambiguous`. Level 2 (pgvector semantic matching) and Level 3
   (planner) remain later-milestone options; do not build the planner during the POC.

2. **MCP server boundaries = credential/trust domain, not product name.** One MCP server
   per distinct credential boundary (e.g. Jira + Confluence on the same Atlassian site
   share one server). A new system with its own credentials gets its own server. Never
   build a hand-rolled "do everything" MCP server — that just re-creates the monolith
   problem `agentgateway` already solves.

3. **RBC's Jira/Confluence are Server/Data Center (self-hosted), not Cloud.** M4 uses a
   self-hosted Atlassian MCP server (PAT auth, one server for both Jira + Confluence)
   running on the user's local Docker machine, registered into agentregistry. Not
   Atlassian's cloud-hosted remote MCP server (Cloud OAuth only). **A self-hosted GitHub MCP
   server (PAT) was added** alongside Atlassian as a second context source — separate
   credential boundary, separate agentgateway target (`gateway/agentgateway.yaml`). Both run
   on the user's host and agentgateway reaches them via `host.docker.internal`; the app never
   holds the PATs (they live with each MCP server).

4. **Approval state lives in n8n**, via its workflow execution/wait nodes — not a
   separate Postgres table. No `executions` table exists in the schema (see below).
   Conversation memory and approval state are different concerns and never share a store.

5. **Multi-tenancy is fully deferred to M9.** Single-tenant only through Phases 1–2. No
   `tenant_id` anywhere in the schema yet. When M9 arrives, the two options on the table
   are edge-only enforcement (fast, weak) vs. threaded-through-every-store with Postgres
   Row-Level Security + per-tenant MCP credential scoping (slower, real defense-in-depth
   — likely direction given the banking context).

6. **agentregistry Enterprise tier vs. OSS core: deferred, not a POC blocker.**
   `agentgateway`'s OSS distribution already ships RBAC (CEL policy engine), JWT/OAuth/
   API-key auth, rate limiting, and OTel tracing for free. Whether Solo.io's paid tier is
   needed is a procurement question for M9, not an architecture question now.

---

## Data schema

Postgres DDL lives in `schema.sql`. Highlights:

- **`skills`** — our Skill Registry. `trigger_phrases` and `required_context_sources` are
  JSONB arrays; `requires_approval` boolean; `workflow_ref` points at an n8n workflow ID.
- **`conversations` / `messages`** — chat history. `messages.embedding` is
  `VECTOR(1536)` (OpenAI `text-embedding-3-small` sized) — **placeholder**, adjust to
  whatever embedding model M2 actually lands on.
- **`artifacts`** — generated documents (PRDs etc). Inline `content` for small text
  artifacts, `storage_url` pointer for large/binary ones. One row per version — never
  overwrite, insert a new version and mark the old `superseded`. No `execution_id` FK
  (see next point).
- **No `executions` table.** Deliberately deferred per decision 4 above. If this ever
  gets built (M5/M9 compliance reporting), it's an outcome log only — n8n still owns
  the actual approval mechanics.

Redis has no DDL — see `redis-key-patterns.md` for key patterns, data structures, and
TTLs (session cache, streaming buffers, `approvals:pending`, rate limiting, router cache).
Note: `approvals:pending` is currently the **only** queryable approval index outside n8n
itself, since there's no `executions` table to derive it from.

---

## What already exists (POC files)

**Original contract files** (still the authoritative contract; `python3 demo.py "create a
PRD for project Atlas"` still works, stdlib-only):
- **`intent_router.py`** — Level-1 router reference impl + registry loader. Now also the
  offline / on-error fallback used by the LLM router.
- **`mock_prd_skill.py`** — canned Jira/Confluence + LLM stand-in. Used only in `OFFLINE_MODE`.
- **`demo.py`** — ties router → plan → runtime end to end.
- **`skills/generate_prd.skill.json`**, **`schema.sql`**, **`redis-key-patterns.md`**.

**The runnable stack built on top** (see `README.md`):
- **`skills/summarize_requirements.skill.json`** — second skill, for the Consumer retrieval
  journey (query an existing project's requirements).
- **`backend/`** — FastAPI: `router.py` (LLM router + Level-1 fallback), `gateway.py`
  (Claude via agentgateway), `n8n_client.py`, `db.py` (Conversation/Artifact stores),
  `cache.py` (Redis session), `main.py` (`/health`, `/api/skills`, `/api/chat`).
- **`n8n/generate_prd_v1.json`, `n8n/summarize_requirements_v1.json`** — the skill workflows
  (Webhook → LLM via agentgateway → Respond), auto-imported by the `n8n-import` container.
- **`gateway/agentgateway.yaml`** — Anthropic LLM upstream + Atlassian/GitHub MCP targets.
- **`frontend/`** — Next.js chat UI (Author/Consumer toggle, plan chip, approval badge).
- **`docker-compose.yml`**, **`.env.example`** — the whole stack.

Treat `intent_router.py`'s `route()` return contract as authoritative — don't redesign the
execution-plan shape (`{skill, context_sources, requires_approval, status, candidates}`)
without updating this file, `schema.sql`, `backend/app/router.py`, and the Notion doc.

---

## Milestones

### Phase 1 — Proof of Concept
- **M1 — Foundation:** Docker Compose, Next.js chat app, FastAPI backend, Postgres,
  Redis, n8n, basic auth, health checks, plus `arctl`/`agentgateway` stood up as the
  MCP + LLM gateway.
- **M2 — Chat to LLM:** Streaming responses, conversation history.
- **M3 — First skill:** Generate PRD, prompt templates, markdown output. Port
  `intent_router.py` and `mock_prd_skill.py` into the real backend here.

### Phase 2 — Enterprise Integration
- **M4 — Enterprise context:** Self-hosted Atlassian MCP server (Jira + Confluence DC,
  PAT auth) on the user's Docker machine, registered into agentregistry. Replace
  `mock_prd_skill.py`'s canned data with real MCP calls.
- **M5 — Workflow orchestration:** n8n retries, error handling, human approval steps.
- **M6 — Skill registry as a service:** Move off the static JSON file into the
  `skills` Postgres table.

### Phase 3 — Production Platform
- **M7 — Intent router v2:** Add Level 2 semantic matching.
- **M8 — Full telemetry:** MLflow tracing/eval; decide on n8n OpenTelemetry
  instrumentation.
- **M9 — Enterprise readiness:** RBAC, multi-tenancy (`tenant_id` + RLS), secrets
  management, resolve agentregistry Enterprise-vs-OSS question.
- **M10 — Platform expansion:** Broaden into a full AI product management platform.

---

## Working conventions for Claude Code

- **Don't jump ahead of the current milestone.** If asked to build something from a
  later phase (e.g. multi-tenancy, Level 2/3 routing, a real `executions` table) without
  explicit instruction, flag that it's earlier than planned rather than building it
  silently.
- **Keep the router contract stable.** `{skill, context_sources, requires_approval,
  status, candidates}` is depended on by the schema (`execution_plan` JSONB) and the
  mock skill runtime. Changing its shape is a cross-cutting change.
- **agentregistry vs. our Skill Registry — don't conflate them** when writing code that
  touches either. See "Important vocabulary collision" above.
- **n8n owns approval mechanics; Postgres doesn't** (yet). Don't add an approvals table
  without checking this file and the Notion doc first, that's a deliberate decision, not
  an oversight.
- When a decision here turns out to be wrong or gets revisited, **update this file** —
  it's meant to stay the single source of truth for whoever (human or Claude) picks up
  the next session.
