"""
Thin client for the LLM, reached through agentgateway.

agentgateway is the single authenticated endpoint (decision 5.3/5.6). It exposes the
Anthropic Messages API at {AGENTGATEWAY_URL}/v1/messages and injects the real
ANTHROPIC_API_KEY upstream, so this process never handles the key — we point the
official Anthropic SDK at the gateway's base URL with a placeholder key.
"""
from __future__ import annotations

import anthropic

from .config import settings

# The gateway injects the upstream key; the client key here is only for the hop to
# the gateway, which does not require client auth on the internal network.
_client = anthropic.Anthropic(
    base_url=settings.agentgateway_url,
    api_key="sk-agentgateway-noauth",
)


def complete(system: str, user: str, model: str, max_tokens: int = 1024) -> str:
    """Single-turn completion → returns the concatenated text of the response."""
    msg = _client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in msg.content if block.type == "text").strip()


def ping() -> bool:
    """Best-effort reachability check for /health (does not spend tokens on the LLM)."""
    import httpx

    try:
        # Any HTTP response (even 4xx) proves the gateway is up and routing.
        httpx.get(settings.agentgateway_url, timeout=3)
        return True
    except Exception:
        return False
