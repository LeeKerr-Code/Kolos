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
 * Model: defaults to claude-sonnet-5. Confirmed current as of 28 Jul 2026
 * against Anthropic's model docs (platform.claude.com/docs/en/about-claude/
 * models/overview) — this is a real, current model ID, not a guess.
 * Override via KOLOS_MODEL if your account needs a different one.
 *
 * --- Rate limiting (added 28 Jul 2026) ---
 * This adds a basic per-IP limiter: KOLOS_RATE_LIMIT_MAX requests per
 * KOLOS_RATE_LIMIT_WINDOW_MS, tracked in an in-memory Map at module scope.
 *
 * Be honest about what this does and doesn't do:
 * - It works *within* a single warm serverless instance. Vercel can and
 *   will run multiple instances concurrently under real load, and any
 *   instance can go cold and lose its counters at any time. So a
 *   determined or high-traffic abuser can exceed the stated limit by a
 *   multiple of however many instances are alive.
 * - It is still a real improvement over the previous state (no limit at
 *   all, unlimited API spend per visitor) and costs nothing to run.
 * - For an actual guarantee, replace the Map below with Vercel KV or
 *   Upstash Ratelimit (a small durable store shared across instances) —
 *   the HANDOVER.md and README.md both flag this as the last step before
 *   sharing the URL publicly. Swap point is marked below.
 */

const MODEL = process.env.KOLOS_MODEL || 'claude-sonnet-5';
const RATE_LIMIT_MAX = Number(process.env.KOLOS_RATE_LIMIT_MAX) || 20;
const RATE_LIMIT_WINDOW_MS = Number(process.env.KOLOS_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000; // 1 hour

// Web searches allowed per question. This is the single biggest line item in
// the bill: $10 per 1,000 searches, independent of which model is used. Left
// uncapped, one question could fire eight or ten searches. Three keeps answers
// well-sourced while roughly halving cost per question versus uncapped.
const MAX_SEARCHES = Number(process.env.KOLOS_MAX_SEARCHES) || 5;

// How many times we will resume a turn the API paused. See the pause_turn
// handling below. Bounded so a pathological loop cannot run up a bill.
const MAX_PAUSE_RESUMES = Number(process.env.KOLOS_MAX_PAUSE_RESUMES) || 3;

// Whether to believe the X-Forwarded-For header when identifying a client for
// rate limiting. This must default to OFF. If we trusted it unconditionally,
// anyone could set their own X-Forwarded-For and get a fresh quota on every
// request, making the limiter decorative.
//
// Turn it on (KOLOS_TRUST_PROXY=1) only when a reverse proxy you control sits
// in front of this process. Managed platforms set the header themselves and
// strip whatever the client sent, so they are auto-detected below and need no
// configuration. Kept in sync with the PAAS check in server.js; duplicated
// rather than shared because this file must also run standalone on Vercel,
// where server.js is never loaded.
//
// When trusting, we take the LAST entry, not the first. nginx's usual
// `$proxy_add_x_forwarded_for` APPENDS the peer it saw to whatever the client
// sent, so the first entry is attacker-controlled and the last is the only one
// your proxy actually vouched for.
const ON_MANAGED_PLATFORM = !!(
  process.env.RENDER ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.FLY_APP_NAME ||
  process.env.VERCEL
);
const TRUST_PROXY = process.env.KOLOS_TRUST_PROXY === '1' || ON_MANAGED_PLATFORM;

// Module-scope Map: persists only for the life of one warm instance.
// --- Swap point: replace this Map with an Upstash/Vercel KV client for a
// durable, cross-instance limit before real public traffic. ---
const requestLog = new Map(); // ip -> array of request timestamps (ms)

function getClientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) {
      const hops = fwd.split(',').map((s) => s.trim()).filter(Boolean);
      if (hops.length) return hops[hops.length - 1];
    }
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(ip) || []).filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    requestLog.set(ip, timestamps);
    const retryAfterMs = timestamps[0] + RATE_LIMIT_WINDOW_MS - now;
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  timestamps.push(now);
  requestLog.set(ip, timestamps);

  // Opportunistic cleanup so the Map doesn't grow unbounded on a long-lived
  // warm instance — trim occasionally rather than on every request.
  if (requestLog.size > 500 && Math.random() < 0.02) {
    for (const [key, ts] of requestLog) {
      const fresh = ts.filter((t) => t > windowStart);
      if (fresh.length === 0) requestLog.delete(key);
      else requestLog.set(key, fresh);
    }
  }

  return { limited: false };
}

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

  const clientIp = getClientIp(req);
  const rateCheck = isRateLimited(clientIp);
  if (rateCheck.limited) {
    res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
    return res.status(429).json({
      error: {
        message: `Too many requests. This IP has hit the ${RATE_LIMIT_MAX}-per-hour limit. Try again in about ${Math.ceil(rateCheck.retryAfterSeconds / 60)} minute(s).`,
      },
    });
  }

  const { system, messages, max_tokens } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages must be a non-empty array.' } });
  }
  if (typeof system !== 'string') {
    return res.status(400).json({ error: { message: 'system prompt (string) is required.' } });
  }

  /**
   * Resume any turn the API pauses.
   *
   * From Anthropic's web search docs: "The API can pause a long-running search
   * turn and return stop_reason: 'pause_turn'. To continue, send the paused
   * assistant message back unchanged in a new request."
   *
   * Without this, a paused turn arrives looking like a finished answer. In
   * practice that meant a farmer being shown "let me verify the current numbers
   * before I lay them out" with 23 sources attached and nothing else — a
   * promise with the answer missing, presented as complete. For a tool people
   * make money decisions on, a confidently truncated answer is worse than an
   * error, because nothing signals that anything is wrong.
   *
   * Content blocks are accumulated across every leg of the turn, so the sources
   * gathered before the pause survive into the final response alongside the
   * answer written after it.
   */
  const runTurn = async (apiKeyIn, systemIn, messagesIn, maxTokensIn) => {
    let convo = messagesIn;
    const merged = [];
    let data = null;
    let status = 0;
    let resumes = 0;

    while (true) {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeyIn,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokensIn,
          // Prompt caching. The system prompt carries the full programme
          // reference and runs to several thousand tokens, which would
          // otherwise be billed at the full input rate on every message.
          // Marking it cacheable makes follow-ups in a session ~90% cheaper on
          // that portion, and it is well above the 1,024-token minimum for
          // Sonnet so it always qualifies. Default TTL is 5 minutes, refreshed
          // on each hit. It matters more now: a paused turn is resumed with the
          // same system prompt, so each resume is a cache hit rather than a
          // full re-charge. Prompt caching is GA; no beta header needed.
          system: [{ type: 'text', text: systemIn, cache_control: { type: 'ephemeral' } }],
          messages: convo,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
        }),
      });

      status = upstream.status;
      data = await upstream.json();

      // Anything that isn't a well-formed success is passed straight back.
      if (status !== 200 || !Array.isArray(data.content)) break;

      merged.push(...data.content);

      if (data.stop_reason !== 'pause_turn' || resumes >= MAX_PAUSE_RESUMES) break;

      // "send the paused assistant message back unchanged"
      convo = convo.concat([{ role: 'assistant', content: data.content }]);
      resumes += 1;
    }

    return { status, data, merged, resumes };
  };

  try {
    const { status, data, merged, resumes } = await runTurn(
      apiKey,
      system,
      messages,
      Math.min(Number(max_tokens) || 2000, 8192),
    );

    if (status === 200 && merged.length) {
      if (resumes > 0) {
        console.log(`Resumed a paused turn ${resumes} time(s); final stop_reason=${data.stop_reason}`);
      }
      // Rebuild the response with every leg's content, so the client sees one
      // answer with all of its sources rather than only the last fragment.
      return res.status(200).json({ ...data, content: merged, kolos_resumes: resumes });
    }

    return res.status(status).json(data);
  } catch (err) {
    console.error('Upstream request to Anthropic failed:', err);
    return res.status(502).json({ error: { message: 'Could not reach the Anthropic API: ' + err.message } });
  }
};
