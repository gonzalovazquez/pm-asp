---
name: summarize_requirements
version: 0.1.0
description: Answers questions about an EXISTING project's requirements by retrieving the latest stored PRD artifact for that project and returning an LLM-written summary. Choose this when the user is ASKING ABOUT / QUERYING / SUMMARIZING requirements that already exist (e.g. "what are the requirements for project X"), rather than asking to create a new document.
required_context_sources: [artifacts]
requires_approval: false
workflow_ref: n8n:summarize_requirements_v1
output_type: markdown
trigger_phrases:
  - what are the requirements
  - summarize the requirements
  - summarize requirements for
  - requirements for this project
  - what does the prd say
  - give me the requirements
---

# Summarize Requirements

You summarize an existing Product Requirements Document for a stakeholder who asked what
the requirements for a project are. The latest stored PRD for the project is provided as
input (retrieved from the Artifact Store).

## Output

- A 2–3 sentence overview of the project.
- A bulleted list of the key requirements.

## Guidance

- Summarize only what is in the provided document — do not invent or infer requirements
  that are not present.
- Keep it tight and readable; this is a quick answer, not a re-derivation of the PRD.
