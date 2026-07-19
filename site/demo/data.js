/* ============================================================
 * Atlas — mock product data for the standalone demo.
 * One product ("the map"); three journeys (lenses) light up
 * different stages / skills / artifacts / metrics of the SAME map.
 * All data is mock — no backend, no LLM, no DB.
 * ============================================================ */
window.ATLAS = {
  product: "Atlas",
  tagline: "Unified customer notifications platform",

  // The three journeys = lenses over the one product map.
  journeys: {
    product:  { label: "Product",  persona: "Technical Product Manager",
      blurb: "Defines the <em>what &amp; why</em> — turns intent into PRDs, risk registers and roadmaps via skills." },
    delivery: { label: "Delivery", persona: "Delivery Lead",
      blurb: "Tracks <em>how it's going</em> — burndown, cycle time and throughput across the current sprint." },
    program:  { label: "Program",  persona: "Program Manager",
      blurb: "Owns the <em>whole picture</em> — artifact coverage and stage-gate readiness across the entire lifecycle." },
  },

  // The product development lifecycle = the backbone of the map (never changes).
  stages: [
    { id: "discovery", name: "Discovery", status: "done", nodes: [
      { id: "brief", type: "artifact", title: "Product Brief", version: 1, journeys: ["product", "program"],
        markdown: "# Product Brief: Atlas\n\n## Problem\nNotifications are fragmented across SMS, email and push, each owned by a different team, with no shared preferences or delivery guarantees.\n\n## Opportunity\nA single notifications platform that unifies channels, honors customer preferences, and guarantees real-time delivery.\n\n## Success looks like\n- One API for all channels\n- Customer-managed preferences\n- 99.9% on-time delivery" },
    ]},

    { id: "definition", name: "Definition", status: "done", nodes: [
      { id: "prd", type: "artifact", title: "PRD", version: 2, journeys: ["product", "program"], producedBy: "generate_prd",
        markdown: "# PRD: Atlas\n*v2 · grounded in Jira epics + Confluence vision*\n\n## Summary\nAtlas unifies customer notifications (SMS, email, push) behind one API with per-customer preferences and real-time delivery.\n\n## Goals\n- One notification API across all channels\n- Customer preference center\n- Real-time delivery pipeline with retries\n\n## Non-Goals\n- In-app messaging inbox (later)\n- Marketing campaign tooling\n\n## Requirements\n- **ATLAS-101** Preferences service\n- **ATLAS-102** Real-time delivery pipeline\n- Channel adapters: SMS, email, push\n\n## Risks\nSee the linked Risk Register." },
      { id: "risks", type: "artifact", title: "Risk Register", version: 1, journeys: ["product", "program"], producedBy: "identify_risks",
        markdown: "# Risk Register: Atlas\n\n| # | Risk | Severity | Mitigation |\n|---|------|----------|-----------|\n| R1 | Delivery pipeline throughput under peak load | High | Load test ATLAS-102 before GA |\n| R2 | Preference-service migration from legacy store | Medium | Dual-write + backfill |\n| R3 | Third-party SMS provider rate limits | Medium | Multi-provider failover |" },
      { id: "generate_prd", type: "skill", title: "generate_prd", journeys: ["product"], produces: "prd",
        desc: "Generate a first-draft PRD for a project from Jira / Confluence / GitHub context." },
      { id: "identify_risks", type: "skill", title: "identify_risks", journeys: ["product"], produces: "risks",
        desc: "Surface delivery and technical risks from the project's issues and PRD." },
    ]},

    { id: "planning", name: "Planning", status: "active", nodes: [
      { id: "roadmap", type: "artifact", title: "Roadmap", version: 1, journeys: ["product", "program"], producedBy: "prep_roadmap",
        markdown: "# Roadmap: Atlas\n\n- **M1 · Foundation** — API skeleton, preferences service\n- **M2 · Channels** — SMS + email adapters\n- **M3 · Real-time** — delivery pipeline + retries\n- **M4 · Push** — push adapter, GA readiness\n- **M5 · Launch** — rollout + release notes" },
      { id: "techspec", type: "artifact", title: "Tech Spec", version: 1, journeys: ["product", "program"],
        markdown: "# Tech Spec: Atlas\n\n## Architecture\nEvent-driven: ingestion → preference resolution → channel router → delivery workers.\n\n## Key decisions\n- Idempotent delivery with per-message dedupe keys\n- Preference store: Postgres, dual-write during migration\n- Backpressure via a queue between router and workers" },
      { id: "prep_roadmap", type: "skill", title: "prep_roadmap", journeys: ["product"], produces: "roadmap",
        desc: "Draft a milestone roadmap for the project from scope and dependencies." },
    ]},

    { id: "delivery", name: "Delivery", status: "active", nodes: [
      { id: "burndown", type: "metric", title: "Burndown", journeys: ["delivery", "program"], metric: "burndown" },
      { id: "throughput", type: "metric", title: "Throughput", journeys: ["delivery"], metric: "throughput" },
      { id: "cycletime", type: "metric", title: "Cycle time", journeys: ["delivery"], metric: "cycletime" },
      { id: "status", type: "artifact", title: "Sprint Status", version: 3, journeys: ["delivery", "program"], producedBy: "summarize_status",
        markdown: "# Sprint Status: Atlas\n*Sprint 7 · day 8 of 10*\n\n**At a glance:** behind by ~5 points; delivery pipeline (ATLAS-102) is the long pole.\n\n- ✅ Preferences service merged\n- 🔄 Delivery pipeline in review\n- ⚠️ SMS adapter blocked on provider sandbox\n\n**Call:** de-scope push retries to M4 to protect the sprint goal." },
      { id: "summarize_status", type: "skill", title: "summarize_status", journeys: ["delivery"], produces: "status",
        desc: "Summarize current sprint status from the delivery metrics." },
    ]},

    { id: "launch", name: "Launch", status: "todo", nodes: [
      { id: "release", type: "artifact", title: "Release Notes", version: 0, missing: true, journeys: ["product", "program"], producedBy: "generate_release_notes",
        markdown: null },
      { id: "readiness", type: "metric", title: "Launch readiness", journeys: ["program"], metric: "readiness" },
    ]},

    { id: "iterate", name: "Iterate", status: "todo", nodes: [
      { id: "feedback", type: "artifact", title: "Feedback Digest", version: 0, missing: true, journeys: ["product", "program"],
        markdown: null },
    ]},
  ],

  // Mock delivery metrics (drive the Delivery lens charts).
  metrics: {
    burndown: {
      labels: ["0","1","2","3","4","5","6","7","8","9","10"],
      ideal:  [40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0],
      actual: [40, 39, 36, 33, 30, 26, 23, 19, 14, 9, 5],  // ends at 5 → behind
    },
    throughput: [ { week: "W1", done: 6 }, { week: "W2", done: 5 }, { week: "W3", done: 7 }, { week: "W4", done: 6 } ],
    cycletime: { avgDays: 4.8, trend: [5.6, 5.2, 4.9, 4.8] },
    wip: 7,
    readiness: 62,  // percent — Program lens: launch gate not yet green
  },
};
