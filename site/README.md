# site/

Single-file Preact SPA (`index.html`, ~2300 lines). No build step — CSS, JS, and markup in one file. Deployed as-is via FTP.

## Structure (within index.html)

1. **`<style>`** (~920 lines) — CSS variables, component styles, responsive layout
2. **`<script type="module">`** (~1340 lines) — Preact components, state, API calls

## Component Hierarchy

```
App                          # Root: state, routing, API calls, auto-save
├── Dashboard                # Main view (route: #/)
│   ├── Hero                 # Status banner (date, next task, urgency)
│   ├── TimelineCard         # Tasks grouped by weekend
│   ├── StatsCard            # Completion percentages
│   ├── ActivityCard         # Recent AI interaction log
│   ├── VersionHistoryCard   # Snapshots with restore buttons
│   ├── DecisionCard         # Recorded decisions list
│   ├── Toast                # Floating AI response notification
│   ├── LoadingOverlay       # Full-screen spinner
│   └── ChatBar              # Bottom input bar + undo option
└── TaskDetail               # Single task view (route: #/task/{id})
    ├── StatusBadge           # Click-to-change status dropdown
    ├── DiyProBadge           # Toggle DIY/Pro
    ├── MetaItem              # Editable metadata (dates, cost, time)
    ├── EditableMarkdown      # Inline markdown editor (description, notes)
    ├── MaterialsList         # Add/remove materials
    └── TaskChatSection       # Per-task AI chat thread
```

## Key Utilities (line ~1175)

- `getToday()` — ISO date string
- `formatDate(dateStr)` — "Mar 15" format
- `daysUntil(dateStr)` — days from today
- `timeAgo(ts)` — "5m ago" / "2h ago"
- `getStatusIcon(status)` / `getStatusLabel(status)` — emoji + text
- `renderMd(text)` — markdown to sanitized HTML
- `autoResize(el)` — auto-expand textareas

## API Wrappers (line ~1244)

- `fetchPlanFromServer()` / `savePlanToServer(plan)` — KV read/write
- `revisePlanOnServer(message, plan)` — AI plan revision
- `taskChatOnServer(task, message, history, context)` — per-task AI chat
- `fetchVersionsFromServer()` / `rollbackOnServer(timestamp)` — version management

## State (all in App, passed as props)

`plan`, `isLoading`, `loadingText`, `toast`, `taskChatHistory`, `versions`, `lastUndoTimestamp`, `collapsed`, `route`, `chatInputValue`

**Refs:** `planRef` (avoids closure stale state), `chatInputRef`, `saveTimerRef` (debounce)

## CSS Patterns

- CSS variables: `--green`, `--gray-50` to `--gray-900`, `--radius`, `--shadow`
- Status modifiers: `.ready`, `.in-progress`, `.done`, `.skipped`, `.on-track`, `.due-soon`, `.overdue`
- Mobile-first, max-width 680px container
