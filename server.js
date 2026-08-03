#!/usr/bin/env node
/**
 * Kolos — self-hosted server.
 *
 * Zero dependencies. Uses only Node's built-in modules, so there is no
 * `npm install` step and nothing to go stale or get a security advisory.
 *
 * What it does:
 *   GET  /              -> Kolos_Funding_Advisor.html
 *   GET  /<file>        -> any other file in this folder (static)
 *   POST /api/chat      -> api/chat.js
 *   GET  /api/healthz   -> api/healthz.js
 *
 * Why the shim below exists: api/chat.js and api/healthz.js were written for
 * Vercel, which hands handlers an Express-flavoured response object with
 * .status() and .json(), and a req.body that has already been parsed. Node's
 * own http module provides neither. Rather than fork those files (which would
 * mean two copies of the rate limiting and validation logic drifting apart),
 * this server adds the missing methods and parses the body, then calls the
 * handlers unchanged. The same api/*.js files therefore run correctly both
 * here and on Vercel, and the test suite covers the code you actually deploy.
 *
 * Run it:
 *   node --env-file=.env server.js
 *
 * Environment (see .env.example):
 *   ANTHROPIC_API_KEY   required
 *   PORT                default 3000
 *   HOST                default 127.0.0.1 (see note below)
 *   KOLOS_TRUST_PROXY   set to 1 ONLY if a reverse proxy sits in front
 *
 * HOST defaults to 127.0.0.1, meaning "only accept connections from this
 * machine". That is deliberate: the intended setup is Caddy or nginx in front
 * handling HTTPS and forwarding to this port. If you set HOST=0.0.0.0 you are
 * exposing plain HTTP to the whole internet, which means the farmer's questions
 * travel unencrypted. Don't, unless you know why you are doing it.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Load .env if present, before anything reads process.env.
 *
 * Node 20.6+ has --env-file built in, but relying on it means the server
 * silently misbehaves on older Node, and Ubuntu's packaged Node has lagged.
 * Twenty lines here removes a whole class of "why is my key not loading"
 * problems and one install step from the deploy guide. Real environment
 * variables always win, so this never overrides what systemd or the shell set.
 *
 * KOLOS_ENV_FILE overrides which file is read. Useful when config lives outside
 * the app directory, and required by the test suite: tests must never write a
 * .env into the app folder, because a leftover one silently overrides real
 * configuration on the next start. That is not hypothetical — an interrupted
 * test run left one behind and quietly turned on proxy trust.
 */
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return false; // no .env is fine; the environment may be set another way
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

const ROOT = __dirname;
loadDotEnv(process.env.KOLOS_ENV_FILE || path.join(ROOT, '.env'));

/**
 * Detect a managed platform (Render, Railway, Fly, Vercel).
 *
 * This matters for two settings that have opposite correct answers depending
 * on where you run:
 *
 *  - Bind address. On your own server, 127.0.0.1 is right: the proxy you
 *    installed reaches it and the internet cannot. On a managed platform the
 *    router lives outside the container, so 127.0.0.1 makes the app
 *    unreachable and the deploy fails health checks with no obvious reason.
 *    Managed platforms need 0.0.0.0, and it is safe there because their
 *    router terminates TLS in front of you.
 *
 *  - X-Forwarded-For. Managed platforms set it themselves and strip anything
 *    the client sent, so it is trustworthy. On a bare server it is forgeable
 *    until you put your own proxy in front.
 *
 * Getting either wrong is silent rather than loud, which is why this is
 * detected rather than left to a checklist.
 */
const PAAS =
  process.env.RENDER ? 'Render' :
  process.env.RAILWAY_ENVIRONMENT ? 'Railway' :
  process.env.FLY_APP_NAME ? 'Fly.io' :
  process.env.VERCEL ? 'Vercel' :
  null;

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (PAAS ? '0.0.0.0' : '127.0.0.1');
const INDEX = 'Kolos_Funding_Advisor.html';
const MAX_BODY_BYTES = 512 * 1024;

const chatHandler = require('./api/chat.js');
const healthzHandler = require('./api/healthz.js');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Files in this folder that must never be served over HTTP, even though they
// sit next to the HTML. Belt and braces: .env is also excluded by the dotfile
// rule below, but being explicit costs nothing and this is the file that ends
// careers.
const DENY = new Set([
  'server.js', 'package.json', 'vercel.json',
  '.env', '.env.example', '.gitignore',
  'BUILD_NOTES.md', 'DEPLOY.md', 'README.md', 'HANDOVER.md',
]);

/** Give the Vercel-style handlers the response methods they expect. */
function shimResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

/**
 * Collect and parse a JSON request body, with a hard size cap.
 *
 * On overflow we stop buffering but keep draining the socket rather than
 * destroying it immediately. Destroying mid-upload resets the connection, and
 * the client sees a network error instead of the 413 we are trying to send.
 * Draining lets the request finish so the response can actually be delivered.
 *
 * Draining is itself bounded by HARD_ABORT_BYTES, so a client streaming
 * gigabytes still gets cut off rather than being read politely forever.
 */
const HARD_ABORT_BYTES = 8 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    let chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (!tooLarge && size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks = []; // release what we already buffered
      }
      if (size > HARD_ABORT_BYTES) {
        req.destroy();
        return reject(new Error('PAYLOAD_TOO_LARGE'));
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('PAYLOAD_TOO_LARGE'));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? INDEX : decodeURIComponent(pathname).replace(/^\/+/, '');

  // Path traversal guard: resolve, then confirm the result is still inside ROOT.
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  const base = path.basename(full);
  if (base.startsWith('.') || DENY.has(base) || rel.startsWith('test/') || rel.startsWith('api/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const type = CONTENT_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      // The HTML is the app itself and changes on deploy; don't let browsers
      // cache a stale copy of it. Everything else can be cached briefly.
      'Cache-Control': base === INDEX ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  if (pathname === '/api/healthz') {
    return healthzHandler(req, shimResponse(res));
  }

  if (pathname === '/api/chat') {
    shimResponse(res);
    if (req.method === 'POST') {
      try {
        req.body = await readJsonBody(req);
      } catch (e) {
        const tooLarge = e.message === 'PAYLOAD_TOO_LARGE';
        return res.status(tooLarge ? 413 : 400).json({
          error: { message: tooLarge ? 'Request body too large.' : 'Request body was not valid JSON.' },
        });
      }
    }
    // Handler enforces method, key presence, rate limit and field validation.
    return chatHandler(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method not allowed');
  }

  return serveStatic(res, pathname);
});

server.listen(PORT, HOST, () => {
  const trusting = process.env.KOLOS_TRUST_PROXY === '1' || !!PAAS;
  console.log(`Kolos listening on http://${HOST}:${PORT}`);
  console.log(`  Platform           : ${PAAS || 'self-hosted'}`);
  console.log(`  API key configured : ${process.env.ANTHROPIC_API_KEY ? 'yes' : 'NO — /api/chat will return 500'}`);
  console.log(`  Client IP source   : ${trusting ? 'X-Forwarded-For (trusting one proxy hop)' : 'socket address (no proxy trusted)'}`);
  if (HOST === '0.0.0.0' && !PAAS) {
    console.warn('  WARNING: bound to 0.0.0.0 with no managed platform detected.');
    console.warn('  This port is reachable from the internet over plain, unencrypted HTTP.');
    console.warn('  Bind to 127.0.0.1 and put Caddy or nginx in front instead.');
  }
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

module.exports = server;
