-- ============================================================
-- Agentic Skills Platform — Data Schema (POC, single-tenant)
-- ============================================================
-- Scope: Skill Registry, Conversation Store, Artifact Store. Redis has
-- no DDL — see redis-key-patterns.md instead.
--
-- NOT included:
-- - tenant_id / Row-Level Security. Per decision 5.8, multi-tenancy is
--   explicitly deferred until M9. When that lands, every table below
--   gets a tenant_id column + RLS policy.
-- - An `executions` table (Approval/Execution outcome log). Per decision
--   5.5, n8n owns approval mechanics; a separate outcome log was flagged
--   as a maybe for later and stays deferred here rather than built now.
--
-- Requires: pgcrypto (gen_random_uuid), vector (pgvector, for the
-- Conversation Store's semantic recall).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Shared trigger: keep updated_at current on any UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. SKILL REGISTRY
-- ============================================================
-- This is OUR skill registry, not agentregistry's SKILL.md catalog.
-- See architecture decision 5.3 — agentregistry's "Skill" is a knowledge
-- bundle; this table holds the routing metadata the Intent Router needs
-- (trigger phrases, required context, approval flag, workflow reference).
-- Matches the shape of skills/generate_prd.skill.json from the POC.

CREATE TABLE skills (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        TEXT NOT NULL UNIQUE,               -- e.g. 'generate_prd'
    version                     TEXT NOT NULL DEFAULT '0.1.0',
    description                 TEXT NOT NULL,
    trigger_phrases             JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["create a prd", "write requirements for", ...]
    required_context_sources    JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["jira", "confluence"]
    requires_approval           BOOLEAN NOT NULL DEFAULT true,
    workflow_ref                TEXT NOT NULL,                      -- e.g. 'n8n:generate_prd_v1'
    output_type                 TEXT NOT NULL DEFAULT 'markdown',
    agentregistry_skill_ref     TEXT,                               -- optional pointer to an agentregistry
                                                                     -- SKILL.md bundle, "name:version"
    is_active                   BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GIN index so the router can do fast containment lookups against
-- trigger_phrases if Level 2 (semantic matching) needs a pre-filter later.
CREATE INDEX idx_skills_trigger_phrases ON skills USING GIN (trigger_phrases);
CREATE INDEX idx_skills_is_active ON skills (is_active) WHERE is_active;

CREATE TRIGGER trg_skills_updated_at
    BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE skills IS 'Our Skill Registry. Distinct from agentregistry''s SKILL.md catalog — see decision 5.3.';


-- ============================================================
-- 2. CONVERSATION STORE
-- ============================================================
-- Chat history + semantic recall. pgvector chosen per decision 5.5/5.6
-- discussion: conversation memory and approval state are different
-- concerns, this table is memory only.

CREATE TABLE conversations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL,          -- Identity Provider subject
    title        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_user_id ON conversations (user_id, updated_at DESC);

CREATE TRIGGER trg_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content          TEXT NOT NULL,
    embedding        VECTOR(1536),               -- dimension matches the embedding model in use;
                                                   -- 1536 = OpenAI text-embedding-3-small, adjust if different
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_id ON messages (conversation_id, created_at);

-- ivfflat needs ANALYZE after enough rows exist to build good lists;
-- fine to create up front for the POC, revisit list count as data grows.
CREATE INDEX idx_messages_embedding ON messages
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON COLUMN messages.embedding IS
    'Populated for semantic recall. NOT the same embedding space as any future Level 2 skill-matching index — keep those separate even if colocated in the same Postgres instance.';


-- ============================================================
-- 3. ARTIFACT STORE
-- ============================================================
-- Generated documents (PRDs, etc). Small text artifacts (markdown)
-- can live inline in `content`; larger/binary artifacts (docx, pdf)
-- store a pointer via `storage_url` instead.
--
-- NOTE: no `executions` table yet. Approval/execution-outcome logging
-- is deferred per decision 5.5 (n8n owns approval mechanics; a separate
-- outcome log for cross-run reporting was flagged as "maybe later," and
-- stays deferred rather than built now). That means artifacts link to
-- `skill_name` and `conversation_id` only for the POC. When an
-- executions table does get built (M5/M9), add `execution_id` here.

CREATE TYPE artifact_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'rejected',
    'superseded'    -- an older version, kept for history once a newer one exists
);

CREATE TABLE artifacts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
    trigger_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,  -- the user message that produced this
    skill_name        TEXT NOT NULL REFERENCES skills(name),
    artifact_type     TEXT NOT NULL DEFAULT 'markdown',   -- markdown, pdf, docx, etc.
    title             TEXT,
    content           TEXT,          -- inline for small text artifacts (e.g. markdown PRDs)
    storage_url       TEXT,          -- pointer to blob storage for larger/binary artifacts
    version           INT NOT NULL DEFAULT 1,
    status            artifact_status NOT NULL DEFAULT 'draft',
    created_by        TEXT,          -- user_id
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_artifact_has_content CHECK (content IS NOT NULL OR storage_url IS NOT NULL)
);

CREATE INDEX idx_artifacts_conversation_id ON artifacts (conversation_id);
CREATE INDEX idx_artifacts_skill_name ON artifacts (skill_name);
CREATE INDEX idx_artifacts_status ON artifacts (status);

CREATE TRIGGER trg_artifacts_updated_at
    BEFORE UPDATE ON artifacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE artifacts IS 'Generated outputs (e.g. PRDs). One row per version — never overwrite, insert a new version and mark the old one superseded. No execution_id yet — see note above.';


-- ============================================================
-- 4. SEED — Skill Registry rows for the POC skills
-- ============================================================
-- The Intent Router reads the JSON files in skills/ for the POC (M6 moves
-- routing to this table). We still seed the rows so the artifacts.skill_name
-- foreign key is satisfiable and so the table is demonstrable. Keep in sync
-- with skills/*.skill.json.

INSERT INTO skills (name, version, description, trigger_phrases, required_context_sources, requires_approval, workflow_ref, output_type)
VALUES
  ('generate_prd', '0.1.0',
   'Generates a first-draft PRD for a named project by pulling context from Jira, Confluence and GitHub via MCP and writing it up with an LLM.',
   '["create a prd", "generate a prd", "write a prd", "write requirements for", "draft a prd", "prd for project"]'::jsonb,
   '["jira", "confluence", "github"]'::jsonb,
   true, 'n8n:generate_prd_v1', 'markdown'),
  ('summarize_requirements', '0.1.0',
   'Answers questions about an existing project by retrieving its latest stored PRD artifact and returning an LLM-written summary.',
   '["what are the requirements", "summarize the requirements", "summarize requirements for", "requirements for this project", "what does the prd say", "give me the requirements"]'::jsonb,
   '["artifacts"]'::jsonb,
   false, 'n8n:summarize_requirements_v1', 'markdown')
ON CONFLICT (name) DO NOTHING;
