# Architecture Decisions

### 2026-02 Single-File SPA (No Build Step)
**Status:** Active
**Context:** Needed a simple frontend for plan management without the overhead of a build pipeline.
**Decision:** Keep all CSS, JS, and markup in `site/index.html`. Use CDN ES module imports (esm.sh) for Preact, htm, marked, DOMPurify.
**Consequences:** Zero build config, instant deploys, easy to iterate. Tradeoff: file is ~2300 lines and growing. No tree-shaking or minification.

### 2026-02 Preact + htm Over React
**Status:** Active
**Context:** Needed a component framework small enough to load from CDN without a bundler.
**Decision:** Use Preact (3KB) with htm (JSX-like template literals) instead of React.
**Consequences:** Familiar React-like API, tiny bundle, no JSX compilation needed. htm syntax uses `html\`...\`` instead of JSX.

### 2026-02 Cloudflare Workers + KV for Backend
**Status:** Active
**Context:** Needed serverless API to proxy Claude calls and persist plan state. Must stay under Cloudflare's 30s request timeout.
**Decision:** Cloudflare Worker with KV namespace for plan storage and version history.
**Consequences:** Global edge deployment, integrated KV storage, no server management. KV is eventually consistent (acceptable for single-user app). 30s timeout constrains AI response time.

### 2026-02 AI-Driven Plan Updates (Not CRUD UI)
**Status:** Active
**Context:** Lawn care plans have complex interdependencies (weather, task ordering, Bermuda grass constraints). Traditional form-based editing would require many specialized UI controls.
**Decision:** Users send natural language messages; Claude interprets intent and modifies the plan accordingly.
**Consequences:** Simpler UI (just a chat bar). Plan modifications are context-aware. Tradeoff: depends on AI accuracy, rate limited (20/day), each revision costs API tokens.

### 2026-03 Patch-Based AI Responses
**Status:** Active (supersedes full-plan responses)
**Context:** Claude was returning the entire plan object in responses, causing token waste and truncation on large plans.
**Decision:** Claude returns a JSON patch (`tasks.update/add/remove`, `decisions.add`, `context`) instead of the full plan. Worker applies the patch server-side.
**Consequences:** Dramatically reduces response size and token usage. Eliminates truncation issues. Worker handles merge logic in `applyPatch()`.

### 2026-02 Hash-Based Client Routing
**Status:** Active
**Context:** SPA needs navigation between dashboard and task detail views without server-side routing config.
**Decision:** Use `location.hash` for routing (`#/`, `#/task/{id}`). Listen to `hashchange` events.
**Consequences:** Works with static file hosting (FTP). No server config needed. URLs contain `#` but acceptable for a personal tool.

### 2026-02 userNotes Isolation
**Status:** Active
**Context:** Tasks have both AI-managed `notes` and user-written `userNotes`. AI was occasionally overwriting personal notes.
**Decision:** `userNotes` are never sent to the AI and never modified by AI responses. Only set to `""` on new tasks.
**Consequences:** User's personal annotations are safe from AI modification. Slight duplication (two notes fields per task).

### 2026-02 Version Snapshots Before Changes
**Status:** Active
**Context:** AI-driven changes can be unpredictable. Users need a way to undo.
**Decision:** Save a version snapshot to KV before every AI modification. Keep max 10 versions. Rollback creates a new snapshot first (rollback is itself undoable).
**Consequences:** Every change is reversible. Storage cost is bounded (10 snapshots max). Quick undo available in UI immediately after changes.
