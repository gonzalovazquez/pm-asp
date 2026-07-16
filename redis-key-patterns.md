# Redis key patterns

Redis has no schema in the relational sense. This file is the reference for the
key patterns, data structures, and TTLs the platform uses. Kept alongside
`schema.sql` (the Postgres DDL) as the Cache/Session-layer contract.

| Key pattern | Data structure | Purpose | TTL |
|---|---|---|---|
| `session:{session_id}` | Hash: `{user_id, conversation_id, created_at}` | Active chat session lookup | 24h, sliding |
| `stream:{execution_id}` | List / Redis Stream of response chunks | Buffers a streaming response so the Chat UI can resume a dropped connection | 10 min |
| `approvals:pending` | Sorted set, member = an n8n execution reference, score = enqueued-at epoch | Fast "what's pending approval" lookup. No `executions` table exists (deferred), so n8n writes/clears this key directly on entering/leaving its wait node — not derived from Postgres for now | No TTL, removed on transition out of the wait node |
| `ratelimit:{user_id}:{window}` | String counter (INCR) | App-level throttling of skill invocations — distinct from agentgateway's own LLM/MCP rate limiting | Matches `{window}` |
| `router:cache:{query_hash}` | String (serialized execution plan) | Optional cache for duplicate queries; not needed while Level 1 is pure keyword matching, more useful once Level 2 embeddings exist (or, in this build, once the LLM router is the default and calls cost money) | 1h, invalidate on `skills` writes |

## Notes

- **`approvals:pending` is currently the only queryable approval index outside n8n itself.**
  With no `executions` table, if this key is lost the only recovery path is n8n's own
  execution history, not a Postgres rebuild — worth remembering if that becomes a compliance
  concern before M9.
- No tenant scoping yet (consistent with decision 5.8) — every key gets a `{tenant_id}`
  segment at M9.
- **POC build status:** `session:{session_id}` is implemented by the FastAPI backend
  (`backend/app/cache.py`). `stream:*` (streaming, M2), `approvals:pending` (n8n wait
  nodes, M5), `ratelimit:*` and `router:cache:*` are documented seams, not yet wired.
