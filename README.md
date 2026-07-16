# Agentic Skills Platform (PM ASP) — POC

A runnable vertical slice of the platform described in `CLAUDE.md` and the Notion PRD.
The point of this POC is the **automation**:

- **Journey 1 — Author:** you chat → an **LLM intent router** picks a skill from the
  registry → an **n8n workflow** fires the LLM (via **agentgateway**, with the Atlassian +
  GitHub **MCP** servers as context) to build a **PRD artifact** → it's stored in Postgres.
- **Journey 2 — Consumer:** a second user asks *"what are the requirements for project X"*
  → the router picks the retrieval skill → the stored PRD is fetched and the LLM returns a
  **summary**.

```
Next.js chat UI ──▶ FastAPI (API gateway + LLM intent router + skill dispatcher)
                          │
        ┌─────────────────┼──────────────────────────┐
   LLM route select   trigger n8n webhook       persist Postgres + Redis session
   via agentgateway         │
                            ▼
                     n8n workflow ──▶ agentgateway ──▶ Anthropic (LLM)
                                          └──────────▶ Atlassian + GitHub MCP (your host)
```

Services (Docker Compose): `postgres` (pgvector), `redis`, `agentgateway`, `n8n`
(+ one-shot `n8n-import`), `backend` (FastAPI), `frontend` (Next.js).

---

## Quickstart

### 0. Prerequisites
- Docker + Docker Compose.
- (Real mode only) an `ANTHROPIC_API_KEY`, and — for real MCP context — the self-hosted
  Atlassian (Jira+Confluence, PAT) and GitHub (PAT) MCP servers running on your host.

```bash
cp .env.example .env
```

### 1. Offline mode — no secrets, smoke-test the whole flow

`OFFLINE_MODE=1` (the default in `.env.example`) uses the Level-1 keyword router and a
canned PRD, so nothing external is required.

```bash
docker compose up --build
```

Then open **http://localhost:3000**:
1. As **Author**, send `create a PRD for project Atlas` → you get a plan chip, a
   `⚠️ pending approval` badge, and a rendered (mock) PRD.
2. Switch to **Consumer**, send `what are the requirements for project Atlas` → you get a
   summary of the PRD the Author just created (retrieved from Postgres).

Other endpoints: backend health `http://localhost:8000/health`, skills
`http://localhost:8000/api/skills`, n8n `http://localhost:5678`, agentgateway admin
`http://localhost:15000/ui/`. agentgateway serves the **LLM at host `:8080`**
(container `:4000`, Anthropic `/v1/messages`) and **MCP at host `:8081`** (container
`:3000`, `/mcp`).

The pure contract also runs with zero dependencies:
```bash
python3 demo.py "create a PRD for project Atlas"
```

### 2. Real mode — actual LLM + n8n + MCP automation

In `.env` set:
```
OFFLINE_MODE=0
ANTHROPIC_API_KEY=sk-ant-...
# point these at YOUR running self-hosted MCP servers:
ATLASSIAN_MCP_URL=http://host.docker.internal:9000/mcp/
GITHUB_MCP_URL=http://host.docker.internal:9001/mcp/
```
then `docker compose up --build`. Now:
- the router calls Claude (via agentgateway) to select the skill,
- `create a PRD…` triggers the **generate_prd_v1** n8n workflow, which calls Claude to
  author a real PRD,
- `what are the requirements…` triggers **summarize_requirements_v1** to summarize the
  stored PRD.

---

## What's real vs. mocked (milestone map)

| Piece | Status in this POC |
|---|---|
| Chat UI, API gateway, skill dispatch | ✅ real |
| Intent router (LLM, via agentgateway) | ✅ real in real mode; Level-1 keyword fallback offline / on error |
| Skill registry | ✅ JSON files in `skills/` (M6 moves this into the `skills` Postgres table — already seeded) |
| n8n workflows (generate PRD, summarize) | ✅ real — call Claude via agentgateway |
| agentgateway (LLM gateway + MCP routing) | ✅ configured; LLM path testable with a key |
| Conversation / Artifact stores (Postgres) | ✅ real (`schema.sql`) |
| Redis `session:*` cache | ✅ real; other keys in `redis-key-patterns.md` are seams |
| **MCP context fetch** (Jira/Confluence/GitHub) | 🔌 **seam** — agentgateway is wired to your host's MCP servers, but the workflow's MCP fetch node is left as a documented step (see the sticky note in `n8n/generate_prd_v1.json`). Without it, PRDs are authored from the prompt text alone. |
| Human approval enforcement | ⏳ M5 — `requires_approval` is surfaced as a badge; enforcement (n8n wait node) not built |
| Streaming, embeddings, MLflow, auth, multi-tenancy | ⏳ later milestones (M2/M7/M8/M9) |

---

## Verifying persistence

```bash
docker compose exec postgres psql -U asp -d asp \
  -c "select role, left(content,40) from messages order by created_at;" \
  -c "select skill_name, title, status from artifacts;"
docker compose exec redis redis-cli keys 'session:*'
```

## Notes
- **agentgateway config** (`gateway/agentgateway.yaml`) targets image
  `cr.agentgateway.dev/agentgateway:v1.3.1`, which serves the LLM on container `:4000` and
  MCP on `:3000`. `AGENTGATEWAY_URL` (used by the backend + n8n for LLM calls) therefore
  points at `:4000`. If your gateway version differs, adjust the `llm:`/`mcp:` blocks and
  the port.
- **n8n** auto-imports the two workflows and **publishes** them (`publish:workflow --id=`)
  via the one-shot `n8n-import` container, so the webhooks are registered on startup. If a
  webhook ever 404s after an n8n upgrade changes the CLI, toggle each workflow **Active** in
  the n8n UI (http://localhost:5678). Viewing/editing in the UI may require completing n8n's
  first-run owner setup once; the webhooks work regardless.
- The router's `{skill, context_sources, requires_approval, status, candidates}` contract is
  unchanged from `intent_router.py` — that shape is depended on by `schema.sql` and the docs.
