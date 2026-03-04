// ============================================================================
// Cloudflare Worker - CRDW Sweep & Specify Proxy
//
// Routes:
//   POST /ai          - Claude API proxy for AI keyword expansion
//   POST /github-push - GitHub Contents API proxy for pushing SS files
//
// Both routes require an allowlisted OU email in the request body.
// Secrets (never in source code):
//   ANTHROPIC_API_KEY - set via: wrangler secret put ANTHROPIC_API_KEY
//   GITHUB_TOKEN      - set via: wrangler secret put GITHUB_TOKEN
//
// Email allowlist: data/allowlist.txt in this repo (no redeployment needed to update)
// Deploy: wrangler deploy  (from the worker/ directory)
// ============================================================================

const ALLOWLIST_URL = 'https://raw.githubusercontent.com/OuhscBbmc/crdw-sweep-specify/main/data/allowlist.txt';
const GITHUB_ORG    = 'OuhscBbmc';
const GITHUB_REPO   = 'crdw-sweep-specify';

// In-memory allowlist cache (lives as long as the worker instance)
let cachedAllowlist = null;
let cacheTimestamp  = 0;
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const body = await request.json();
      const { email } = body;

      // ---- Email allowlist check (required for all routes) ----
      if (!email || typeof email !== 'string') {
        return jsonResponse({ error: 'Email required. Enter your OU email in Settings.' }, 403);
      }

      const normalizedEmail = email.trim().toLowerCase();
      const allowed = await fetchAllowlist(ALLOWLIST_URL);

      if (!isEmailAllowed(normalizedEmail, allowed)) {
        return jsonResponse({
          error: 'Access denied. Your email (' + normalizedEmail + ') is not on the approved list. Contact the project admin to request access.'
        }, 403);
      }

      // ---- Route: AI keyword expansion ----
      if (path === '/ai' || path === '/') {
        return handleAi(body, env, normalizedEmail);
      }

      // ---- Route: GitHub push ----
      if (path === '/github-push') {
        return handleGithubPush(body, env, normalizedEmail);
      }

      return jsonResponse({ error: 'Unknown route: ' + path }, 404);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

// ============================================================================
// AI Route — proxies to Claude API
// ============================================================================
async function handleAi(body, env, email) {
  const { prompt, type, system } = body;

  if (!prompt || typeof prompt !== 'string') {
    return jsonResponse({ error: 'Missing prompt' }, 400);
  }

  const systemPrompt = system || 'You are a clinical research assistant. Return only a JSON array of {keyword, category} objects.';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    return jsonResponse({ error: 'Claude API error: ' + response.status, details: errText }, response.status);
  }

  const data = await response.json();
  console.log('[AI] email=' + email + ' type=' + type + ' tokens_in=' + (data.usage?.input_tokens || '?') + ' tokens_out=' + (data.usage?.output_tokens || '?'));

  return jsonResponse(data);
}

// ============================================================================
// GitHub Push Route — proxies to GitHub Contents API
// Body: { email, filePath, content, commitMsg }
//   filePath  - e.g. "projects/campbell-1/ss-dx.csv"
//   content   - CSV text (will be base64-encoded here)
//   commitMsg - commit message string
// ============================================================================
async function handleGithubPush(body, env, email) {
  const { filePath, content, commitMsg } = body;

  if (!filePath || typeof filePath !== 'string') {
    return jsonResponse({ error: 'Missing filePath' }, 400);
  }
  if (content === undefined || content === null) {
    return jsonResponse({ error: 'Missing content' }, 400);
  }
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: 'GitHub token not configured on the server.' }, 500);
  }

  // Enforce that files only go into projects/ — prevents writing to arbitrary paths
  const safePath = filePath.replace(/^\/+/, '');
  if (!safePath.startsWith('projects/')) {
    return jsonResponse({ error: 'Files can only be written to the projects/ directory.' }, 403);
  }

  const apiUrl = 'https://api.github.com/repos/' + GITHUB_ORG + '/' + GITHUB_REPO + '/contents/' + safePath;
  const ghHeaders = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'crdw-sweep-specify-worker'
  };

  // Check if file already exists (need SHA to update)
  let existingSha = null;
  try {
    const checkResp = await fetch(apiUrl, { headers: ghHeaders });
    if (checkResp.ok) {
      const existing = await checkResp.json();
      existingSha = existing.sha;
    }
  } catch (_) { /* file doesn't exist yet — fine */ }

  // Base64-encode the CSV content
  const encoded = btoa(unescape(encodeURIComponent(content)));

  const putBody = {
    message: (commitMsg || 'Update ' + safePath) + ' [via CRDW Sweep & Specify, ' + email + ']',
    content: encoded
  };
  if (existingSha) putBody.sha = existingSha;

  const putResp = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody)
  });

  if (!putResp.ok) {
    const errText = await putResp.text();
    return jsonResponse({ error: 'GitHub API error: ' + putResp.status, details: errText }, putResp.status);
  }

  const result = await putResp.json();
  console.log('[GitHub] email=' + email + ' pushed ' + safePath);

  return jsonResponse({ ok: true, path: safePath, sha: result.content?.sha });
}

// ============================================================================
// Helpers
// ============================================================================
async function fetchAllowlist(url) {
  if (cachedAllowlist && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedAllowlist;
  }
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'crdw-sweep-specify-worker' } });
    if (!response.ok) {
      console.error('[AUTH] Failed to fetch allowlist: HTTP ' + response.status);
      return cachedAllowlist || [];
    }
    const text = await response.text();
    const entries = text
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line && !line.startsWith('#'));
    cachedAllowlist = entries;
    cacheTimestamp  = Date.now();
    console.log('[AUTH] Refreshed allowlist: ' + entries.length + ' entries');
    return entries;
  } catch (err) {
    console.error('[AUTH] Error fetching allowlist:', err.message);
    return cachedAllowlist || [];
  }
}

function isEmailAllowed(email, allowedList) {
  if (!allowedList || allowedList.length === 0) return false;
  for (const pattern of allowedList) {
    if (pattern === email) return true;
    if (pattern.startsWith('*@') && email.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
