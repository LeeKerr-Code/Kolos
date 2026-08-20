// Tests for the History drawer, edit-and-re-ask, and multi-chat storage
// added in build 2026-08-20.12. Uses the same stubbed /api/chat as
// test-frontend.js, so it spends no API credit.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(require('child_process')
  .execSync('npm root -g').toString().trim() + '/playwright');

const APP = path.join(__dirname, '..');
const healthz = require(path.join(APP, 'api', 'healthz.js'));

let answerSeq = 0;
const canned = () => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'Answer number ' + (++answerSeq) + '.' }],
});

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
      res.end(JSON.stringify(canned()));
    });
    return;
  }
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
  await new Promise((r) => server.listen(3998, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const waitForAnswers = (n) => page.waitForFunction(
    (want) => document.querySelectorAll('.msg-row.agent:not(.typing)').length >= want,
    n, { timeout: 15000 });
  const ask = async (text) => {
    await page.locator('#input').fill(text);
    const before = await page.locator('.msg-row.agent:not(.typing)').count();
    await page.locator('#sendBtn').click();
    await waitForAnswers(before + 1);
  };
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('kolos_state_v2') || 'null'));
  const closeDrawer = async () => {
    if (await page.locator('#histDrawer').evaluate(el => el.classList.contains('open'))) {
      await page.locator('#histClose').click();
      await page.waitForTimeout(250);
    }
  };

  await page.goto('http://localhost:3998/', { waitUntil: 'networkidle' });

  // --- max_tokens regression: the frontend must not re-impose a low ceiling
  await ask('First question about grants');
  check('frontend requests max_tokens 8000', lastRequestBody.max_tokens === 8000, lastRequestBody.max_tokens);

  // --- Drawer opens and lists questions
  check('History button present', await page.locator('#historyBtn').isVisible());
  await page.locator('#historyBtn').click();
  check('drawer opens', await page.locator('#histDrawer.open').isVisible());
  check('one question listed', (await page.locator('#histBody [data-goto]').count()) === 1);
  check('empty-saved-chats notice shown', (await page.locator('#histBody .drawer-empty').count()) >= 1);

  await closeDrawer();
  await ask('Second question about loans');
  await ask('Third question about demining');
  await page.locator('#historyBtn').click();
  check('three questions listed after three asks',
    (await page.locator('#histBody [data-goto]').count()) === 3,
    await page.locator('#histBody [data-goto]').count());

  // --- Tapping a question closes the drawer and scrolls to it
  await page.locator('#histBody [data-goto]').first().click();
  await page.waitForTimeout(300);
  check('drawer closes after jumping to a question',
    !(await page.locator('#histDrawer').evaluate(el => el.classList.contains('open'))));

  // --- Edit and re-ask truncates everything after the edited question
  await page.locator('#historyBtn').click();
  await page.locator('#histBody [data-edit]').first().click();
  check('edit box appears', await page.locator('#histBody textarea').isVisible());
  const warn = await page.locator('#histBody .edit-warn').innerText();
  check('warning names the number of answers to be removed', /\b3\b/.test(warn), warn);

  await page.locator('#histBody textarea').fill('First question, reworded');
  await page.locator('#histBody .edit-actions .ghost-btn').first().click();
  await waitForAnswers(1);
  await page.waitForTimeout(300);

  const rows = await page.locator('.msg-row.user .bubble').allInnerTexts();
  check('only the reworded question remains', rows.length === 1 && /reworded/.test(rows[0]), rows);
  check('later answers were discarded',
    (await page.locator('.msg-row.agent:not(.typing)').count()) === 1,
    await page.locator('.msg-row.agent:not(.typing)').count());
  const sent = lastRequestBody.messages.map(m => m.content);
  check('re-ask sends the reworded question, not the original',
    sent.some(c => /reworded/.test(c)) && !sent.some(c => /Second question/.test(c)), sent);

  // --- New chat archives instead of destroying
  await closeDrawer();
  await page.locator('#resetBtn').click();
  await page.waitForTimeout(250);
  check('thread cleared after New chat', (await page.locator('.msg-row').count()) === 0);
  check('welcome panel returns after New chat', await page.locator('#welcome').isVisible());
  await ask('A question in the second chat');
  await page.locator('#historyBtn').click();
  check('previous chat now listed under saved chats',
    (await page.locator('#histBody [data-chat]').count()) === 1,
    await page.locator('#histBody [data-chat]').count());

  // --- Switching back restores the older conversation
  await page.locator('#histBody [data-chat]').first().click();
  await page.waitForTimeout(300);
  const backRows = await page.locator('.msg-row.user .bubble').allInnerTexts();
  check('switching chats restores its messages', backRows.length === 1 && /reworded/.test(backRows[0]), backRows);

  // --- Persistence across reload
  const before = await state();
  check('two chats stored', before.chats.length === 2, before.chats.map(c => c.title));
  await page.reload({ waitUntil: 'networkidle' });
  const afterRows = await page.locator('.msg-row.user .bubble').allInnerTexts();
  check('active chat survives reload', afterRows.length === 1 && /reworded/.test(afterRows[0]), afterRows);

  // --- v1 -> v2 migration
  const page2 = await (await browser.newContext()).newPage();
  await page2.goto('http://localhost:3998/', { waitUntil: 'domcontentloaded' });
  await page2.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kolos_state_v1', JSON.stringify({
      lang: 'en',
      profile: { region: 'Poltava', sector: '', size: '' },
      conversation: [{ role: 'user', text: 'Legacy question' }, { role: 'assistant', text: 'Legacy answer' }],
    }));
  });
  await page2.reload({ waitUntil: 'networkidle' });
  const migrated = await page2.evaluate(() => JSON.parse(localStorage.getItem('kolos_state_v2') || 'null'));
  const legacyKept = await page2.evaluate(() => !!localStorage.getItem('kolos_state_v1'));
  check('v1 conversation migrated into a v2 chat',
    !!migrated && migrated.chats.length === 1 && migrated.chats[0].conversation.length === 2, migrated && migrated.chats);
  check('migrated profile preserved', !!migrated && migrated.profile.region === 'Poltava');
  check('v1 key left intact for rollback', legacyKept === true);
  check('migrated messages render', (await page2.locator('.msg-row').count()) === 2,
    await page2.locator('.msg-row').count());

  // --- Ukrainian labels
  await page2.locator('#langUk').click().catch(() => {});
  await page2.waitForTimeout(200);
  const histLabel = await page2.locator('#historyBtn').innerText();
  check('History button localises', /Історія|History/.test(histLabel), histLabel);

  check('no uncaught page errors throughout', pageErrors.length === 0, pageErrors);

  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
