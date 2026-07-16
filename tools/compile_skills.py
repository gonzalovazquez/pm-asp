#!/usr/bin/env python3
"""
Skill compiler: SKILL.md  ->  <name>.skill.json (our Skill Registry entry).

Each skill is a folder under skills/ containing a SKILL.md whose YAML frontmatter
carries BOTH the standard Claude/agentregistry fields (name, description) AND our
routing metadata (see decision 5.3 in CLAUDE.md — agentregistry's SKILL.md has no
concept of required context sources / approval flags / workflow refs, so we extend
the frontmatter):

    ---
    name: generate_prd
    version: 0.1.0
    description: One-line description the LLM router reads to pick this skill.
    required_context_sources: [jira, confluence, github]
    requires_approval: true
    workflow_ref: n8n:generate_prd_v1
    output_type: markdown
    trigger_phrases:            # OPTIONAL — auto-generated from the description if omitted
      - create a prd
      - draft a prd
    ---
    <the SKILL.md body: instructions/knowledge used as the skill's prompt content>

Output: skills/<name>.skill.json (flat, so intent_router's `skills/*.skill.json`
glob keeps finding them), plus an `instructions_path` pointer back to the SKILL.md.

trigger_phrases resolution order:
  1. frontmatter `trigger_phrases` if present (deterministic — preferred)
  2. LLM-generated from the description (via agentgateway) when --generate and the
     gateway is reachable
  3. stdlib heuristic (name + key description words) with a warning

Usage:
  python3 tools/compile_skills.py                # compile all, use frontmatter phrases
  python3 tools/compile_skills.py --generate     # LLM-generate phrases where missing
  python3 tools/compile_skills.py --check         # CI: fail if any .skill.json is stale

Stdlib-only (no external deps) so it runs anywhere.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "skills"

REQUIRED_FIELDS = ("name", "description", "workflow_ref")
# Emit keys in this order for clean, stable diffs.
KEY_ORDER = ("name", "version", "description", "trigger_phrases",
             "required_context_sources", "requires_approval", "workflow_ref",
             "output_type", "instructions_path")


# --------------------------------------------------------------------------- #
# Minimal YAML-frontmatter parser (subset: scalars, inline lists, block lists)
# --------------------------------------------------------------------------- #
def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def _scalar(s: str):
    s = s.strip()
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1].strip()
        return [_unquote(x) for x in inner.split(",")] if inner else []
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    if s.isdigit():
        return int(s)
    return _unquote(s)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (metadata, body). Frontmatter is the block between the first two --- lines."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing '---' frontmatter opener")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("missing '---' frontmatter closer")

    block, body = lines[1:end], "\n".join(lines[end + 1:]).strip()
    meta: dict = {}
    i = 0
    while i < len(block):
        raw = block[i]
        i += 1
        if not raw.strip() or raw.strip().startswith("#") or ":" not in raw:
            continue
        key, _, rest = raw.partition(":")
        key, rest = key.strip(), rest.strip()
        if rest == "":
            # block list: subsequent `- item` lines
            items = []
            while i < len(block) and block[i].strip().startswith("-"):
                item = block[i].strip()[1:].strip()
                if item and not item.startswith("#"):
                    items.append(_unquote(item))
                i += 1
            meta[key] = items
        else:
            # strip trailing inline comment for unquoted/non-list scalars
            if rest[0] not in "\"'[":
                hp = rest.find(" #")
                if hp != -1:
                    rest = rest[:hp].strip()
            meta[key] = _scalar(rest)
    return meta, body


# --------------------------------------------------------------------------- #
# trigger_phrases generation
# --------------------------------------------------------------------------- #
def heuristic_phrases(name: str, description: str) -> list[str]:
    base = name.replace("_", " ").strip().lower()
    phrases = {base}
    verb = base.split(" ", 1)[0]
    rest = base[len(verb):].strip()
    for v in ("create", "generate", "write", "draft"):
        if verb in ("generate", "create", "write", "draft", "make", "build") and rest:
            phrases.add(f"{v} {rest}")
    return sorted(phrases)


def llm_phrases(name: str, description: str) -> list[str]:
    """Ask Claude (via agentgateway) for trigger phrases. Stdlib HTTP; raises on failure."""
    url = os.environ.get("AGENTGATEWAY_URL", "http://localhost:8080").rstrip("/") + "/v1/messages"
    model = os.environ.get("ROUTER_MODEL", "claude-haiku-4-5-20251001")
    system = (
        "You produce trigger phrases for an intent router. Given a skill name and "
        "description, return ONLY a JSON array of 5-8 short, lowercase phrases a user "
        "might type that should route to this skill. No prose, no code fences."
    )
    payload = {
        "model": model,
        "max_tokens": 300,
        "system": system,
        "messages": [{"role": "user", "content": f"name: {name}\ndescription: {description}"}],
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-api-key": "sk-agentgateway-noauth"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1].lstrip("json").strip()
    phrases = json.loads(text)
    return [str(p).strip().lower() for p in phrases if str(p).strip()]


# --------------------------------------------------------------------------- #
# compile
# --------------------------------------------------------------------------- #
def compile_one(skill_md: Path, generate: bool) -> tuple[str, dict]:
    meta, _body = parse_frontmatter(skill_md.read_text())
    missing = [f for f in REQUIRED_FIELDS if not meta.get(f)]
    if missing:
        raise ValueError(f"{skill_md}: missing required frontmatter field(s): {missing}")

    name = meta["name"]
    phrases = meta.get("trigger_phrases") or []
    if not phrases:
        if generate:
            try:
                phrases = llm_phrases(name, meta["description"])
                print(f"  · {name}: generated {len(phrases)} trigger phrases via LLM")
            except Exception as exc:
                phrases = heuristic_phrases(name, meta["description"])
                print(f"  ! {name}: LLM generation failed ({exc}); used heuristic phrases",
                      file=sys.stderr)
        else:
            phrases = heuristic_phrases(name, meta["description"])
            print(f"  ! {name}: no trigger_phrases in frontmatter; used heuristic "
                  f"(author them, or run with --generate)", file=sys.stderr)

    entry = {
        "name": name,
        "version": str(meta.get("version", "0.1.0")),
        "description": meta["description"],
        "trigger_phrases": phrases,
        "required_context_sources": meta.get("required_context_sources", []),
        "requires_approval": bool(meta.get("requires_approval", False)),
        "workflow_ref": meta["workflow_ref"],
        "output_type": meta.get("output_type", "markdown"),
        "instructions_path": os.path.relpath(skill_md, REPO_ROOT),
    }
    ordered = {k: entry[k] for k in KEY_ORDER if k in entry}
    return name, ordered


def main() -> int:
    ap = argparse.ArgumentParser(description="Compile SKILL.md files into *.skill.json registry entries.")
    ap.add_argument("--generate", action="store_true", help="LLM-generate trigger phrases when absent")
    ap.add_argument("--check", action="store_true", help="fail if any output is stale (CI)")
    args = ap.parse_args()

    # Sources: skills/<name>/SKILL.md (skip folders starting with '_', e.g. templates).
    sources = sorted(p for p in SKILLS_DIR.glob("*/SKILL.md") if not p.parent.name.startswith("_"))
    if not sources:
        print("No SKILL.md sources found under skills/*/SKILL.md", file=sys.stderr)
        return 1

    stale = []
    for src in sources:
        name, entry = compile_one(src, generate=args.generate)
        out_path = SKILLS_DIR / f"{name}.skill.json"
        new_text = json.dumps(entry, indent=2) + "\n"
        if args.check:
            old = out_path.read_text() if out_path.exists() else ""
            if old != new_text:
                stale.append(out_path.name)
        else:
            out_path.write_text(new_text)
            print(f"  ✓ {src.relative_to(REPO_ROOT)} -> {out_path.name}")

    if args.check:
        if stale:
            print(f"STALE (run compile_skills.py): {', '.join(stale)}", file=sys.stderr)
            return 1
        print("All *.skill.json are up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
