"""
Redis session cache — implements the `session:{session_id}` key from
redis-key-patterns.md (24h sliding TTL). Other documented keys (streaming buffers,
approvals:pending, rate limiting, router cache) are seams for later milestones.
"""
from __future__ import annotations

import time
from typing import Optional

import redis

from .config import settings

_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)

_SESSION_TTL = 24 * 60 * 60  # 24h, refreshed on each touch (sliding)


def ping() -> bool:
    try:
        return bool(_client.ping())
    except Exception:
        return False


def touch_session(session_id: str, user_id: str, conversation_id: str) -> None:
    key = f"session:{session_id}"
    _client.hset(key, mapping={
        "user_id": user_id,
        "conversation_id": conversation_id,
        "created_at": _client.hget(key, "created_at") or str(int(time.time())),
    })
    _client.expire(key, _SESSION_TTL)
