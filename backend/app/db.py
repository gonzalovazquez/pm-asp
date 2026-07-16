"""
Postgres persistence for the Conversation Store and Artifact Store (schema.sql).

Uses a psycopg3 connection pool; endpoint handlers are sync `def`, so FastAPI runs
them in its threadpool. Kept intentionally small — this is the POC data layer.
"""
from __future__ import annotations

from typing import Optional

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# `open=False` + explicit open() in main's startup avoids connecting at import time
# (so the module imports even before Postgres is reachable).
pool = ConnectionPool(settings.database_url, min_size=1, max_size=5, open=False,
                      kwargs={"row_factory": dict_row})


def ping() -> bool:
    try:
        with pool.connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


def ensure_conversation(conversation_id: Optional[str], user_id: str,
                        title: Optional[str] = None) -> str:
    """Return an existing conversation id, or create a new one."""
    with pool.connection() as conn:
        if conversation_id:
            row = conn.execute(
                "SELECT id FROM conversations WHERE id = %s", (conversation_id,)
            ).fetchone()
            if row:
                return str(row["id"])
        row = conn.execute(
            "INSERT INTO conversations (user_id, title) VALUES (%s, %s) RETURNING id",
            (user_id, title),
        ).fetchone()
        return str(row["id"])


def insert_message(conversation_id: str, role: str, content: str,
                   metadata: Optional[dict] = None) -> str:
    import json as _json
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO messages (conversation_id, role, content, metadata) "
            "VALUES (%s, %s, %s, %s::jsonb) RETURNING id",
            (conversation_id, role, content, _json.dumps(metadata or {})),
        ).fetchone()
        return str(row["id"])


def insert_artifact(*, conversation_id: str, trigger_message_id: Optional[str],
                    skill_name: str, title: str, content: str, status: str,
                    created_by: str) -> dict:
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO artifacts (conversation_id, trigger_message_id, skill_name, "
            "title, content, status, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, title, status, version, created_at",
            (conversation_id, trigger_message_id, skill_name, title, content, status,
             created_by),
        ).fetchone()
        return {
            "id": str(row["id"]),
            "title": row["title"],
            "status": row["status"],
            "version": row["version"],
        }


def latest_artifact_for_project(project: str) -> Optional[dict]:
    """Most recent generate_prd artifact whose title matches the project name."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, title, content FROM artifacts "
            "WHERE skill_name = 'generate_prd' AND lower(title) = lower(%s) "
            "ORDER BY created_at DESC LIMIT 1",
            (project,),
        ).fetchone()
        if not row:
            return None
        return {"id": str(row["id"]), "title": row["title"], "content": row["content"]}
