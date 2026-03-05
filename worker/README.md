# worker/

Cloudflare Worker API that proxies natural language messages to Claude for AI-driven plan management. Stores plan state in Cloudflare KV.

## Files

- `src/index.js` — Single Worker handler (~554 lines): routing, auth, Claude API calls, KV operations, patch merging
- `wrangler.toml` — Worker name (`lawn-plan-api`), KV namespace binding (`LAWN_PLAN`)
- `package.json` — `npm run dev` (local), `npm run deploy` (production)

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plan` | Read current plan from KV |
| PUT | `/api/plan` | Write plan to KV (seed initialization) |
| POST | `/api/revise-plan` | AI revision: sends message + plan to Claude, applies patch |
| POST | `/api/task-chat` | Per-task AI chat: refines individual task descriptions |
| GET | `/api/versions` | List version history metadata |
| POST | `/api/rollback` | Restore a previous version snapshot |

**Auth:** All requests require `X-App-Token` header (value in Worker env secret).

## AI Integration

- **Model:** `claude-sonnet-4-5` for both endpoints
- **Max tokens:** 8192 (revise-plan), 2048 (task-chat)
- **Rate limit:** 20 requests/day (counter stored in KV with 48h TTL)
- **revise-plan:** Claude receives current plan + message, returns JSON patch (`tasks.update/add/remove`, `decisions.add`, `context`) + conversational response
- **task-chat:** Claude receives single task + context + chat history, returns updated task object + response

## KV Keys

- `current-plan` — Active plan state (JSON)
- `version-meta` — Array of version snapshot metadata
- `version::{timestamp}` — Individual plan snapshots (max 10 retained)
- `rate-limit:{YYYY-MM-DD}` — Daily request counter (48h TTL)

## Key Functions

- `handleRevisePlan()` — Rate limit check, Claude API call, patch application, version snapshot
- `handleTaskChat()` — Rate limit check, Claude API call for single task refinement
- `applyPatch(plan, patch)` — Merges patch into plan: removes tasks, updates fields, adds new tasks, appends decisions, shallow-merges context
- `saveVersion(env, plan, message)` — Snapshots current plan before changes, trims to MAX_VERSIONS
- `corsHeaders(request)` — CORS headers (echoes origin)

## Plan Data Model

```javascript
{
  lastUpdated: "YYYY-MM-DD",
  activityLog: [{ timestamp, userMessage, response, changes }],
  tasks: [{
    id, title, description, targetDate, deadline,
    estimatedTime, status, diyOrPro, materials,
    cost, dependsOn, phase, weekend, notes, userNotes
  }],
  decisions: [{ date, decision, notes }],
  context: { location, grassType, constraints, ... }
}
```

**Task statuses:** `ready`, `in-progress`, `done`, `skipped`
**diyOrPro:** `diy` or `pro`
