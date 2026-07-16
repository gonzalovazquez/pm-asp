"""
FastAPI backend package for the Agentic Skills Platform POC.

Importing this package makes the repo-root POC modules importable — `intent_router`
and `mock_prd_skill` live at the repo root (they are the authoritative contract /
offline reference), and the backend REUSES them rather than reimplementing the router.

The repo layout is replicated inside the Docker image (root files + skills/ at /srv,
backend at /srv/backend), so `parents[2]` resolves to the repo root both locally and
in the container.
"""
import sys
from pathlib import Path

_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
