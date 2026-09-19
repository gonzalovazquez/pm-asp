-- ============================================================
-- Agentic Skills Platform — Value Spine (PROPOSED, not applied)
-- ============================================================
-- Domain layer above the existing skill-execution schema: lines of
-- business, initiatives, the OKR/KPI ladder, the prescriptive stage
-- sequence, value results and capacity.
--
-- See docs/value-spine.md for the rationale. Nothing in backend/ reads
-- these tables yet. Apply after schema.sql.
--
-- Consistent with existing decisions:
-- - No tenant_id / RLS. Multi-tenancy is still M9 (decision 5).
-- - No executions table. n8n still owns approval mechanics (decision 4).
--   `acceptance_criteria` below is an evaluation contract on a stage's
--   OUTPUT, which is a different concern from approving a RUN.
-- - The router contract {skill, context_sources, requires_approval,
--   status, candidates} is untouched. Stages reference skills by name;
--   they do not redefine how skills are selected.
-- ============================================================


-- ============================================================
-- 1. LINES OF BUSINESS + STAKEHOLDERS
-- ============================================================
-- The "customer" is almost always an internal line of business, so this
-- is a stakeholder/demand registry, not a sales CRM.

CREATE TABLE lines_of_business (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL UNIQUE,        -- e.g. 'Wealth Management'
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_lob_updated_at
    BEFORE UPDATE ON lines_of_business
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE stakeholders (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_of_business_id   UUID NOT NULL REFERENCES lines_of_business(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    title                 TEXT,
    user_id               TEXT,              -- Identity Provider subject, when they have one
    is_primary            BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stakeholders_lob ON stakeholders (line_of_business_id);

COMMENT ON TABLE stakeholders IS
    'Named contacts inside a line of business. Value evidence is attributed to one of these rows — an unattributed testimonial is not evidence.';


-- ============================================================
-- 2. OKR LADDER
-- ============================================================
-- One objective holds several key results. A key result IS the KPI:
-- a unit, a baseline and a target. Initiatives commit to key results.

CREATE TYPE measurement_kind AS ENUM (
    'quantitative',   -- the number is reachable from a system we can query
    'qualitative',    -- the number lives with another team; capture by interview
    'both'
);

CREATE TABLE objectives (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_of_business_id   UUID NOT NULL REFERENCES lines_of_business(id) ON DELETE CASCADE,
    statement             TEXT NOT NULL,     -- 'Become the easiest place to start a wealth relationship'
    period                TEXT,              -- 'FY2026'
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_objectives_lob ON objectives (line_of_business_id);

CREATE TRIGGER trg_objectives_updated_at
    BEFORE UPDATE ON objectives
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE key_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    objective_id        UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,       -- 'Average client onboarding time'
    unit                TEXT NOT NULL,       -- 'days', 'percent', 'CAD', 'hours/year'
    baseline_value      NUMERIC,
    target_value        NUMERIC,
    direction           TEXT NOT NULL DEFAULT 'decrease'
                            CHECK (direction IN ('increase', 'decrease')),
    measured_by         measurement_kind NOT NULL DEFAULT 'both',
    quantitative_source TEXT,                -- where the number comes from, when it is reachable
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_key_results_objective ON key_results (objective_id);

CREATE TRIGGER trg_key_results_updated_at
    BEFORE UPDATE ON key_results
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 3. INITIATIVES
-- ============================================================
-- The unit of product work. Jira is the system of record underneath:
-- jira_key is written by the platform, and the TPM never opens Jira.

CREATE TYPE initiative_kind AS ENUM ('new', 'enhancement');

CREATE TYPE initiative_status AS ENUM (
    'intake',
    'in_delivery',
    'live',
    'value_review_due',
    'value_proven',
    'cancelled'
);

CREATE TABLE initiatives (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_of_business_id   UUID NOT NULL REFERENCES lines_of_business(id),
    requested_by          UUID REFERENCES stakeholders(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    problem_statement     TEXT,              -- captured at intake, in the requester's terms
    kind                  initiative_kind NOT NULL DEFAULT 'new',
    parent_initiative_id  UUID REFERENCES initiatives(id) ON DELETE SET NULL,
    jira_key              TEXT,              -- e.g. 'WEALTH-1182' — written, not shown
    status                initiative_status NOT NULL DEFAULT 'intake',
    launched_on           DATE,
    owner_user_id         TEXT,              -- the TPM
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- An enhancement names its parent; a new initiative must not.
    CONSTRAINT chk_enhancement_has_parent CHECK (
        (kind = 'enhancement' AND parent_initiative_id IS NOT NULL)
        OR (kind = 'new' AND parent_initiative_id IS NULL)
    )
);

CREATE INDEX idx_initiatives_lob ON initiatives (line_of_business_id, status);
CREATE INDEX idx_initiatives_parent ON initiatives (parent_initiative_id);

CREATE TRIGGER trg_initiatives_updated_at
    BEFORE UPDATE ON initiatives
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN initiatives.parent_initiative_id IS
    'An enhancement inherits its parent''s objective, key results and stakeholders. Classifying at intake buys the TPM less work, not more.';


-- The hypothesis: which key results this initiative commits to moving,
-- with the baseline and target as committed AT THAT TIME (the key_results
-- row may move later; the commitment must not).
CREATE TABLE initiative_key_results (
    initiative_id      UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    key_result_id      UUID NOT NULL REFERENCES key_results(id) ON DELETE CASCADE,
    committed_baseline NUMERIC,
    committed_target   NUMERIC,
    committed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (initiative_id, key_result_id)
);


-- ============================================================
-- 4. THE PRESCRIPTIVE STAGE SEQUENCE
-- ============================================================
-- Seven stages, fixed order. Stages an initiative does not need are
-- hidden (is_hidden), never deleted — the sequence is the standard.

CREATE TYPE lifecycle_stage AS ENUM (
    'intake',
    'objective_and_kpis',
    'requirements',
    'plan_and_business_case',
    'engineering_handoff',
    'launch',
    'value_review'
);

CREATE TYPE stage_state AS ENUM ('not_started', 'in_progress', 'awaiting_review', 'complete', 'skipped');

CREATE TYPE owner_kind AS ENUM ('human', 'agent');

CREATE TABLE initiative_stages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiative_id       UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    stage               lifecycle_stage NOT NULL,
    sequence            INT NOT NULL,
    state               stage_state NOT NULL DEFAULT 'not_started',
    is_hidden           BOOLEAN NOT NULL DEFAULT false,

    -- The join to the execution layer. A stage is WHAT must be true;
    -- a skill is ONE WAY to make it true. Nullable: plenty of stages
    -- are a human filling in a form.
    skill_name          TEXT REFERENCES skills(name),

    owned_by            owner_kind NOT NULL DEFAULT 'human',

    -- Evaluation contract on the stage's OUTPUT. Distinct from
    -- skills.requires_approval, which asks only whether a human should
    -- look — not whether the output was any good. A stage graduates
    -- from human to agent on its pass rate against these.
    acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Governance at the step level (extends decision 2 from the
    -- connection down to the step): what this stage touches and how
    -- sensitive it is. Agent-owned stages are constrained to what they
    -- are cleared for.
    data_sources        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["jira", "confluence"]
    data_sensitivity    TEXT NOT NULL DEFAULT 'internal'
                            CHECK (data_sensitivity IN ('public', 'internal', 'confidential', 'restricted')),

    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (initiative_id, stage)
);

CREATE INDEX idx_stages_initiative ON initiative_stages (initiative_id, sequence);
CREATE INDEX idx_stages_state ON initiative_stages (state) WHERE state <> 'complete';

CREATE TRIGGER trg_stages_updated_at
    BEFORE UPDATE ON initiative_stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 5. VALUE REVIEW + EVIDENCE
-- ============================================================
-- Closing the loop. Due some months after launch; produces one result
-- row per committed key result, backed by evidence rows.

CREATE TYPE value_review_status AS ENUM ('due', 'in_progress', 'published');

CREATE TABLE value_reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiative_id  UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    due_on         DATE NOT NULL,
    conducted_on   DATE,
    status         value_review_status NOT NULL DEFAULT 'due',
    conducted_by   TEXT,                     -- user_id of the TPM
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_value_reviews_due ON value_reviews (due_on) WHERE status <> 'published';

CREATE TRIGGER trg_value_reviews_updated_at
    BEFORE UPDATE ON value_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE value_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    value_review_id UUID NOT NULL REFERENCES value_reviews(id) ON DELETE CASCADE,
    initiative_id   UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    key_result_id   UUID NOT NULL REFERENCES key_results(id),
    measured_value  NUMERIC,
    measured_note   TEXT,                    -- 'from 8,412 onboarding cases, Sep 2025 to Sep 2026'
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (value_review_id, key_result_id)
);

CREATE INDEX idx_value_results_initiative ON value_results (initiative_id);


CREATE TYPE evidence_kind AS ENUM ('quantitative', 'testimonial');

CREATE TABLE value_evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    value_review_id UUID NOT NULL REFERENCES value_reviews(id) ON DELETE CASCADE,
    key_result_id   UUID REFERENCES key_results(id),
    kind            evidence_kind NOT NULL,

    -- Testimonial evidence is only defensible when attributed. A
    -- testimonial row without a stakeholder is not evidence.
    stakeholder_id  UUID REFERENCES stakeholders(id),
    question        TEXT,                    -- the suggested question that was asked
    statement       TEXT NOT NULL,           -- the answer, or the query result description
    source          TEXT,                    -- system queried, or 'interview'
    recorded_on     DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_testimonial_attributed CHECK (
        kind <> 'testimonial' OR stakeholder_id IS NOT NULL
    )
);

CREATE INDEX idx_value_evidence_review ON value_evidence (value_review_id);


-- ============================================================
-- 6. CAPACITY
-- ============================================================
-- Allocations come out of the plan stage. Aggregated across initiatives
-- they answer both "how utilized are we" and, at intake, "can we take
-- this on, and what does saying yes cost elsewhere".

CREATE TABLE allocations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiative_id  UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    person_name    TEXT NOT NULL,
    person_user_id TEXT,
    role           TEXT,                     -- 'engineer', 'designer', 'tpm'
    fte_fraction   NUMERIC NOT NULL CHECK (fte_fraction > 0 AND fte_fraction <= 1),
    starts_on      DATE NOT NULL,
    ends_on        DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_allocations_initiative ON allocations (initiative_id);
CREATE INDEX idx_allocations_person ON allocations (person_user_id, starts_on);


-- ============================================================
-- 7. LINK THE EXISTING TABLES INTO THE SPINE
-- ============================================================
-- This is the change that stops artifacts being orphans. Today an
-- artifact knows its skill and its conversation and nothing else.

ALTER TABLE artifacts
    ADD COLUMN initiative_id       UUID REFERENCES initiatives(id) ON DELETE SET NULL,
    ADD COLUMN initiative_stage_id UUID REFERENCES initiative_stages(id) ON DELETE SET NULL;

CREATE INDEX idx_artifacts_initiative ON artifacts (initiative_id);

ALTER TABLE conversations
    ADD COLUMN initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_initiative ON conversations (initiative_id);


-- ============================================================
-- 8. THE LEDGER VIEW
-- ============================================================
-- initiative -> key result -> objective -> line of business.
-- The per-line-of-business value ledger is a read of this.

CREATE VIEW value_ledger AS
SELECT
    lob.name                AS line_of_business,
    obj.statement           AS objective,
    kr.name                 AS key_result,
    kr.unit,
    i.title                 AS initiative,
    i.status                AS initiative_status,
    ikr.committed_baseline,
    ikr.committed_target,
    vr_res.measured_value,
    vr.conducted_on         AS value_reviewed_on,
    vr.status               AS review_status
FROM initiatives i
JOIN lines_of_business lob      ON lob.id = i.line_of_business_id
JOIN initiative_key_results ikr ON ikr.initiative_id = i.id
JOIN key_results kr             ON kr.id = ikr.key_result_id
JOIN objectives obj             ON obj.id = kr.objective_id
LEFT JOIN value_reviews vr      ON vr.initiative_id = i.id
LEFT JOIN value_results vr_res  ON vr_res.value_review_id = vr.id
                               AND vr_res.key_result_id = kr.id;

COMMENT ON VIEW value_ledger IS
    'Per-line-of-business value ledger: what was delivered for whom and what it was worth. The artifact worth showing an executive.';
