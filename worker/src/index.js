// Lawn Plan API — Cloudflare Worker
// Proxies natural language plan updates to Claude via the Anthropic API

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5';         // revise-plan: fast enough to avoid Cloudflare 30s timeout
const TASK_CHAT_MODEL = 'claude-sonnet-4-5'; // task-chat: faster, sufficient for single-task Q&A
const MAX_TOKENS = 4096;           // revise-plan: full plan JSON (4096 is sufficient, caps generation time)
const TASK_CHAT_MAX_TOKENS = 2048; // task-chat: one task object + short reply
const DAILY_RATE_LIMIT = 20;

const SYSTEM_PROMPT = `You are a lawn care planning assistant managing a spring lawn care schedule for a homeowner in Fuquay-Varina, NC with Bermuda grass. You receive the current plan state as JSON and a natural language message from the user.

Your job is to interpret the message and respond in two ways:
1. Update the plan JSON if any changes are needed
2. Provide a brief, friendly conversational response

TYPES OF MESSAGES YOU MAY RECEIVE:
- Task completion ("finished the cleanup", "done with the EWF")
- Task skipping/rescheduling ("couldn't do it, it rained", "pushing tree area to next week")
- New information ("Leapfrog quoted $450", "soil test came back pH 5.8")
- New tasks ("add a task: fix the sprinkler", "I need to reseed near the mailbox")
- Decision changes ("we decided to plant a tree after all", "going with rubber mulch instead")
- Questions ("what should I do about the brown spot?", "when should I start watering?")
- Observations ("noticed crabgrass near the driveway", "the sod is rooting nicely")

PLAN MODIFICATION RULES:
- When rescheduling: push to the next available weekend. Cascade dependent tasks. Never stack two major projects (3+ hours) on the same weekend.
- When adding tasks: generate a full task object with id, title, description, targetDate, deadline, estimatedTime, materials, cost, dependencies, phase, and notes. Place it logically in the timeline. Set userNotes to "" for new tasks.
- When updating decisions: add to the decisions array with today's date.
- When receiving information (quotes, soil results, etc.): update the relevant task's notes and cost fields, and add to context if broadly relevant.
- When answering questions: provide helpful advice in your response. Only modify the plan if the answer implies an action.
- Leapfrog-managed tasks: don't reschedule unless the user says Leapfrog changed the date.
- Scalp mow constraint: can only happen late March through mid April when Bermuda is greening.
- Always recalculate summary stats (budget, completion count) when the plan changes.
- NEVER modify the activityLog array. Return it exactly as received. The client handles activity logging separately.
- NEVER modify the userNotes field on any task. This is the user's personal notes and must be preserved exactly as-is.
- Format task descriptions using markdown for readability. Use headers (##, ###) for sections, bullet lists for steps, **bold** for emphasis, and \`code\` for specific commands or product names.

RESPONSE FORMAT — Respond with ONLY a valid JSON object:
{
  "revisedPlan": { /* the full updated plan JSON — always return the complete object even if only small changes were made */ },
  "response": "A brief, friendly 1-3 sentence response to the user. Be conversational, not robotic. Reference specific tasks or dates when relevant. If nothing changed, just acknowledge what they said.",
  "changes": ["Human-readable list of each change made to the plan, one per array item. Empty array if no changes."]
}

Do not include any text outside the JSON object. Do not wrap in markdown code fences.`;

const TASK_CHAT_SYSTEM_PROMPT = `You are a lawn care task assistant helping a homeowner in Fuquay-Varina, NC (Bermuda grass) refine a specific task. You receive the task data, plan context, and a conversation history.

Your job is to:
1. Answer questions about the task
2. Help refine and expand the task description with actionable, step-by-step detail
3. Suggest improvements, materials, or techniques when relevant

RESPONSE FORMAT — Respond with ONLY a valid JSON object:
{
  "updatedTask": { /* the full task object with any changes */ },
  "response": "A helpful, conversational response. Be specific and practical.",
  "descriptionChanged": true/false
}

RULES:
- You may update: description, notes, materials, estimatedTime, cost
- You must NOT change: id, title, targetDate, deadline, status, dependsOn, phase, weekend, diyOrPro, userNotes
- If the user is just asking a question, set descriptionChanged to false and return the task unchanged
- Keep descriptions actionable and step-by-step
- Format descriptions using markdown for readability: use headers (##, ###), bullet lists, **bold**, and \`code\` for commands/products
- Reference Bermuda grass and Fuquay-Varina, NC climate when relevant
- Do not include any text outside the JSON object. Do not wrap in markdown code fences.`;

const KV_KEY = 'current-plan';
const VERSION_META_KEY = 'version-meta';
const MAX_VERSIONS = 10;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const headers = { ...corsHeaders(request), 'Content-Type': 'application/json' };

    // --- Auth: require shared secret on all non-OPTIONS requests ---
    const token = request.headers.get('X-App-Token');
    if (token !== env.APP_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers }
      );
    }

    // --- GET /api/plan — read current plan from KV ---
    if (request.method === 'GET' && path.endsWith('/api/plan')) {
      try {
        const stored = await env.LAWN_PLAN.get(KV_KEY);
        if (!stored) {
          return new Response(JSON.stringify({ plan: null }), { headers });
        }
        return new Response(JSON.stringify({ plan: JSON.parse(stored) }), { headers });
      } catch (err) {
        console.error('KV read error:', err);
        return new Response(JSON.stringify({ error: 'Failed to read plan' }), { status: 500, headers });
      }
    }

    // --- PUT /api/plan — write plan to KV (used for seed init) ---
    if (request.method === 'PUT' && path.endsWith('/api/plan')) {
      try {
        const body = await request.json();
        if (!body.plan) {
          return new Response(JSON.stringify({ error: 'Missing plan field' }), { status: 400, headers });
        }
        await env.LAWN_PLAN.put(KV_KEY, JSON.stringify(body.plan));
        return new Response(JSON.stringify({ ok: true }), { headers });
      } catch (err) {
        console.error('KV write error:', err);
        return new Response(JSON.stringify({ error: 'Failed to save plan' }), { status: 500, headers });
      }
    }

    // --- POST /api/revise-plan — AI revision ---
    if (request.method === 'POST' && path.endsWith('/api/revise-plan')) {
      return handleRevisePlan(request, env, headers);
    }

    // --- POST /api/task-chat — per-task AI chat ---
    if (request.method === 'POST' && path.endsWith('/api/task-chat')) {
      return handleTaskChat(request, env, headers);
    }

    // --- GET /api/versions — list version history ---
    if (request.method === 'GET' && path.endsWith('/api/versions')) {
      try {
        const metaRaw = await env.LAWN_PLAN.get(VERSION_META_KEY);
        const meta = metaRaw ? JSON.parse(metaRaw) : [];
        return new Response(JSON.stringify({ versions: meta }), { headers });
      } catch (err) {
        console.error('Version meta read error:', err);
        return new Response(JSON.stringify({ error: 'Failed to read versions' }), { status: 500, headers });
      }
    }

    // --- POST /api/rollback — restore a previous version ---
    if (request.method === 'POST' && path.endsWith('/api/rollback')) {
      return handleRollback(request, env, headers);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  },
};

async function handleRevisePlan(request, env, headers) {
  // Rate limiting — persisted in KV so it survives Worker restarts
  const today = new Date().toISOString().slice(0, 10);
  const rateLimitKey = `rate-limit:${today}`;

  const countRaw = await env.LAWN_PLAN.get(rateLimitKey);
  const count = countRaw ? parseInt(countRaw, 10) : 0;
  if (count >= DAILY_RATE_LIMIT) {
    return new Response(
      JSON.stringify({ error: 'Daily rate limit reached. Try again tomorrow.' }),
      { status: 429, headers }
    );
  }
  // Increment and set TTL of 48h so old keys auto-expire
  await env.LAWN_PLAN.put(rateLimitKey, String(count + 1), { expirationTtl: 172800 });

  try {
    const body = await request.json();
    const { message, currentPlan, activityLog, today: clientToday } = body;

    if (!message || !currentPlan) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: message, currentPlan' }),
        { status: 400, headers }
      );
    }

    // Build system prompt with plan context embedded once (reduces input tokens)
    const systemWithContext =
      SYSTEM_PROMPT +
      `\n\nToday's date: ${clientToday || today}` +
      `\n\nCurrent plan state:\n${JSON.stringify(currentPlan)}` +
      `\n\nRecent activity (last 10 interactions):\n${JSON.stringify(activityLog || [])}`;

    // Call Anthropic API
    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemWithContext,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error('Anthropic API error:', anthropicResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'AI service error', details: anthropicResponse.status }),
        { status: 502, headers }
      );
    }

    const anthropicData = await anthropicResponse.json();
    const rawContent = anthropicData.content?.[0]?.text;

    if (!rawContent) {
      return new Response(
        JSON.stringify({ error: 'Empty response from AI' }),
        { status: 502, headers }
      );
    }

    // Parse Claude's JSON response — strip markdown fences if present
    let parsed;
    try {
      const cleaned = rawContent.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', rawContent.slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response', raw: rawContent.slice(0, 200) }),
        { status: 502, headers }
      );
    }

    // Save a version snapshot of the pre-revision plan, then persist the revised plan
    if (parsed.revisedPlan) {
      // Preserve userNotes from the current plan — AI must never overwrite these
      if (parsed.revisedPlan.tasks && currentPlan.tasks) {
        for (const task of parsed.revisedPlan.tasks) {
          const original = currentPlan.tasks.find(t => t.id === task.id);
          if (original && original.userNotes !== undefined) {
            task.userNotes = original.userNotes;
          }
        }
      }

      try {
        // Snapshot the plan as it was BEFORE the AI changed it (so undo restores this)
        await saveVersion(env, currentPlan, {
          userMessage: message,
          changes: parsed.changes || [],
          source: 'ai-revision',
        });
      } catch (vErr) {
        console.error('Version snapshot failed:', vErr);
        // Non-fatal
      }

      try {
        await env.LAWN_PLAN.put(KV_KEY, JSON.stringify(parsed.revisedPlan));
      } catch (kvErr) {
        console.error('KV write after revision failed:', kvErr);
        // Non-fatal — the response still contains the plan
      }
    }

    return new Response(JSON.stringify(parsed), { headers });
  } catch (err) {
    console.error('Worker error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers }
    );
  }
}

async function handleTaskChat(request, env, headers) {
  // Shared rate limiting with revise-plan
  const today = new Date().toISOString().slice(0, 10);
  const rateLimitKey = `rate-limit:${today}`;

  const countRaw = await env.LAWN_PLAN.get(rateLimitKey);
  const count = countRaw ? parseInt(countRaw, 10) : 0;
  if (count >= DAILY_RATE_LIMIT) {
    return new Response(
      JSON.stringify({ error: 'Daily rate limit reached. Try again tomorrow.' }),
      { status: 429, headers }
    );
  }
  await env.LAWN_PLAN.put(rateLimitKey, String(count + 1), { expirationTtl: 172800 });

  try {
    const body = await request.json();
    const { task, message, chatHistory, planContext } = body;

    if (!task || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: task, message' }),
        { status: 400, headers }
      );
    }

    // Build system prompt with task context embedded once (not repeated on every turn)
    const systemWithContext =
      TASK_CHAT_SYSTEM_PROMPT +
      `\n\nTASK CONTEXT:\n${JSON.stringify(task)}\n\nPLAN CONTEXT:\n${JSON.stringify(planContext || {})}`;

    // Build multi-turn messages array (clean conversation turns only)
    const messages = [];

    // Add prior conversation turns (capped at last 10)
    const recentHistory = (chatHistory || []).slice(-10);
    for (const entry of recentHistory) {
      messages.push({ role: entry.role, content: entry.content });
    }

    // Current user message — just the user's words, no repeated task JSON
    messages.push({ role: 'user', content: message });

    // Call Anthropic API
    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TASK_CHAT_MODEL,
        max_tokens: TASK_CHAT_MAX_TOKENS,
        system: systemWithContext,
        messages,
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error('Anthropic API error:', anthropicResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: 'AI service error', details: anthropicResponse.status }),
        { status: 502, headers }
      );
    }

    const anthropicData = await anthropicResponse.json();
    const rawContent = anthropicData.content?.[0]?.text;

    if (!rawContent) {
      return new Response(
        JSON.stringify({ error: 'Empty response from AI' }),
        { status: 502, headers }
      );
    }

    // Parse JSON response — strip markdown fences if present
    let parsed;
    try {
      const cleaned = rawContent.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse task-chat response:', rawContent.slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response', raw: rawContent.slice(0, 200) }),
        { status: 502, headers }
      );
    }

    // No KV write — client handles persisting task changes back into the plan
    return new Response(JSON.stringify(parsed), { headers });
  } catch (err) {
    console.error('Task-chat error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers }
    );
  }
}

// --- Version history helpers ---

async function saveVersion(env, plan, meta) {
  const timestamp = Date.now();
  const versionKey = `version::${timestamp}`;

  // Write the snapshot
  await env.LAWN_PLAN.put(versionKey, JSON.stringify({ plan, ...meta }));

  // Update the index
  const metaRaw = await env.LAWN_PLAN.get(VERSION_META_KEY);
  const metaList = metaRaw ? JSON.parse(metaRaw) : [];

  metaList.push({
    timestamp,
    userMessage: (meta.userMessage || '').slice(0, 100),
    changeCount: (meta.changes || []).length,
    source: meta.source || 'unknown',
  });

  // Prune to MAX_VERSIONS — delete evicted snapshots
  while (metaList.length > MAX_VERSIONS) {
    const evicted = metaList.shift();
    try {
      await env.LAWN_PLAN.delete(`version::${evicted.timestamp}`);
    } catch (_) { /* best-effort cleanup */ }
  }

  await env.LAWN_PLAN.put(VERSION_META_KEY, JSON.stringify(metaList));
}

async function handleRollback(request, env, headers) {
  try {
    const body = await request.json();
    const { timestamp } = body;

    if (!timestamp) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: timestamp' }),
        { status: 400, headers }
      );
    }

    // Read the version snapshot to restore
    const versionRaw = await env.LAWN_PLAN.get(`version::${timestamp}`);
    if (!versionRaw) {
      return new Response(
        JSON.stringify({ error: 'Version not found' }),
        { status: 404, headers }
      );
    }

    const versionData = JSON.parse(versionRaw);

    // Save the current plan as a new version before overwriting (so rollback is undoable)
    const currentRaw = await env.LAWN_PLAN.get(KV_KEY);
    if (currentRaw) {
      try {
        await saveVersion(env, JSON.parse(currentRaw), {
          userMessage: 'Rollback performed',
          changes: ['Rolled back to earlier version'],
          source: 'rollback',
        });
      } catch (vErr) {
        console.error('Pre-rollback snapshot failed:', vErr);
      }
    }

    // Write the restored plan
    await env.LAWN_PLAN.put(KV_KEY, JSON.stringify(versionData.plan));

    return new Response(JSON.stringify({ ok: true, plan: versionData.plan }), { headers });
  } catch (err) {
    console.error('Rollback error:', err);
    return new Response(
      JSON.stringify({ error: 'Rollback failed' }),
      { status: 500, headers }
    );
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Max-Age': '86400',
  };
}
