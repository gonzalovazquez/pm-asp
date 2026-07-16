# Skills — authoring & compilation

A skill is a folder under `skills/` containing a **`SKILL.md`**. The compiler turns each
`SKILL.md` into a **`<name>.skill.json`** registry entry (the flat files the Intent Router
loads). This keeps human-authored skills (`SKILL.md`, with body/knowledge) as the source of
truth and the JSON as a generated artifact.

```
skills/
├── generate_prd/SKILL.md              # source (frontmatter + knowledge body)
├── generate_prd.skill.json            # generated — the router reads this
├── summarize_requirements/SKILL.md
├── summarize_requirements.skill.json  # generated
├── _template/SKILL.md                 # copy this to start a new skill (skipped by compiler)
└── README.md
```

## Why a compiler (not just SKILL.md)

Standard `SKILL.md` frontmatter has only `name` + `description`. Our Intent Router needs
**routing metadata** a knowledge bundle doesn't carry — `trigger_phrases`,
`required_context_sources`, `requires_approval`, `workflow_ref` (see `CLAUDE.md` decision
5.3, "agentregistry's Skill ≠ our Skill"). So we **extend the frontmatter** with those
fields, and the compiler emits the registry JSON.

## Add a skill

1. `cp -r skills/_template skills/<your_skill>` and edit `SKILL.md`:
   - **Standard:** `name`, `version`, `description` (write the description so the LLM router
     can tell *when* to pick it — include the verbs a user would use).
   - **Routing:** `required_context_sources`, `requires_approval`, `workflow_ref`,
     `output_type`.
   - **`trigger_phrases`:** optional — see below.
   - **Body:** the skill's instructions/knowledge (becomes `instructions_path`; a workflow
     can load it as the prompt).
2. Add the matching **n8n workflow** (`n8n/<name>_v1.json`, webhook path `<name>`) and a
   **dispatch branch** in `backend/app/main.py`.
3. Compile:
   ```bash
   python3 tools/compile_skills.py            # use authored trigger_phrases
   python3 tools/compile_skills.py --generate # LLM-generate phrases where omitted
   python3 tools/compile_skills.py --check     # CI: fail if any JSON is stale
   ```

## Where trigger_phrases come from

Resolution order (per skill):

1. **Authored** in `SKILL.md` frontmatter — deterministic, preferred.
2. **LLM-generated** from the `description` (via agentgateway) when you run `--generate` and
   leave `trigger_phrases` out. Needs `AGENTGATEWAY_URL` reachable + a key.
3. **Heuristic** fallback (derived from the name) with a warning — so the compile still
   succeeds offline.

Because the **LLM router reads `description` at runtime**, `trigger_phrases` mostly feed the
**Level-1 keyword fallback** — so auto-generating them is safe; hand-author them only when
you want precise control of the offline path.

> **Roadmap (M6):** "skill registry as a service" — the same compiler will `UPSERT` these
> entries into the Postgres `skills` table instead of (or in addition to) writing JSON, and
> the router will read from the table. The `SKILL.md` → registry pipeline stays the same.
