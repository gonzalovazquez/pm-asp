# ADR 0001 — Local, Ollama-only LLM mode

- **Status:** Proposed
- **Date:** 2026-07-16
- **Deciders:** Platform architecture
- **Related:** CLAUDE.md decisions 3 & 6 (self-hosted context; agentgateway as multi-provider
  gateway), `gateway/agentgateway.yaml`, `ARCHITECTURE.md`

## Context

The platform's LLM calls (intent router, PRD authoring, summarization, the skill compiler's
trigger-phrase generation) all go through **one** seam — `agentgateway` — which was chosen
because it is a multi-provider LLM gateway. Today it fronts **Anthropic (Claude)**.

There is demand to run the platform **fully locally with no cloud LLM egress** — driven by
data-residency / air-gap needs (banking context), offline development, and cost. The target
is an **Ollama-only** deployment: every LLM call served by a model running on the operator's
host, with **no `ANTHROPIC_API_KEY`** and **no prompt data leaving the network**.

### The key question — can we do this without changing application code?

Yes. agentgateway **translates between LLM API formats** ("Depending on the API used in the
request, and the provider selected, agentgateway can pass the request through or translate it
as needed... connecting clients regardless of which API they use to any provider"). Our
callers speak the **Anthropic Messages** format (`POST /v1/messages`); agentgateway can route
that to an **OpenAI-compatible** upstream and translate the response back. Ollama exposes an
OpenAI-compatible `/v1/chat/completions`, which agentgateway's **`custom`** provider targets
directly (`params.baseUrl`; API key optional for local endpoints).

## Decision

Support a **local (Ollama-only) mode** as a **configuration profile**, not a code path:

1. Point agentgateway's `llm` block at a local Ollama via a `custom` (completions) provider.
2. Set the model env vars to Ollama model names; leave `ANTHROPIC_API_KEY` unset.
3. Run Ollama on the host; agentgateway reaches it via `host.docker.internal` (already wired
   through `extra_hosts`).

**No changes to `backend/`, `n8n/`, or `tools/compile_skills.py`** — they keep sending
Anthropic Messages to agentgateway; the gateway does the translation. This is precisely the
value the multi-provider-gateway decision was meant to deliver.

`OFFLINE_MODE` is unchanged and orthogonal: it means "no LLM at all" (Level-1 router + canned
skills). The three operating modes are therefore:

| Mode | `OFFLINE_MODE` | LLM upstream | Key needed | Data egress |
|---|---|---|---|---|
| Offline | `1` | none (canned) | no | none |
| **Local (this ADR)** | `0` | **Ollama (host)** | **no** | **none** |
| Cloud | `0` | Anthropic | yes | to Anthropic |

## Configuration to run local mode

### 1. Install + start Ollama on the host, pull a model

```bash
# https://ollama.com/download  (or: brew install ollama)
ollama serve                       # exposes http://localhost:11434
ollama pull llama3.1:8b            # or qwen2.5:14b, mistral-nemo, etc.
```

Pick a model with **tool-calling** support if you intend to wire the M4 MCP context step
(e.g. `llama3.1`, `qwen2.5`); smaller models are weaker at strict-JSON routing and tool use
(see Consequences).

### 2. Gateway config — `gateway/agentgateway.yaml` (local variant)

Replace the `llm:` block's Anthropic provider with a local `custom` provider. (The `mcp:`
block is unchanged.)

```yaml
# yaml-language-server: $schema=https://agentgateway.dev/schema/config
llm:
  models:
    - name: "*"                     # forward any model id the caller passes
      provider:
        custom:
          formats: [completions]    # gateway translates Anthropic Messages <-> completions
        params:
          baseUrl: "http://host.docker.internal:11434/v1"   # Ollama OpenAI-compatible API
          # model: "llama3.1:8b"    # optional pin; otherwise the caller's model id is used
          # no apiKey — local endpoint

mcp:
  port: 3000
  policies:
    cors:
      allowOrigins: ["*"]
      allowHeaders: ["*"]
      exposeHeaders: ["Mcp-Session-Id"]
  targets:
    - name: atlassian
      mcp: { host: http://host.docker.internal:9000/mcp/ }
    - name: github
      mcp: { host: http://host.docker.internal:9001/mcp/ }
```

> Keep the cloud `agentgateway.yaml` around (or gate via two files) so you can switch profiles.
> A clean way: keep `gateway/agentgateway.yaml` (cloud) and
> `gateway/agentgateway.ollama.yaml` (local), and point the compose volume mount at whichever
> profile you want.

### 3. `.env` — local profile

```dotenv
OFFLINE_MODE=0
# ANTHROPIC_API_KEY not needed — leave unset
ROUTER_MODEL=llama3.1:8b
PRD_MODEL=llama3.1:8b
AGENTGATEWAY_URL=http://agentgateway:4000     # LLM endpoint (unchanged)
ATLASSIAN_MCP_URL=http://host.docker.internal:9000/mcp/
GITHUB_MCP_URL=http://host.docker.internal:9001/mcp/
```

### 4. Compose

No structural change. `extra_hosts: host.docker.internal:host-gateway` on `agentgateway` is
already present, so the container can reach Ollama on the host. Bring the stack up as usual:

```bash
docker compose up --build
```

### 5. Smoke test (the one thing worth verifying)

Confirm the Anthropic-Messages → Ollama-completions translation round-trips cleanly — the
backend and n8n read `content[0].text` from the response, so that mapping must survive:

```bash
# through the gateway, in Anthropic Messages format, served by Ollama:
curl -s http://localhost:8080/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"llama3.1:8b","max_tokens":128,
       "messages":[{"role":"user","content":"Reply with the single word: ok"}]}' | jq .

# expect an Anthropic-shaped response: { "content": [ { "type": "text", "text": "ok" } ], ... }
```

Then exercise the app end-to-end (Author → PRD, Consumer → summary) at `localhost:3000`.

## Consequences

**Positive**
- **No cloud egress / no API key** — prompt data stays on the host; strong fit for
  air-gapped / regulated environments.
- **Zero application-code change** — provider is a gateway-config concern, validating the
  architecture.
- **Cost-free local iteration.**
- The multi-provider design also enables a **hybrid** later (route `claude-*` to Anthropic and
  `llama*` to Ollama by model name) — e.g. local model for the cheap high-volume router, cloud
  for quality-critical PRD authoring.

**Negative / risks**
- **Model capability, not wire format, is the real constraint.** Translation is free; quality
  is not:
  - **Strict-JSON routing** (`backend/app/router.py`) — smaller local models are less reliable
    at returning clean JSON. Mitigation: Ollama supports a `format: json` / JSON-schema
    constrained-decoding option; wiring it through the router prompt/gateway is a follow-up if
    routing proves flaky. The Level-1 keyword fallback also covers router failures.
  - **Tool use / the M4 MCP loop** — local tool-calling is model-dependent and lower-fidelity
    than Claude; needs a capable model and likely more prompt scaffolding.
  - **Generation quality** for PRD authoring varies widely by model size.
- **Hardware** — local inference needs adequate GPU/RAM; latency/throughput differ from cloud.
- **Verify-before-trust** — the format translation is agentgateway's advertised behavior but
  should be smoke-tested (step 5) against the specific Ollama model before relying on it.

## Alternatives considered

- **Callers speak OpenAI format directly to Ollama (bypass gateway).** Rejected — abandons the
  single-gateway abstraction (auth, routing, observability, key handling) and touches
  `backend/`, `n8n/`, and the compiler. The gateway's translation makes this unnecessary.
- **Switch every caller to the OpenAI SDK/format through the gateway.** Rejected for the same
  reason — more blast radius than keeping one wire format and letting the gateway translate.

## Follow-ups (not part of this ADR)

- Local **embeddings** for M2/M7 (pgvector) to keep the semantic-recall path egress-free too
  (e.g. Ollama `nomic-embed-text`).
- Optional `router.py` structured-output hardening (`format: json`) for small models.
- A `make local` / compose profile that selects the Ollama gateway config automatically.
