/**
 * Vercel serverless function — POST /api/chat
 *
 * This is the only thing that ever talks to api.anthropic.com. The browser
 * (Kolos_Funding_Advisor.html) never sees the API key — it just POSTs to
 * this same-origin route, which is served automatically because Vercel
 * treats every file under /api as a serverless function route matching
 * its filename (this file -> /api/chat).
 *
 * Required: set ANTHROPIC_API_KEY as an Environment Variable in your
 * Vercel project (Project Settings -> Environment Variables) for
 * Production (and Preview/Development if you want preview deploys and
 * `vercel dev` to work too).
 *
 * Model note: defaults to claude-sonnet-5 (Anthropic's current Sonnet
 * model per their docs as of this writing). The original Kolos file
 * referenced "claude-sonnet-4-6", which doesn't match any current model
 * name — verify against https://docs.claude.com and your Anthropic
 * account if you override this via KOLOS_MODEL.
 *
 * Not hardened for production traffic as-is: there is no rate limiting
 * here, and every request costs API credit. Consider Vercel's Edge
 * Config / a KV store for basic rate limiting, or a service like
 * Upstash Ratelimit, before opening this to the public at scale.
 */

const MODEL = process.env.KOLOS_MODEL || 'claude-sonnet-5';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set for this Vercel project/environment.');
    return res.status(500).json({
      error: { message: 'Server is not configured with an API key. Set ANTHROPIC_API_KEY in Vercel project settings.' },
    });
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
        'x-api-key': apiKey,
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
};
