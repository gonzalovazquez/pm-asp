"""Environment-driven settings for the backend."""
import os
from dataclasses import dataclass


def _bool(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    database_url: str = os.environ.get(
        "DATABASE_URL", "postgresql://asp:asp_dev_pw@localhost:5432/asp"
    )
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

    # agentgateway serves Anthropic at {url}/v1/messages (native Messages format).
    # The anthropic SDK appends /v1/messages, so this is the bare base URL.
    agentgateway_url: str = os.environ.get("AGENTGATEWAY_URL", "http://localhost:8080")
    n8n_url: str = os.environ.get("N8N_URL", "http://localhost:5678")

    # OFFLINE_MODE=1 → Level-1 keyword router + canned skill runtimes, no LLM/MCP/n8n.
    offline_mode: bool = _bool("OFFLINE_MODE", "1")

    router_model: str = os.environ.get("ROUTER_MODEL", "claude-haiku-4-5-20251001")
    prd_model: str = os.environ.get("PRD_MODEL", "claude-sonnet-5")

    frontend_origin: str = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")


settings = Settings()
