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
**Summary:** Replaced all Unicode/emoji icons with Phosphor Icons web components loaded via CDN (`@phosphor-icons/web@2.1.1`). Icons replaced: 💬 FAB → `ph-chat-circle` (duotone), × close/remove → `ph-x` (bold), ▶ send → `ph-paper-plane-tilt` (fill), ▼ chevron → `ph-caret-down`, ← back → `ph-arrow-left`, ↻ undo → `ph-arrow-counter-clockwise`. CSS ✓ pseudo-element left as-is.
**Files changed:** `site/index.html` only (script tag in head, CSS alignment rule, 9 icon substitutions in JS)
**In progress:** None
**Next steps:** None identified
**Gotchas:** Phosphor loads via `<script defer>` before the `<script type="module">` — execution order relies on both being deferred and appearing in document order. The CSS ✓ in `.plan-chat-changes li::before` cannot use web components and was intentionally left as Unicode.
