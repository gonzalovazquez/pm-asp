# Operator User Guide — Agentic Skills Platform (PM ASP)

**Audience:** the operator of the platform — a **Technical Product Manager (TPM)** who
curates skills and workflows and uses the platform to produce and retrieve documents.

This guide covers the day-to-day operating tasks:

1. [Start & check the platform](#1-start--check-the-platform)
2. [Use the platform (the two journeys)](#2-use-the-platform-the-two-journeys)
3. [Write a SKILL.md and compile it to JSON](#3-write-a-skillmd-and-compile-it-to-json)
4. [Create & publish a skill (end-to-end)](#4-create--publish-a-skill-end-to-end)
5. [Create & manage an n8n workflow](#5-create--manage-an-n8n-workflow)
6. [Approvals & artifact versions](#6-approvals--artifact-versions)
7. [Switch the LLM provider (cloud / local / offline)](#7-switch-the-llm-provider)
8. [Operate & troubleshoot](#8-operate--troubleshoot)

> Mental model: a **skill** is a capability the platform can perform (e.g. *generate PRD*).
> Each skill has (a) a **SKILL.md** (its instructions/knowledge + routing metadata) that
> compiles to a **registry entry** the router reads, and (b) an **n8n workflow** that does the
> actual work. You, the TPM, curate both.

---

## 1. Start & check the platform

```bash
cp .env.example .env          # first time only
docker compose up --build     # brings up all services
```

Open the surfaces you'll use:

| Surface | URL | You use it to… |
|---|---|---|
| **Chat UI** | http://localhost:3000 | run skills as a user (Author / Consumer) |
| **n8n editor** | http://localhost:5678 | create/edit/publish workflows |
| Backend health | http://localhost:8000/health | confirm Postgres/Redis are up |
| Skill registry (API) | http://localhost:8000/api/skills | see the loaded skills |
| agentgateway admin | http://localhost:15000/ui/ | inspect LLM/MCP routing |

Health should read `{"status":"ok", ...}`. First time in the n8n editor, complete the
one-time local owner account (all local — nothing leaves your machine).

---

## 2. Use the platform (the two journeys)

In the Chat UI, the **Acting as** toggle switches identity so you can demo both roles.

- **Author** → *"create a PRD for project Atlas"* → the platform routes to `generate_prd`,
  runs the workflow, and returns a PRD (with a ⚠️ *pending approval* badge). The artifact is
  stored.
- **Consumer** → *"what are the requirements for project Atlas"* → routes to
  `summarize_requirements`, retrieves the stored PRD, and returns a summary.

That's the loop you're curating skills for. Everything below is how you add to and operate it.

---

## 3. Write a SKILL.md and compile it to JSON

This is the core authoring task. A skill lives in `skills/<name>/SKILL.md`; the **compiler**
turns it into `skills/<name>.skill.json` — the entry the router loads.

### 3.1 Why a SKILL.md *and* a compiler

A standard `SKILL.md` frontmatter only has `name` + `description`. Our router also needs
**routing metadata** (`trigger_phrases`, `required_context_sources`, `requires_approval`,
`workflow_ref`). So we **extend the frontmatter** with those fields, and
`tools/compile_skills.py` emits the JSON. (See `skills/README.md`.)

### 3.2 Author it

Start from the template:

```bash
cp -r skills/_template skills/identify_risks
$EDITOR skills/identify_risks/SKILL.md
```

Fill in the frontmatter and the body:

```markdown
---
name: identify_risks
version: 0.1.0
description: Identifies delivery and technical risks for a project from its Jira issues and PRD. Choose this when the user asks to surface, list, or assess project risks.
required_context_sources: [jira]
requires_approval: false
workflow_ref: n8n:identify_risks_v1
output_type: markdown
# trigger_phrases:      # optional — omit to auto-generate (see 3.4)
#   - identify risks
#   - what are the risks for
---

# Identify Risks
<the skill's instructions / knowledge — used as the prompt content when the workflow runs>
```

**Frontmatter fields:**

| Field | Meaning |
|---|---|
| `name` | unique skill id → `<name>.skill.json` |
| `description` | **the router reads this at runtime** — write it so an LLM can tell *when* to pick this skill (include the verbs a user would type) |
| `required_context_sources` | which context the skill needs (`jira`, `confluence`, `github`, `artifacts`) |
| `requires_approval` | `true` gates the artifact behind human approval |
| `workflow_ref` | the n8n workflow this skill dispatches to — `n8n:<name>_v1` |
| `output_type` | usually `markdown` |
| `trigger_phrases` | optional keyword phrases for the Level-1 fallback (see 3.4) |

Keep `description` on a **single line** (the compiler's frontmatter parser expects scalar
values).

### 3.3 Compile it

```bash
python3 tools/compile_skills.py            # writes skills/identify_risks.skill.json
python3 tools/compile_skills.py --check     # CI: fails if any JSON is out of date
```

Restart the backend so it reloads the registry (`docker compose restart backend`), or it will
pick the new skill up on next start. Confirm it's registered:

```bash
curl -s http://localhost:8000/api/skills | python3 -m json.tool | grep '"name"'
```

### 3.4 Where trigger phrases come from

The compiler resolves `trigger_phrases` in this order:

1. **Authored** in frontmatter — deterministic, preferred when you want exact control.
2. **LLM-generated** from the description — run `python3 tools/compile_skills.py --generate`
   (needs `AGENTGATEWAY_URL` reachable + a working LLM). The compiler asks the model for 5–8
   phrases.
3. **Heuristic** fallback (from the name) with a warning — so it always compiles offline.

Because the **LLM router reads `description` at runtime**, trigger phrases mostly feed the
**Level-1 keyword fallback** — so auto-generating them is safe; hand-author them when the
offline path needs to be precise.

---

## 4. Create & publish a skill (end-to-end)

A skill isn't "live" until three things exist and agree on the same `workflow_ref` /
webhook name:

1. **The SKILL.md + compiled JSON** — §3 above. (`workflow_ref: n8n:identify_risks_v1`)
2. **The n8n workflow** — §5 below. (webhook path `identify_risks`)
3. **A dispatch branch in the backend** — `backend/app/main.py` decides what to do when the
   router picks your skill. Add a branch mirroring the existing ones:

   ```python
   elif plan["status"] == "matched" and plan["skill"] == "identify_risks":
       project = mock_prd_skill.extract_project_name(req.message)
       result = n8n_client.trigger("identify_risks", {"project": project, "message": req.message})
       reply = result.get("markdown", "")
       # (persist an artifact here if this skill produces one)
   ```

   Register the webhook path in `backend/app/n8n_client.py`'s `WEBHOOK_PATHS`.

**Publish checklist**

- [ ] `skills/<name>/SKILL.md` authored, `python3 tools/compile_skills.py` run
- [ ] `n8n/<name>_v1.json` created and imported (see §5)
- [ ] `WEBHOOK_PATHS` + dispatch branch added in the backend
- [ ] `docker compose up -d --build backend` (and re-import n8n if needed)
- [ ] Verify: send a triggering message in the Chat UI → correct skill routes and runs

---

## 5. Create & manage an n8n workflow

Workflows are the **execution** half of a skill. Each is a webhook-triggered flow that calls
the LLM (via agentgateway) and returns a result.

### 5.1 The shape of a skill workflow

Open an existing one to copy the pattern: **n8n editor → `generate_prd_v1`**. It is three
nodes:

```
Webhook (POST /webhook/generate_prd, respond via "Respond to Webhook")
   → HTTP Request  (POST {{$env.AGENTGATEWAY_URL}}/v1/messages, Anthropic Messages body)
   → Respond to Webhook  ({ markdown, project })
```

- **Webhook** node: method `POST`, path = your skill's webhook name (e.g. `identify_risks`),
  Response Mode = *Using 'Respond to Webhook' node*.
- **HTTP Request** node: `POST {{$env.AGENTGATEWAY_URL}}/v1/messages`, JSON body with `model`
  (`{{$env.PRD_MODEL}}`), `max_tokens`, a `system` prompt (paste your SKILL.md guidance), and
  `messages` built from the webhook payload. Read the model's answer from
  `{{$json.content[0].text}}`.
- **Respond to Webhook** node: return the JSON your backend expects
  (e.g. `{ markdown, project }`).

> The **MCP context step** (fetch Jira/Confluence/GitHub before the LLM) is the M4 seam —
> see the sticky note in `generate_prd_v1`. To wire it, insert an **MCP Client Tool** node (or
> an HTTP Request to agentgateway's `/mcp` endpoint) before the LLM node and feed the fetched
> context into the prompt. This requires your MCP servers to be running (§7 / real mode).

### 5.2 Two ways to author a workflow

**A. In the n8n editor (fastest to iterate):** build/edit visually, then **export** it
(⋯ menu → *Download*) to `n8n/<name>_v1.json` so it's version-controlled. Toggle the workflow
**Active** so its production webhook registers.

**B. As a JSON file (reproducible):** copy `n8n/generate_prd_v1.json`, rename, change the
Webhook `path`, the prompt, and the response shape. It is imported automatically on
`docker compose up` by the one-shot `n8n-import` container, which also **publishes** each
workflow so the webhook is live.

### 5.3 Re-import / re-publish after editing the JSON

The importer runs on stack start. To force a clean re-import:

```bash
docker compose rm -sf n8n n8n-import
docker volume rm pm-asp_n8n_data
docker compose up -d n8n            # re-imports + publishes all n8n/*.json
```

If a webhook returns **404**, the workflow isn't published — open it in the editor and toggle
**Active**, or re-run the import above.

### 5.4 Test a workflow directly

```bash
curl -s -X POST http://localhost:5678/webhook/generate_prd \
  -H 'content-type: application/json' \
  -d '{"project":"Atlas","message":"real-time notifications platform"}'
```

(A non-404 response means it's registered; a real body needs the LLM reachable — §7.)

---

## 6. Approvals & artifact versions

- Skills with `requires_approval: true` (e.g. `generate_prd`) surface a **⚠️ pending approval**
  badge. In this POC that is **informational**; enforced approval (an n8n *wait* node that
  blocks until a human approves) is milestone **M5**. Approval state lives in n8n, never in
  Postgres.
- **Artifacts are versioned, never overwritten.** Re-running `generate_prd` for the same
  project inserts a **new** row; retrieval (`summarize_requirements`) always uses the **latest**.
  Inspect them:

  ```bash
  docker compose exec postgres psql -U asp -d asp \
    -c "select title, version, status, created_at from artifacts order by created_at desc;"
  ```

---

## 7. Switch the LLM provider

The LLM provider is a **gateway/config** concern — no app code changes. Three modes:

| Mode | Set in `.env` | Notes |
|---|---|---|
| **Offline** (no LLM) | `OFFLINE_MODE=1` | Level-1 keyword router + canned PRD; great for demos/CI, needs no secrets |
| **Cloud (Anthropic)** | `OFFLINE_MODE=0` + `ANTHROPIC_API_KEY=...` | default `gateway/agentgateway.yaml` |
| **Local (Ollama)** | `OFFLINE_MODE=0`, model vars = Ollama models, no key | run Ollama on the host + swap the gateway `llm` block — see **`docs/adr/0001-ollama-local-mode.md`** |

Real mode (cloud or local) also needs the **self-hosted MCP servers** running on your host if
you want live Jira/Confluence/GitHub context; otherwise PRDs are authored from the prompt text.

---

## 8. Operate & troubleshoot

| Symptom | Check / fix |
|---|---|
| Health `degraded` | `docker compose ps` — is Postgres/Redis healthy? `docker compose logs backend` |
| Chat says "I don't have a skill for that" | router returned `no_match`/`ambiguous`, or the matched skill has no dispatch branch (§4) |
| Wrong skill chosen | tighten the skill **`description`** (the LLM router reads it) or the `trigger_phrases` for the offline path |
| Workflow webhook 404 | workflow not **published** — toggle Active in the editor or re-import (§5.3) |
| LLM calls fail in real mode | is `ANTHROPIC_API_KEY` set (cloud) / Ollama running (local)? Is `AGENTGATEWAY_URL` pointing at the **LLM** port `:4000`? |
| PRD ignores Jira/GitHub | the MCP context step is the M4 seam (§5.1) and needs your MCP servers up |
| See what the router decided | the Chat UI shows a plan chip; the assistant message stores the plan in `messages.metadata` |

**Handy commands**

```bash
docker compose ps                                  # service status
docker compose logs -f backend                     # backend logs
curl -s localhost:8000/health                       # health
curl -s localhost:8000/api/skills | python3 -m json.tool   # registry
python3 tools/compile_skills.py --check             # skill JSON in sync with SKILL.md?
docker compose down                                 # stop (add -v to wipe data volumes)
```

---

### Where things live (quick map)

| You want to change… | Edit… |
|---|---|
| A skill's behavior/knowledge | `skills/<name>/SKILL.md` → recompile |
| A skill's routing metadata | same frontmatter → recompile |
| What a skill *does* | `n8n/<name>_v1.json` (or the n8n editor) |
| How a matched skill is dispatched/persisted | `backend/app/main.py` (+ `n8n_client.py`) |
| The LLM provider | `.env` + `gateway/agentgateway.yaml` (see ADR 0001) |
| Architecture reference | `ARCHITECTURE.md`, `architecture/pm-asp.calm.json` |
