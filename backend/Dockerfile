# Backend image. Replicates the repo layout so the root POC modules
# (intent_router.py, mock_prd_skill.py) and skills/ are importable exactly as they are
# locally: root files + skills/ at /srv, the FastAPI app at /srv/backend.
FROM python:3.12-slim

WORKDIR /srv/backend

# Deps first for layer caching.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Repo-root reference modules + skill registry (paths must match app/__init__.py's
# parents[2] == /srv assumption).
COPY intent_router.py mock_prd_skill.py /srv/
COPY skills /srv/skills

# Backend application code.
COPY backend/app /srv/backend/app

# /srv on the path so `import intent_router` / `import mock_prd_skill` resolve.
ENV PYTHONPATH=/srv
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
