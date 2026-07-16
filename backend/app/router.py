"""
Intent Router.

Primary path (real mode): an LLM (Claude via agentgateway) reads the user's message
plus the skills registry and picks the best-matching skill. This departs from the
documented Level-1 keyword router by product decision — but the execution-plan
CONTRACT is preserved exactly:

    {skill, context_sources, requires_approval, status, candidates}
    status ∈ matched | no_match | ambiguous

Fallback path: the zero-dependency Level-1 router (`intent_router.route`) is used when
OFFLINE_MODE is set, or whenever the LLM call fails — so routing degrades gracefully
rather than erroring.
"""
from __future__ import annotations

import json
from typing import Optional

import intent_router  # repo-root reference impl (Level 1 + registry loader)

from .config import settings
from . import gateway

_SYSTEM = (
    "You are the intent router for an agentic product-management platform. "
    "Given the catalog of available skills and a user's message, choose the single "
    "best-matching skill, or decide there is no match, or that it is ambiguous.\n\n"
    "Respond with ONLY a JSON object, no prose, no code fences, of the form:\n"
    '{\"skill\": <skill name string or null>, '
    '\"status\": \"matched\" | \"no_match\" | \"ambiguous\", '
    '\"candidates\": [<skill name strings>]}\n\n'
    "Rules: use \"matched\" with a non-null skill when exactly one skill clearly fits; "
    "\"no_match\" with skill=null when none fit; \"ambiguous\" with skill=null and 2+ "
    "candidates when several fit equally. Only ever use skill names from the catalog."
)


def _plan_from_skill(skill: dict) -> dict:
    return {
        "skill": skill["name"],
        "context_sources": skill["required_context_sources"],
        "requires_approval": skill["requires_approval"],
        "status": "matched",
        "candidates": [],
    }


def _no_match() -> dict:
    return {"skill": None, "context_sources": [], "requires_approval": False,
            "status": "no_match", "candidates": []}


def _ambiguous(candidates: list[str]) -> dict:
    return {"skill": None, "context_sources": [], "requires_approval": False,
            "status": "ambiguous", "candidates": candidates}


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        # strip ```json ... ``` fences if the model added them
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def _llm_route(message: str, registry: list[dict]) -> dict:
    catalog = "\n".join(
        f"- {s['name']}: {s['description']}" for s in registry
    )
    user = f"Skills catalog:\n{catalog}\n\nUser message:\n{message}"
    raw = gateway.complete(_SYSTEM, user, model=settings.router_model, max_tokens=400)
    parsed = _parse_json(raw)

    by_name = {s["name"]: s for s in registry}
    status = parsed.get("status")
    chosen = parsed.get("skill")

    if status == "matched" and chosen in by_name:
        return _plan_from_skill(by_name[chosen])
    if status == "ambiguous":
        cands = [c for c in (parsed.get("candidates") or []) if c in by_name]
        return _ambiguous(cands or list(by_name)[:2])
    return _no_match()


def route(message: str, registry: Optional[list[dict]] = None) -> dict:
    """Return the execution plan for a message, preserving the router contract."""
    registry = registry if registry is not None else intent_router.load_skill_registry()

    if settings.offline_mode:
        return intent_router.route(message, registry)

    try:
        return _llm_route(message, registry)
    except Exception as exc:  # LLM/gateway unreachable or bad output → Level-1 fallback
        plan = intent_router.route(message, registry)
        plan["_router_note"] = f"LLM router failed ({exc}); used Level-1 fallback"
        return plan
