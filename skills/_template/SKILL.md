---
# ============================================================
# TEMPLATE — copy this folder to skills/<your_skill>/ and edit.
# The compiler SKIPS folders whose name starts with "_", so this
# template is never emitted as a live skill.
# ============================================================

# --- Standard fields (Claude / agentregistry SKILL.md) ---
name: identify_risks                 # unique; becomes <name>.skill.json
version: 0.1.0
description: One sentence the LLM router reads to decide when to pick this skill. Say what it does AND when to choose it (verbs the user would use).

# --- Our routing metadata (NOT part of standard SKILL.md — see CLAUDE.md decision 5.3) ---
required_context_sources: [jira, confluence]   # which context this skill needs
requires_approval: false                       # gate the artifact behind human approval?
workflow_ref: n8n:identify_risks_v1            # the n8n workflow this skill dispatches to
output_type: markdown

# --- OPTIONAL: omit to auto-generate from the description ---
# trigger_phrases:
#   - identify risks
#   - what are the risks for
---

# <Skill title>

The body is the skill's knowledge/instructions — used as the prompt content when the
workflow authors the artifact. Structure it however the skill needs (sections, examples,
references). The compiler records a pointer to this file as `instructions_path`.
