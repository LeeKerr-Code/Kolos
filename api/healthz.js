/**
 * Vercel serverless function — GET /api/healthz
 *
 * Liveness check: visit /api/healthz on your deployed URL to confirm the API
 * routes deployed correctly, independently of whether ANTHROPIC_API_KEY is set.
 *
 * It also reports the build. That exists because "is the deployed version the
 * one you think it is?" turned out to be an expensive question to answer by
 * looking at the page — a missing feature looks identical to a broken one. Now
 * you can read the answer in two seconds. The same string is embedded in the
 * HTML and a test asserts the two agree, so they cannot drift apart.
 */
const BUILD = '2026-08-03.11';

module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, build: BUILD });
};

module.exports.BUILD = BUILD;
