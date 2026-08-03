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
    check('web search capped per question (cost control)',
      sentBody.tools[0].max_uses === 5, sentBody && sentBody.tools[0]);
    check('default max_tokens applied when client sends none',
      sentBody.max_tokens === 2000, sentBody && sentBody.max_tokens);
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

  // --- 7b. pause_turn: the bug that shipped to production.
  //         The API pauses a long search turn and returns partial content.
  //         Unhandled, that fragment renders as a finished answer.
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;

    const sentBodies = [];
    let call = 0;
    global.fetch = async (url, opts) => {
      sentBodies.push(JSON.parse(opts.body));
      call += 1;
      if (call === 1) {
        return { status: 200, json: async () => ({
          stop_reason: 'pause_turn',
          content: [
            { type: 'text', text: 'Let me verify the current numbers.' },
            { type: 'web_search_tool_result', tool_use_id: 't1',
              content: [{ type: 'web_search_result', url: 'https://a.example', title: 'A' }] },
          ],
        }) };
      }
      return { status: 200, json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Here is the actual answer.\n\n[[NEXT]] one || two' }],
      }) };
    };

    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '192.0.2.201' } }), res);
    global.fetch = realFetch;

    check('paused turn is resumed rather than returned as-is', call === 2, { call });
    check('final stop_reason is end_turn, not pause_turn',
      res.body.stop_reason === 'end_turn', res.body && res.body.stop_reason);
    check('resume count reported', res.body.kolos_resumes === 1, res.body && res.body.kolos_resumes);
    check('content from BOTH legs is merged', res.body.content.length === 3,
      res.body && res.body.content.map(b => b.type));
    check('sources gathered before the pause survive',
      res.body.content.some(b => b.type === 'web_search_tool_result'), res.body.content);
    check('the real answer is present', res.body.content.some(
      b => b.type === 'text' && b.text.includes('actual answer')), res.body.content);
    check('paused assistant message sent back unchanged on resume',
      sentBodies[1].messages.length === sentBodies[0].messages.length + 1 &&
      sentBodies[1].messages[sentBodies[1].messages.length - 1].role === 'assistant',
      sentBodies[1] && sentBodies[1].messages);
  }

  // --- 7c. A turn that never stops pausing must be bounded, not infinite.
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return { status: 200, json: async () => ({
        stop_reason: 'pause_turn',
        content: [{ type: 'text', text: 'chunk ' + calls }],
      }) };
    };
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '192.0.2.202' } }), res);
    global.fetch = realFetch;
    check('endless pausing is capped at 1 + MAX_PAUSE_RESUMES calls', calls === 4, { calls });
    check('caller still gets what was gathered', res.body.content.length === 4, res.body.content.length);
    check('stop_reason stays pause_turn so the UI can flag it as incomplete',
      res.body.stop_reason === 'pause_turn', res.body && res.body.stop_reason);
  }

  // --- 7d. An upstream error mid-resume is passed through, not swallowed.
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;
    let n = 0;
    global.fetch = async () => {
      n += 1;
      if (n === 1) return { status: 200, json: async () => ({
        stop_reason: 'pause_turn', content: [{ type: 'text', text: 'partial' }] }) };
      return { status: 529, json: async () => ({ error: { message: 'overloaded' } }) };
    };
    const res = mockRes();
    await handler(mockReq({ headers: { 'x-forwarded-for': '192.0.2.203' } }), res);
    global.fetch = realFetch;
    check('error during resume surfaces the error status', res.statusCode === 529, res.statusCode);
    check('error body is passed through', /overloaded/.test(res.body.error.message), res.body);
  }

  // --- 7e. Defaults raised for hand-holding answers
  {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-tests';
    delete require.cache[require.resolve(HANDLER)];
    const handler = require(HANDLER);
    const realFetch = global.fetch;
    let sent = null;
    global.fetch = async (url, opts) => {
      sent = JSON.parse(opts.body);
      return { status: 200, json: async () => ({ stop_reason: 'end_turn', content: [] }) };
    };
    const res = mockRes();
    await handler(mockReq({
      headers: { 'x-forwarded-for': '192.0.2.204' },
      body: { system: 'sys', messages: [{ role: 'user', content: 'hi' }] },
    }), res);
    global.fetch = realFetch;
    check('default max_tokens raised to 2000', sent.max_tokens === 2000, sent && sent.max_tokens);
    check('web search allowance raised to 5', sent.tools[0].max_uses === 5, sent && sent.tools[0]);
  }

  // --- 8. healthz
  {
    const healthz = require(path.join(__dirname, '..', 'api', 'healthz.js'));
    const res = mockRes();
    healthz({ method: 'GET' }, res);
    check('healthz -> 200 {ok:true}', res.statusCode === 200 && res.body.ok === true, res.body);
    check('healthz reports a build string', typeof res.body.build === 'string' && res.body.build.length > 0, res.body);

    // The deployed build must be identifiable without guessing from the UI.
    const fs2 = require('fs');
    const html = fs2.readFileSync(path.join(__dirname, '..', 'Kolos_Funding_Advisor.html'), 'utf8');
    const m = html.match(/const KOLOS_BUILD = '([^']+)'/);
    check('HTML carries a build marker', !!m, m);
    check('HTML build matches the healthz build', m && m[1] === res.body.build,
      { html: m && m[1], healthz: res.body.build });
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

run();
