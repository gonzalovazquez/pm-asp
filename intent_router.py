"""
Level 1 intent router: rule-based, keyword/phrase matching only.

This is deliberately the dumbest possible router. No LLM call, no embeddings.
It exists to prove the router -> execution plan -> skill runtime contract
end to end before Level 2 (semantic matching) or Level 3 (planner) get built.

NOTE (POC build): the running platform now routes with an LLM (see
backend/app/router.py) per an explicit product decision. This module is kept
as (a) the zero-dependency reference implementation of the execution-plan
CONTRACT and (b) the offline fallback the backend uses when OFFLINE_MODE is set
or the LLM gateway is unreachable. Do not change the return shape without
updating schema.sql, the backend, CLAUDE.md, and the Notion doc together.

Contract: given a user message, return a standard execution plan:
  {
    "skill": <skill name or None>,
    "context_sources": [...],
    "requires_approval": bool,
    "status": "matched" | "no_match" | "ambiguous",
    "candidates": [...]  # only populated when ambiguous
  }
"""
import json
import re
from pathlib import Path
from typing import Optional

SKILLS_DIR = Path(__file__).parent / "skills"


def _normalize(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def load_skill_registry(skills_dir: Path = SKILLS_DIR) -> list[dict]:
    """Loads every *.skill.json file in the skills directory."""
    registry = []
    for path in sorted(skills_dir.glob("*.skill.json")):
        with open(path) as f:
            registry.append(json.load(f))
    return registry


def route(message: str, registry: Optional[list[dict]] = None) -> dict:
    """Level 1 rule-based routing: does any skill's trigger phrase appear in the message."""
    registry = registry if registry is not None else load_skill_registry()
    normalized = _normalize(message)

    matches = []
    for skill in registry:
        for phrase in skill["trigger_phrases"]:
            if _normalize(phrase) in normalized:
                matches.append(skill)
                break  # one hit is enough to count this skill as matched

    if len(matches) == 1:
        skill = matches[0]
        return {
            "skill": skill["name"],
            "context_sources": skill["required_context_sources"],
            "requires_approval": skill["requires_approval"],
            "status": "matched",
            "candidates": [],
        }
    elif len(matches) == 0:
        return {
            "skill": None,
            "context_sources": [],
            "requires_approval": False,
            "status": "no_match",
            "candidates": [],
        }
    else:
        return {
            "skill": None,
            "context_sources": [],
            "requires_approval": False,
            "status": "ambiguous",
            "candidates": [s["name"] for s in matches],
        }


if __name__ == "__main__":
    test_queries = [
        "create a PRD for project Atlas",
        "write requirements for a new payments platform",
        "what's the weather today",
    ]
    for q in test_queries:
        print(f"> {q}")
        print(route(q))
        print()
