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

This repo is at the very start of M1. A vertical-slice POC has been hand-built and
verified outside the real stack (see "What already exists" below) to prove the
router → execution plan → skill runtime contract before building the real services.
**Nothing here is wired to a real database, LLM, or n8n instance yet.**

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

1. **Intent Router — Level 1 only for the POC.** Rule-based phrase/keyword matching
   against each skill's `trigger_phrases`. No LLM, no embeddings. Level 2 (semantic
   matching, likely pgvector) is near-term once Level 1's gaps show up in real usage.
   **Level 3 (planner) is explicitly long-term** — do not build it during the POC.
   Contract: given a message, return `{skill, context_sources, requires_approval, status,
   candidates}` where `status` is `matched | no_match | ambiguous`. See
   `intent_router.py` for the reference implementation.

2. **MCP server boundaries = credential/trust domain, not product name.** One MCP server
   per distinct credential boundary (e.g. Jira + Confluence on the same Atlassian site
   share one server). A new system with its own credentials gets its own server. Never
   build a hand-rolled "do everything" MCP server — that just re-creates the monolith
   problem `agentgateway` already solves.

3. **RBC's Jira/Confluence are Server/Data Center (self-hosted), not Cloud.** M4 uses a
   self-hosted Atlassian MCP server (PAT auth, one server for both Jira + Confluence)
   running on the user's local Docker machine, registered into agentregistry. Not
   Atlassian's cloud-hosted remote MCP server (Cloud OAuth only).

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

These were hand-built and verified (`python3 demo.py "create a PRD for project Atlas"`)
before any real service existed, to prove the contract end to end:

- **`skills/generate_prd.skill.json`** — the one skill registry entry that exists so far.
- **`intent_router.py`** — Level 1 router reference implementation. Zero dependencies
  (stdlib only). This is the contract to preserve when porting into FastAPI at M1/M3.
- **`mock_prd_skill.py`** — fakes the Jira/Confluence fetch + LLM call with canned data.
  Replace with the real n8n workflow at M3/M4, not before.
- **`demo.py`** — ties router → execution plan → skill runtime together end to end.

When building the real thing, treat `intent_router.py`'s `route()` function signature and
return contract as authoritative — don't redesign the execution-plan shape without
updating this file, `schema.sql`'s `execution_plan` JSONB comment, and the Notion doc.

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
