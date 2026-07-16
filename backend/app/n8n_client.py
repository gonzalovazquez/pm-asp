"""
Trigger n8n skill workflows over their webhook endpoints.

A skill's registry entry carries a `workflow_ref` like "n8n:generate_prd_v1"; the
matching webhook path is registered by the workflow JSON in ../../n8n/. The backend
does the compute-free orchestration (route → trigger → persist); n8n runs the actual
LLM + MCP work via agentgateway.
"""
from __future__ import annotations

import httpx

from .config import settings

# skill name → n8n webhook path (matches the Webhook nodes in ../../n8n/*.json)
WEBHOOK_PATHS = {
    "generate_prd": "generate_prd",
    "summarize_requirements": "summarize_requirements",
}


def trigger(skill_name: str, payload: dict, timeout: float = 120.0) -> dict:
    path = WEBHOOK_PATHS[skill_name]
    url = f"{settings.n8n_url}/webhook/{path}"
    resp = httpx.post(url, json=payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()
