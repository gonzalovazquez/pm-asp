"""
FastAPI app: API Gateway + Intent Router entry point + Skill dispatcher.

Endpoints:
  GET  /health        — Postgres + Redis (+ gateway) reachability
  GET  /api/skills    — the loaded skill registry
  POST /api/chat      — route a message, dispatch the skill, persist, reply

Journeys:
  1. generate_prd            → (real) n8n workflow builds a PRD via Claude+MCP through
                               agentgateway; (offline) canned mock_prd_skill. Persisted
                               as an artifact (status pending_approval).
  2. summarize_requirements  → retrieve the latest stored PRD for the project and return
                               an LLM summary (real: n8n; offline: naive extract).
"""
from __future__ import annotations

import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import intent_router  # repo-root reference impl (registry loader lives here)
import mock_prd_skill  # offline generate_prd runtime + project-name extractor

from . import cache, db, gateway, n8n_client, router
from .config import settings
from .schemas import ArtifactOut, ChatRequest, ChatResponse

app = FastAPI(title="Agentic Skills Platform — POC backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.pool.open()


@app.get("/health")
def health() -> dict:
    pg = db.ping()
    rd = cache.ping()
    status = "ok" if (pg and rd) else "degraded"
    return {
        "status": status,
        "postgres": pg,
        "redis": rd,
        "agentgateway": gateway.ping() if not settings.offline_mode else "skipped (offline)",
        "offline_mode": settings.offline_mode,
    }


@app.get("/api/skills")
def skills() -> dict:
    return {"skills": intent_router.load_skill_registry()}


def _run_generate_prd(message: str, conversation_id: str) -> tuple[str, str, str]:
    """Return (project, markdown, artifact_status)."""
    project = mock_prd_skill.extract_project_name(message)
    if settings.offline_mode:
        result = mock_prd_skill.run(message)
        return result["project_name"], result["output_markdown"], "pending_approval"
    result = n8n_client.trigger("generate_prd", {
        "project": project,
        "message": message,
        "conversation_id": conversation_id,
    })
    markdown = result.get("markdown") or result.get("output_markdown") or ""
    return result.get("project", project), markdown, "pending_approval"


def _offline_summary(project: str, content: str) -> str:
    """Naive offline summary: title + section headings + first bullet of each."""
    lines = [ln.rstrip() for ln in content.splitlines()]
    picked: list[str] = []
    for ln in lines:
        if ln.startswith("#") or ln.strip().startswith("- "):
            picked.append(ln)
        if len(picked) >= 12:
            break
    body = "\n".join(picked) if picked else content[:600]
    return (f"**Requirements summary for {project}** (offline extract — no LLM):\n\n"
            f"{body}")


def _run_summarize(project: str, content: str) -> str:
    if settings.offline_mode:
        return _offline_summary(project, content)
    result = n8n_client.trigger("summarize_requirements", {
        "project": project,
        "content": content,
    })
    return result.get("summary", "")


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    conversation_id = db.ensure_conversation(req.conversation_id, req.user_id,
                                             title=req.message[:80])
    user_msg_id = db.insert_message(conversation_id, "user", req.message)

    plan = router.route(req.message)
    artifact_out = None
    reply: str

    if plan["status"] == "matched" and plan["skill"] == "generate_prd":
        project, markdown, status = _run_generate_prd(req.message, conversation_id)
        art = db.insert_artifact(
            conversation_id=conversation_id, trigger_message_id=user_msg_id,
            skill_name="generate_prd", title=project, content=markdown,
            status=status, created_by=req.user_id,
        )
        artifact_out = ArtifactOut(**art)
        reply = markdown

    elif plan["status"] == "matched" and plan["skill"] == "summarize_requirements":
        project = mock_prd_skill.extract_project_name(req.message)
        stored = db.latest_artifact_for_project(project)
        if not stored:
            reply = (f"I couldn't find a stored PRD for **{project}**. Ask someone to "
                     f"create one first (e.g. \"create a PRD for project {project}\").")
        else:
            reply = _run_summarize(project, stored["content"])

    elif plan["status"] == "ambiguous":
        reply = (f"That could match a few skills: {', '.join(plan['candidates'])}. "
                 f"Could you be more specific?")

    else:  # no_match, or matched skill with no runtime wired
        reply = ("I don't have a skill for that yet. Try asking me to *create a PRD for "
                 "project X*, or *what are the requirements for project X*.")

    db.insert_message(conversation_id, "assistant", reply, metadata={"plan": plan})

    session_id = req.conversation_id or conversation_id
    try:
        cache.touch_session(session_id, req.user_id, conversation_id)
    except Exception:
        pass  # session cache is best-effort

    return ChatResponse(conversation_id=conversation_id, plan=plan, reply=reply,
                        artifact=artifact_out)
