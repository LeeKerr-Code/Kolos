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
  stop_reason: 'end_turn',
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
      text: 'Here are two programmes worth checking:\n\n- **Horticulture grant** — up to UAH 1,000,000, apply via Diia.\n- **5-7-9% loans** — via partner banks. https://diia.gov.ua/example\n\nConfirm deadlines with the funding body before applying.\n\n[[NEXT]] Am I eligible for the horticulture grant? || What documents do I need for Diia? || What if I don\'t qualify?',
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

  /* Wait for N *completed* answers.
     The obvious condition — counting .msg-row — is wrong, because the typing
     indicator is itself a .msg-row. Waiting on it returns the moment the
     spinner appears, before the request has even been sent, which made three
     assertions race the answer they were about to inspect. */
  const waitForAnswers = (n) => page.waitForFunction(
    (want) => document.querySelectorAll('.msg-row.agent:not(.typing)').length >= want,
    n, { timeout: 15000 });

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
  await waitForAnswers(1);

  const bubbleText = await page.locator('.msg-row.agent:not(.typing) .bubble').first().innerText();
  check('answer text rendered', bubbleText.includes('Horticulture grant'), bubbleText.slice(0, 80));
  check('markdown bold converted to <strong>',
    (await page.locator('.msg-row.agent:not(.typing) .bubble strong').count()) >= 1);
  check('bullet list converted to <ul><li>',
    (await page.locator('.msg-row.agent:not(.typing) .bubble ul li').count()) === 2,
    await page.locator('.msg-row.agent:not(.typing) .bubble ul li').count());
  check('welcome panel removed after first message',
    (await page.locator('#welcome').count()) === 0);

  // --- Follow-up suggestions
  check('3 follow-up chips rendered under the answer',
    (await page.locator('.followup-chip').count()) === 3,
    await page.locator('.followup-chip').count());
  check('follow-up marker never reaches the visible answer',
    !bubbleText.includes('[[NEXT]]') && !bubbleText.includes('||'), bubbleText.slice(-120));
  check('follow-up text is the model\'s, not the fallback',
    (await page.locator('.followup-chip').first().innerText()).includes('horticulture grant'),
    await page.locator('.followup-chip').first().innerText());
  check('next-steps label shown', /Next steps/i.test(
    await page.locator('.followups-label').first().innerText()));

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

  // --- Clicking a follow-up asks it, and chips move to the newest answer only
  await page.locator('.followup-chip').first().click();
  await waitForAnswers(2);
  check('clicking a follow-up sends it as a question',
    lastRequestBody.messages[lastRequestBody.messages.length - 1].content
      .includes('eligible for the horticulture grant'),
    lastRequestBody.messages[lastRequestBody.messages.length - 1].content);
  check('only one follow-up row exists after a second answer',
    (await page.locator('.followups').count()) === 1,
    await page.locator('.followups').count());
  check('the surviving row sits under the newest answer',
    (await page.locator('.msg-row.agent:not(.typing)').last().locator('.followups').count()) === 1);

  // --- Fallback when the model omits the marker entirely
  const fb = await page.evaluate(() => {
    const parsed = extractFollowUps('An answer with no marker at all.');
    return { text: parsed.text, count: parsed.followUps.length, fallback: UI[lang].followUpFallback.length };
  });
  check('answer without a marker parses cleanly', fb.text === 'An answer with no marker at all.', fb);
  check('no follow-ups parsed when the marker is absent', fb.count === 0, fb);
  check('a fixed funnel fallback exists so chips are never empty', fb.fallback >= 3, fb);

  // --- Marker stripping is forgiving about placement and case
  const strip = await page.evaluate(() => [
    extractFollowUps('Answer.\n\n[[NEXT]] one || two').text,
    extractFollowUps('Answer.\n[[next]] one || two').text,
    extractFollowUps('Answer.[[NEXT]] one').text,
    extractFollowUps('Answer.\n\n[[NEXT]] one || two || three || four').followUps.length,
    extractFollowUps('Answer.\n\n[[NEXT]] a ||  || valid one').followUps.length,
  ]);
  check('marker stripped when preceded by a blank line', strip[0] === 'Answer.', strip[0]);
  check('marker stripped case-insensitively', strip[1] === 'Answer.', strip[1]);
  check('marker stripped even when inline', strip[2] === 'Answer.', strip[2]);
  check('suggestions capped at 3', strip[3] === 3, strip[3]);
  check('empty and one-character suggestions discarded', strip[4] === 1, strip[4]);

  // --- Model-generated text carrying a quote cannot break out of markup
  const xss = await page.evaluate(() => {
    const { followUps } = extractFollowUps('A.\n\n[[NEXT]] say "hello" <img src=x onerror=alert(1)>');
    return { raw: followUps[0], escaped: escapeHtml(followUps[0]) };
  });
  check('escapeHtml now escapes double quotes (attribute-safe)',
    xss.escaped.includes('&quot;') && !xss.escaped.includes('"'), xss.escaped);
  check('escapeHtml still neutralises tags', xss.escaped.includes('&lt;img'), xss.escaped);

  // --- A stopped answer must be visibly flagged, never shown as finished
  const trunc = await page.evaluate(() => {
    const flag = (sr) => !!sr && sr !== 'end_turn' && sr !== 'stop_sequence';
    return { end: flag('end_turn'), stop: flag('stop_sequence'),
             pause: flag('pause_turn'), max: flag('max_tokens'), none: flag(undefined) };
  });
  check('end_turn is not treated as truncated', trunc.end === false, trunc);
  check('stop_sequence is not treated as truncated', trunc.stop === false, trunc);
  check('pause_turn IS treated as truncated', trunc.pause === true, trunc);
  check('max_tokens IS treated as truncated', trunc.max === true, trunc);
  check('a missing stop_reason is not treated as truncated', trunc.none === false, trunc);

  const noteShown = await page.evaluate(() => {
    const row = document.querySelector('.msg-row.agent:not(.typing)');
    const before = document.querySelectorAll('.truncation-note').length;
    renderTruncationNote(row);
    const after = document.querySelectorAll('.truncation-note').length;
    const text = document.querySelector('.truncation-note').textContent;
    document.querySelector('.truncation-note').remove();
    return { before, after, text };
  });
  check('truncation note renders into the answer bubble',
    noteShown.after === noteShown.before + 1, noteShown);
  check('truncation note says the answer is incomplete',
    /incomplete/i.test(noteShown.text), noteShown.text);

  // --- A truncated answer must offer a way to finish it, not just a warning
  const cont = await page.evaluate(() => {
    const row = document.querySelector('.msg-row.agent:not(.typing)');
    const existing = row.querySelector('.followups');
    if (existing) existing.remove();
    renderFollowUps(row, ['normal one', 'normal two'], true);
    const chips = [...row.querySelectorAll('.followup-chip')];
    const out = {
      count: chips.length,
      firstLabel: chips[0].textContent,
      firstIsPrimary: chips[0].classList.contains('followup-chip-primary'),
      othersPlain: chips.slice(1).every(c => !c.classList.contains('followup-chip-primary')),
    };
    row.querySelector('.followups').remove();
    return out;
  });
  check('truncated answer offers a finish button first',
    /finish that answer/i.test(cont.firstLabel), cont);
  check('finish button is visually primary', cont.firstIsPrimary === true, cont);
  check('normal suggestions stay alongside it', cont.count === 3, cont);
  check('only the finish button is styled primary', cont.othersPlain === true, cont);

  const contQ = await page.evaluate(() => UI.en.continueQuestion);
  check('finish button sends an instruction not to repeat itself',
    /without repeating/i.test(contQ), contQ);

  const notTrunc = await page.evaluate(() => {
    const row = document.querySelector('.msg-row.agent:not(.typing)');
    const existing = row.querySelector('.followups');
    if (existing) existing.remove();
    renderFollowUps(row, ['a', 'b'], false);
    const n = row.querySelectorAll('.followup-chip-primary').length;
    row.querySelector('.followups').remove();
    return n;
  });
  check('a complete answer gets no finish button', notTrunc === 0, notTrunc);

  // --- Build marker is visible for checking what is actually deployed
  const build = await page.evaluate(() => KOLOS_BUILD);
  check('build marker exposed in the page', /^\d{4}-\d{2}-\d{2}\.\d+$/.test(build), build);

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
  // Two exchanges by now: the chip-clicked question plus the follow-up click.
  check('conversation restored from localStorage after reload',
    (await page.locator('.msg-row').count()) === 4, await page.locator('.msg-row').count());
  check('sources restored for both answers',
    (await page.locator('.source-chip').count()) === 4, await page.locator('.source-chip').count());
  check('follow-ups restored, and only under the last answer',
    (await page.locator('.followups').count()) === 1, await page.locator('.followups').count());
  check('restored follow-ups are the model\'s, not the fallback',
    (await page.locator('.followup-chip').first().innerText()).includes('horticulture grant'),
    await page.locator('.followup-chip').first().innerText());
  check('region restored into the form', (await page.locator('#fRegion').inputValue()) === 'Poltava oblast');

  // --- Ukrainian toggle
  await page.locator('#langUk').click();
  const tagline = await page.locator('#tagline').innerText();
  check('UA toggle switches UI text to Ukrainian', /Порадник/.test(tagline), tagline);
  check('html lang attribute switches to uk',
    (await page.getAttribute('html', 'lang')) === 'uk');
  await page.locator('#input').fill('Тест');
  await page.locator('#sendBtn').click();
  await waitForAnswers(3);
  check('language instruction switches to Ukrainian in system prompt',
    lastRequestBody.system.includes('Respond in Ukrainian'),
    lastRequestBody.system.slice(lastRequestBody.system.indexOf('Respond in'), lastRequestBody.system.indexOf('Respond in') + 60));

  // --- XSS: user text must not be able to inject markup
  await page.locator('#input').fill('<img src=x onerror="window.__pwned=1">');
  await page.locator('#sendBtn').click();
  await waitForAnswers(4);
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
