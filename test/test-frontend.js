// End-to-end test of Kolos_Funding_Advisor.html against a local server that
// emulates Vercel's routing (rewrite / -> the HTML, /api/* -> the functions),
// with /api/chat stubbed to return an Anthropic-shaped payload so we never
// spend real API credit.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(require('child_process')
  .execSync('npm root -g').toString().trim() + '/playwright');

const APP = path.join(__dirname, '..');
const healthz = require(path.join(APP, 'api', 'healthz.js'));

// Canned Anthropic response: text block with citations + a web_search_tool_result
// block, i.e. exactly the shape extractResponse() is written against.
const CANNED = {
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Ukraine farm grants' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [
        { type: 'web_search_result', url: 'https://www.me.gov.ua/example-grant', title: 'Ministry of Economy — grant programme' },
        { type: 'web_search_result', url: 'https://diia.gov.ua/example', title: 'Diia — application portal' },
      ],
    },
    {
      type: 'text',
      text: 'Here are two programmes worth checking:\n\n- **Horticulture grant** — up to UAH 1,000,000, apply via Diia.\n- **5-7-9% loans** — via partner banks. https://diia.gov.ua/example\n\nConfirm deadlines with the funding body before applying.',
      citations: [
        { type: 'web_search_result_location', url: 'https://www.me.gov.ua/example-grant', title: 'Ministry of Economy — grant programme' },
      ],
    },
  ],
};

let lastRequestBody = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/healthz') {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; };
    return healthz(req, res);
  }

  if (url.pathname === '/api/chat') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      lastRequestBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(CANNED));
    });
    return;
  }

  // vercel.json rewrite: "/" -> "/Kolos_Funding_Advisor.html"
  const file = url.pathname === '/' ? 'Kolos_Funding_Advisor.html' : url.pathname.slice(1);
  const full = path.join(APP, file);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(full));
  }
  res.writeHead(404).end('Not found');
});

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(async () => {
  await new Promise((r) => server.listen(3999, r));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('http://localhost:3999/', { waitUntil: 'networkidle' });

  // --- Page loads and renders
  check('title renders', (await page.title()).includes('Kolos'));
  check('welcome heading present', await page.locator('#welcomeHeading').isVisible());
  check('10 suggestion chips rendered', (await page.locator('.chip').count()) === 10,
    await page.locator('.chip').count());
  check('no uncaught page errors on load', pageErrors.length === 0, pageErrors);

  // --- Chip set is farmer-situation led, and the two dead-end chips are gone
  const chipLabels = await page.locator('.chip').allInnerTexts();
  check('frontline chip present', chipLabels.some(l => /frontline/i.test(l)), chipLabels);
  check('war-damage rebuild chip present', chipLabels.some(l => /rebuild/i.test(l)), chipLabels);
  check('generator/energy chip present', chipLabels.some(l => /generator/i.test(l)), chipLabels);
  check('how-to-apply chip present', chipLabels.some(l => /need to apply/i.test(l)), chipLabels);
  check('EBRD/World Bank dead-end chip removed',
    !chipLabels.some(l => /EBRD|World Bank/i.test(l)), chipLabels);

  // --- escapeHtml does not escape double quotes, so no chip question may
  //     contain one or it breaks out of the data-q attribute.
  const quoteSafe = await page.evaluate(() =>
    Object.values(UI).every(t => t.chips.every(c => !c.q.includes('"') && !c.label.includes('"'))));
  check('no chip text contains a double quote (attribute-injection guard)', quoteSafe === true);

  // --- healthz through the same routing
  const hz = await page.evaluate(async () => (await fetch('/api/healthz')).json());
  check('/api/healthz -> {ok:true}', hz.ok === true, hz);

  // --- Farm profile feeds into the system prompt
  await page.locator('#profileToggle').click();
  await page.locator('#fRegion').fill('Poltava oblast');
  await page.locator('#fSector').selectOption({ index: 1 }); // Livestock / dairy
  await page.locator('#profileSave').click();
  check('saved-note shown after saving profile', await page.locator('#profileSavedNote').isVisible());

  // --- Ask a question via a suggestion chip
  await page.locator('.chip').first().click();
  await page.locator('.msg-row.agent .bubble').first().waitFor({ timeout: 10000 });

  const bubbleText = await page.locator('.msg-row.agent .bubble').first().innerText();
  check('answer text rendered', bubbleText.includes('Horticulture grant'), bubbleText.slice(0, 80));
  check('markdown bold converted to <strong>',
    (await page.locator('.msg-row.agent .bubble strong').count()) >= 1);
  check('bullet list converted to <ul><li>',
    (await page.locator('.msg-row.agent .bubble ul li').count()) === 2,
    await page.locator('.msg-row.agent .bubble ul li').count());
  check('welcome panel removed after first message',
    (await page.locator('#welcome').count()) === 0);

  // --- Source chips: dedup across citations + search results (3 refs -> 2 unique URLs)
  const sourcesLabel = await page.locator('.sources-toggle').first().innerText();
  check('sources toggle says "Sources (2)" after dedup', sourcesLabel.trim() === 'Sources (2)', sourcesLabel);
  await page.locator('.sources-toggle').first().click();
  check('source chips visible after toggle', await page.locator('.source-chip').first().isVisible());
  const firstHref = await page.locator('.source-chip').first().getAttribute('href');
  check('source chip links to the real URL', firstHref === 'https://www.me.gov.ua/example-grant', firstHref);

  // --- What actually got POSTed to /api/chat
  check('system prompt sent as a string', typeof lastRequestBody.system === 'string');
  check('profile injected into system prompt',
    lastRequestBody.system.includes('Poltava oblast') && lastRequestBody.system.includes('Livestock'),
    lastRequestBody.system.slice(-200));
  check('language instruction present (English)',
    lastRequestBody.system.includes('Respond in English'));
  check('messages array shaped for the Messages API',
    Array.isArray(lastRequestBody.messages) &&
    lastRequestBody.messages[0].role === 'user' &&
    typeof lastRequestBody.messages[0].content === 'string', lastRequestBody.messages);
  check('no API key anywhere in the outbound browser request',
    !JSON.stringify(lastRequestBody).includes('sk-ant'));

  // --- The programme reference reaches the API, with its guard rails intact
  const sys = lastRequestBody.system;
  check('programme reference embedded in the system prompt',
    sys.includes('PROGRAMME REFERENCE'), sys.length);
  check('reference carries its compiled-on date',
    sys.includes('last verified 22 July 2026'));
  check('closed FAO-EU cycle marked [EXPIRED]',
    /2\.2 FAO–EU grant cycles \[EXPIRED/.test(sys));
  check('both lapsed FAO-EU intake dates named as closed',
    sys.includes('closed 17 April 2026') && sys.includes('closed 14 June 2026'));
  check('unconfirmed programmes marked [STATUS UNVERIFIED]',
    (sys.match(/\[STATUS UNVERIFIED\]/g) || []).length >= 8,
    (sys.match(/\[STATUS UNVERIFIED\]/g) || []).length);
  check('rule forbidding stale figures is present',
    sys.includes('Never state an amount, percentage, deadline'));
  check('rule that live search overrides the reference is present',
    sys.includes('the search wins'));
  check('USAID framed as not available unless proven otherwise',
    sys.includes('TREAT AS NOT AVAILABLE UNLESS SEARCH PROVES OTHERWISE'));
  check('Ukraine Facility marked as not farmer-facing',
    sys.includes('CONTEXT ONLY, NOT FARMER-FACING'));
  check('livestock routed to the State Agrarian Registry, not Diia',
    sys.includes('State Agrarian Registry (NOT Diia)'));
  console.log('  info: system prompt is ' + sys.length + ' chars (~' +
    Math.round(sys.length / 3.7) + ' tokens, estimated)');

  // --- History window: long conversations must not resend everything
  const hist = await page.evaluate(() => {
    const saved = conversation.slice();
    conversation = [];
    for (let i = 1; i <= 15; i++) {
      conversation.push({ role: 'user', text: 'q' + i });
      conversation.push({ role: 'assistant', text: 'a' + i });
    }
    const capped = buildMessages();
    conversation = [{ role: 'user', text: 'only one' }];
    const short = buildMessages();
    conversation = saved;
    return { capped, short, cappedFirst: capped[0], cappedLen: capped.length, shortLen: short.length };
  });
  check('long conversation trimmed to the last 8 messages',
    hist.cappedLen === 8, hist.cappedLen);
  check('trimmed window still starts with a user message (API requires it)',
    hist.cappedFirst.role === 'user', hist.cappedFirst);
  check('trimmed window keeps the most recent exchanges',
    hist.capped[hist.capped.length - 1].content === 'a15', hist.capped[hist.capped.length - 1]);
  check('short conversations pass through untouched', hist.shortLen === 1, hist.shortLen);

  // --- Persistence across reload
  await page.reload({ waitUntil: 'networkidle' });
  check('conversation restored from localStorage after reload',
    (await page.locator('.msg-row').count()) === 2, await page.locator('.msg-row').count());
  check('sources restored too', (await page.locator('.source-chip').count()) === 2);
  check('region restored into the form', (await page.locator('#fRegion').inputValue()) === 'Poltava oblast');

  // --- Ukrainian toggle
  await page.locator('#langUk').click();
  const tagline = await page.locator('#tagline').innerText();
  check('UA toggle switches UI text to Ukrainian', /Порадник/.test(tagline), tagline);
  check('html lang attribute switches to uk',
    (await page.getAttribute('html', 'lang')) === 'uk');
  await page.locator('#input').fill('Тест');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('.msg-row').length >= 4, null, { timeout: 10000 });
  check('language instruction switches to Ukrainian in system prompt',
    lastRequestBody.system.includes('Respond in Ukrainian'),
    lastRequestBody.system.slice(lastRequestBody.system.indexOf('Respond in'), lastRequestBody.system.indexOf('Respond in') + 60));

  // --- XSS: user text must not be able to inject markup
  await page.locator('#input').fill('<img src=x onerror="window.__pwned=1">');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('.msg-row').length >= 6, null, { timeout: 10000 });
  check('user HTML is escaped, not executed',
    (await page.evaluate(() => window.__pwned)) === undefined);

  // --- Error path: server returns an error object
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Server is not configured with an API key.' } }) }));
  await page.locator('#input').fill('another question');
  await page.locator('#sendBtn').click();
  await page.locator('.error-note').first().waitFor({ timeout: 10000 });
  const errText = await page.locator('.error-note').first().innerText();
  check('server error surfaced to the user', errText.includes('not configured'), errText);
  check('typing indicator cleared after error',
    (await page.locator('#typingRow').count()) === 0);
  check('send button re-enabled after error',
    !(await page.locator('#sendBtn').isDisabled()));

  // --- New chat clears everything
  await page.unroute('**/api/chat');
  await page.locator('#resetBtn').click();
  await page.waitForLoadState('networkidle');
  check('New chat clears the thread', (await page.locator('.msg-row').count()) === 0,
    await page.locator('.msg-row').count());
  check('New chat clears localStorage',
    (await page.evaluate(() => localStorage.getItem('kolos_state_v1'))) === null);

  const appErrors = consoleErrors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|fonts.googleapis|status of 500/.test(e));
  check('no app console errors (font CDN + the deliberate 500 excluded)', appErrors.length === 0, appErrors);
  console.log('  note: ' + (consoleErrors.length - appErrors.length) + ' ignored console entries = Google Fonts CDN blocked in this sandbox + the deliberate 500 error test');

  await page.goto("http://localhost:3999/",{waitUntil:"domcontentloaded"});await page.waitForTimeout(400);await page.screenshot({path:"/tmp/kolos-fixed-page.png"});await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
