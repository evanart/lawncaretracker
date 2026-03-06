# Lawn Care Tracker

Personal lawn care planning SPA for managing a spring schedule in Fuquay-Varina, NC (Bermuda grass). Uses AI (Claude API) for natural language plan updates instead of traditional CRUD UI.

**Stack:** Preact 10 (via CDN) | Cloudflare Worker + KV | Claude Sonnet 4.5 | GitHub Actions (FTP + Wrangler)

## Architecture

```
lawncaretracker/
├── site/index.html       # Single-file SPA (~2300 lines: CSS + Preact + htm)
├── worker/
│   ├── src/index.js      # Cloudflare Worker API (proxies Claude, manages KV state)
│   └── wrangler.toml     # Worker config + KV namespace binding
├── .github/workflows/
│   └── deploy.yml        # Deploys site/ via FTP, worker/ via Wrangler
└── docs/decisions.md     # Architecture decision log
```

**Frontend:** Single HTML file, no build step. Preact + htm for components, marked + DOMPurify for markdown. Hash-based routing (`#/` dashboard, `#/task/{id}` detail). All state in `App` via hooks, passed as props.

**Backend:** Cloudflare Worker proxies user messages to Claude API, applies JSON patches to plan state in KV. Maintains version history (max 10) for rollback. Rate limited to 20 AI requests/day.

**Data flow:** User sends natural language message -> Worker sends to Claude with current plan -> Claude returns JSON patch + response -> Worker applies patch to KV, saves version snapshot -> Frontend merges updated plan.

## Key Commands

```bash
# Worker local dev
cd worker && npm run dev

# Worker deploy (also happens via CI)
cd worker && npm run deploy

# No build step for site — edit site/index.html directly
# Push to main triggers GitHub Actions: FTP deploy (site) + Wrangler deploy (worker)
```

**Secrets (GitHub Actions):** FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, FTP_REMOTE_PATH, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
**Secrets (Worker env):** ANTHROPIC_API_KEY, APP_TOKEN

## Conventions & Rules

**Components:** PascalCase (`Hero`, `TimelineCard`, `StatusBadge`). Cards suffixed with `Card`.
**CSS:** kebab-case classes (`.task-title`, `.hero-sub`). Status modifiers (`.done`, `.overdue`, `.diy`). CSS variables for colors/shadows. BEM-inspired structure.
**JS:** `ALL_CAPS` for constants. `on*` prefix for event handler props. `is*` for booleans. Utility functions at module level.
**Imports:** CDN via esm.sh (preact@10, htm@3, marked@12, dompurify@3). Worker has no imports (uses native fetch).

**DO NOT:**
- Add a build step for the frontend — it's intentionally a single-file SPA
- Include `activityLog` in AI responses — the client manages activity logging
- Modify `userNotes` on existing tasks via AI — only set to `""` on new tasks
- Send `userNotes` to the AI — they are client-only personal notes

## Context Pointers

- Frontend components & data flow: see `site/README.md`
- Worker API endpoints & data model: see `worker/README.md`
- Architecture decisions: see `docs/decisions.md`

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plan` | Read current plan from KV |
| PUT | `/api/plan` | Write plan to KV (seed init) |
| POST | `/api/revise-plan` | AI plan revision (patch-based) |
| POST | `/api/task-chat` | Per-task AI chat |
| GET | `/api/versions` | List version snapshots |
| POST | `/api/rollback` | Restore previous version |

All requests require `X-App-Token` header. Base URL: `https://lawn-plan-api.evan-56b.workers.dev`

## Active Work / Known Issues

- Task `chatHistory` is now stored as a field on each task object in KV — AI prompts don't include it, only the frontend chat UI uses it
- Recent refactor: switched revise-plan to patch-based responses (reduces tokens, prevents truncation)
- Fixed 502 timeouts on revise-plan and task-chat by switching to Sonnet and optimizing payload size
- No formal test framework — manual testing only

## Session Handoff

**Last session:** 2026-03-06
**Summary:** Overhauled the chat UX across three areas: task chat history now persists to KV (stored in each task's `chatHistory` field, seeded on load, capped at 40 messages, with an Archive button to clear); task chat assistant responses now render with markdown; and the plan-level toast popup was replaced with a toggleable `PlanChatPanel` (green FAB at bottom-right, shows full `activityLog` history with markdown and ✓ changes list).
**Files changed:** `site/index.html` only (worker unchanged)
**In progress:** None
**Next steps:** None identified — all three improvements are shipped and pushed
**Gotchas:** `chatHistory` field is now present on task objects in KV — any future AI prompt engineering should explicitly exclude it (as `userNotes` already is). The `ChatBar` and `Toast` components were removed; plan chat input now lives entirely inside `PlanChatPanel`.
