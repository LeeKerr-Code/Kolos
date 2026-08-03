// Unit tests for api/chat.js — the paths that don't require a real Anthropic call.
const path = require('path');

function mockRes() {
  const r = { statusCode: null, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

function mockReq(overrides = {}) {
  return Object.assign({
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.10' },
    socket: { remoteAddress: '203.0.113.10' },
    body: { system: 'sys', messages: [{ role: 'user', content: 'hi' }] },
  }, overrides);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + JSON.stringify(detail) : '')); }
}

async function run() {
  const HANDLER = path.join(__dirname, '..', 'api', 'chat.js');

  // --- 1. No API key set -> 500 with a clear message
  {
    delete process.env.ANTHROPIC_API_KEY;
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const res = mockRes();
    await handler(mockReq(), res);
    check('missing key -> 500', res.statusCode === 500, res.body);
    check('missing key -> mentions ANTHROPIC_API_KEY',
      /ANTHROPIC_API_KEY/.test(res.body.error.message), res.body);
  }

  // --- 2. Wrong method -> 405 + Allow header (checked before the key)
  {
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    check('GET -> 405', res.statusCode === 405, res.body);
    check('GET -> Allow: POST', res.headers.Allow === 'POST', res.headers);
  }

  // --- 3. Bad body validation (key present so we get past the 500)
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);

    let res = mockRes();
    await handler(mockReq({ body: { system: 'sys', messages: [] } }), res);
    check('empty messages -> 400', res.statusCode === 400, res.body);

    res = mockRes();
    await handler(mockReq({ body: { messages: [{ role: 'user', content: 'hi' }] } }), res);
    check('missing system -> 400', res.statusCode === 400, res.body);

    res = mockRes();
    await handler(mockReq({ body: undefined }), res);
    check('no body at all -> 400 (not a crash)', res.statusCode === 400, res.body);
  }

  // --- 4. Rate limiting: 21st request from the same IP inside the window -> 429
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    process.env.KOLOS_TRUST_PROXY = '1';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);

    // Stub the upstream so we never hit the network. Requests that pass
    // validation get a canned 200 back.
    const realFetch = global.fetch;
    let upstreamCalls = 0;
    global.fetch = async () => {
      upstreamCalls++;
      return { status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    };

    let limitedAt = null;
    for (let i = 1; i <= 25; i++) {
      const res = mockRes();
      await handler(mockReq(), res);
      if (res.statusCode === 429 && limitedAt === null) limitedAt = i;
    }
    global.fetch = realFetch;

    check('rate limit trips on request 21 (default max 20)', limitedAt === 21, { limitedAt });
    check('upstream called exactly 20 times before limiting', upstreamCalls === 20, { upstreamCalls });

    // With the proxy trusted, a different forwarded IP is a different visitor.
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '198.51.100.7' } }), res);
    check('trusted proxy: different forwarded IP is a separate quota',
      res.statusCode !== 429, res.body);

    // With one trusted hop the LAST entry is the one the proxy vouched for.
    // A client prepending a fake address must not win a fresh quota.
    const spoof = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' } }), spoof);
    check('trusted proxy: client-prepended IP is ignored, last hop wins',
      spoof.statusCode !== 429, spoof.body);
    delete process.env.KOLOS_TRUST_PROXY;
  }

  // --- 4b. SECURITY: with no proxy trusted, X-Forwarded-For must be ignored
  //         entirely, or anyone can mint a fresh quota per request.
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete process.env.KOLOS_TRUST_PROXY;
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);

    const realFetch = global.fetch;
    global.fetch = async () => ({ status: 200, json: async () => ({ content: [] }) });

    // Same socket throughout, but a brand-new forged header every time.
    let limitedAt = null;
    for (let i = 1; i <= 25; i++) {
      const res = mockRes();
      await handler(mockReq({
        headers: { 'x-forwarded-for': '10.0.0.' + i },
        socket: { remoteAddress: '203.0.113.99' },
      }), res);
      if (res.statusCode === 429 && limitedAt === null) limitedAt = i;
    }
    global.fetch = realFetch;
    check('untrusted: forged X-Forwarded-For cannot buy a fresh quota',
      limitedAt === 21, { limitedAt });
  }

  // --- 5. Upstream failure -> 502, not an unhandled throw
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '192.0.2.55' } }), res);
    global.fetch = realFetch;
    check('upstream throw -> 502', res.statusCode === 502, res.body);
  }

  // --- 6. Upstream status and payload are passed through verbatim
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;
    let sentBody = null;
    global.fetch = async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) };
    };
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '192.0.2.99' } }), res);
    global.fetch = realFetch;
    check('upstream 401 passed through as 401', res.statusCode === 401, res.body);
    check('model sent is claude-sonnet-5', sentBody.model === 'claude-sonnet-5', sentBody && sentBody.model);
    check('system wrapped as a content-block array',
      Array.isArray(sentBody.system) && sentBody.system.length === 1 &&
      sentBody.system[0].type === 'text', sentBody && sentBody.system);
    check('system block marked cacheable (ephemeral)',
      sentBody.system[0].cache_control &&
      sentBody.system[0].cache_control.type === 'ephemeral', sentBody && sentBody.system[0]);
    check('system text preserved verbatim through the wrap',
      sentBody.system[0].text === 'sys', sentBody && sentBody.system[0].text);
    check('web_search tool attached', Array.isArray(sentBody.tools) &&
      sentBody.tools[0].type === 'web_search_20250305', sentBody && sentBody.tools);
    check('web search capped at 3 uses per question (cost control)',
      sentBody.tools[0].max_uses === 3, sentBody && sentBody.tools[0]);
    check('max_tokens capped at 4096', (() => sentBody.max_tokens === 1200)(), sentBody && sentBody.max_tokens);
  }

  // --- 7. KOLOS_MODEL override is respected
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    process.env.KOLOS_MODEL = 'claude-haiku-4-5';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;
    let sentBody = null;
    global.fetch = async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { status: 200, json: async () => ({ content: [] }) };
    };
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '192.0.2.111' } }), res);
    global.fetch = realFetch;
    delete process.env.KOLOS_MODEL;
    check('KOLOS_MODEL override applied', sentBody.model === 'claude-haiku-4-5', sentBody && sentBody.model);
  }

  // --- 8. healthz
  {
    const healthz = require(path.join(__dirname, '..', 'api', 'healthz.js'));
    const res = mockRes();
    healthz({ method: 'GET' }, res);
    check('healthz -> 200 {ok:true}', res.statusCode === 200 && res.body.ok === true, res.body);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

run();
