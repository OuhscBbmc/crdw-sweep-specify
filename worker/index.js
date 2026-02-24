// ============================================================================
// Cloudflare Worker - Claude API Proxy
// Protects ANTHROPIC_API_KEY from exposure in client-side code
// Deploy: wrangler deploy
// Set secrets:
//   wrangler secret put ANTHROPIC_API_KEY
//
// Email allowlist is stored in the repo at data/allowlist.txt.
// Edit that file and commit to update access — no redeployment needed.
// The worker caches the list for 5 minutes to avoid hitting GitHub on every request.
// ============================================================================

const ALLOWLIST_URL = 'https://raw.githubusercontent.com/OuhscBbmc/crdw-sweep-specify/main/data/allowlist.txt';

// In-memory cache for the allowlist (lives as long as the worker instance)
let cachedAllowlist = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      const body = await request.json();
      const { prompt, type, system, email } = body;

      // ---- Email allowlist check ----
      if (!email || typeof email !== 'string') {
        return jsonResponse({
          error: 'Email required. Enter your OU email in Settings to use AI Expand.'
        }, 403);
      }

      const normalizedEmail = email.trim().toLowerCase();
      const allowed = await fetchAllowlist(ALLOWLIST_URL);

      if (!isEmailAllowed(normalizedEmail, allowed)) {
        return jsonResponse({
          error: 'Access denied. Your email (' + normalizedEmail + ') is not on the approved list. Contact the project admin to request access.'
        }, 403);
      }

      // ---- Validate prompt ----
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
        return jsonResponse({ error: `Claude API error: ${response.status}`, details: errText }, response.status);
      }

      const data = await response.json();

      // Log usage (visible in wrangler tail)
      console.log(`[AI Expand] email=${normalizedEmail} type=${type} tokens_in=${data.usage?.input_tokens || '?'} tokens_out=${data.usage?.output_tokens || '?'}`);

      return jsonResponse(data);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

/**
 * Fetch the email allowlist from the repo's data/allowlist.txt.
 * Caches for 5 minutes to avoid rate limits.
 * @param {string} url - Raw URL of the allowlist file
 * @returns {string[]} Array of allowed patterns (emails or *@domain)
 */
async function fetchAllowlist(url) {
  // Return cached if still fresh
  if (cachedAllowlist && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedAllowlist;
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'cdw-dict-worker' }
    });

    if (!response.ok) {
      console.error('[AUTH] Failed to fetch allowlist: HTTP ' + response.status);
      // If fetch fails but we have a stale cache, use it
      return cachedAllowlist || [];
    }

    const text = await response.text();
    const entries = text
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line && !line.startsWith('#')); // skip empty lines and comments

    cachedAllowlist = entries;
    cacheTimestamp = Date.now();
    console.log('[AUTH] Refreshed allowlist: ' + entries.length + ' entries');
    return entries;

  } catch (err) {
    console.error('[AUTH] Error fetching allowlist:', err.message);
    return cachedAllowlist || [];
  }
}

/**
 * Check if an email is in the allowlist.
 * Supports exact matches and domain wildcards (*@ouhsc.edu).
 */
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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
