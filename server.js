/**
 * NOTE: superseded for the GitHub + Vercel deployment path by
 * api/chat.js and api/healthz.js, which do the same job as Vercel
 * serverless functions (Vercel doesn't run a persistent Express server
 * from a repo by default). Keep this file only if you plan to self-host
 * on a platform that runs a long-lived Node process (e.g. Render,
 * Railway, a VPS) instead of Vercel. Deploying to Vercel? Ignore this
 * file — it is not used there.
 *
 * Kolos backend proxy — minimal reference implementation.
 *
 * Why this file exists: the original Kolos_Funding_Advisor.html called
 * https://api.anthropic.com/v1/messages directly from browser JavaScript.
 * That cannot work securely: the Anthropic API requires an API key in the
 * request header, and any key placed in client-side code is visible to
 * every visitor (view-source, browser devtools, network tab) and to anyone
 * who saves/reshares the HTML file. This server holds the key instead and
 * is the only thing that talks to Anthropic.
 *
 * This is a minimal reference implementation, not a hardened production
 * server. Before deploying to real farmers, you should add at least:
 *   - Rate limiting / abuse protection (this endpoint currently accepts
 *     unlimited requests from anyone who can reach it, and each request
 *     costs API credit)
 *   - Request size limits tuned to your needs (a basic 1mb cap is set below)
 *   - Logging/monitoring appropriate to your hosting environment
 *   - HTTPS termination (handled by most hosting platforms automatically)
 *   - CORS locked to your actual frontend origin instead of the open
 *     default below, once you know that origin
 *
 * Requires Node.js 18+ (for global fetch). Model ID below (claude-sonnet-5)
 * reflects Anthropic's current model naming as of July 2026 per Anthropic's
 * own product documentation — the original file used "claude-sonnet-4-6",
 * which does not match any current model name and looks like a mistake or
 * a stale/deprecated alias. Verify the model string against your Anthropic
 * account / the Claude API docs (https://docs.claude.com) before relying
 * on this in production — model availability can vary by account.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.KOLOS_MODEL || 'claude-sonnet-5';
const ALLOWED_ORIGIN = process.env.KOLOS_ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Refusing request.');
    return res.status(500).json({ error: { message: 'Server is not configured with an API key. Set ANTHROPIC_API_KEY.' } });
  }

  const { system, messages, max_tokens } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages must be a non-empty array.' } });
  }
  if (typeof system !== 'string') {
    return res.status(400).json({ error: { message: 'system prompt (string) is required.' } });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(Number(max_tokens) || 1200, 4096),
        system,
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Upstream request to Anthropic failed:', err);
    return res.status(502).json({ error: { message: 'Could not reach the Anthropic API: ' + err.message } });
  }
});

app.listen(PORT, () => {
  console.log(`Kolos backend listening on port ${PORT}`);
  if (!API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY is not set — /api/chat will return 500 until it is.');
  }
});
