// End-to-end test of server.js as an actual running process.
//
// Spawns the real server exactly as the deploy instructions do, then makes real
// HTTP requests against it. This is what proves the Vercel-shaped handlers work
// under plain Node, which is the whole point of the shim.
//
// No request here ever reaches api.anthropic.com: every /api/chat case is
// rejected by the handler before it makes an upstream call.

const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3997;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(__dirname, '..', 'server.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

function start(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  return {
    child,
    log: () => out,
    // stdout and stderr are separate streams, so a warning written to stderr
    // can arrive after the stdout line we key startup off. Poll rather than
    // sleep a guessed interval.
    waitForLog: async (re, ms = 2000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (re.test(out)) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return false;
    },
    // Wait for the LAST startup line, not the first. Resolving on "Kolos
    // listening" races the two lines printed after it, which the proxy-trust
    // assertions read.
    ready: new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
      child.stdout.on('data', () => {
        if (/Client IP source/.test(out)) { clearTimeout(timer); resolve(); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + out)); });
    }),
  };
}

async function run() {
  // ---------- Phase 1: no API key configured ----------
  let srv = start({ ANTHROPIC_API_KEY: '' });
  await srv.ready;

  {
    const r = await fetch(BASE + '/');
    const body = await r.text();
    check('GET / serves the app', r.status === 200 && body.includes('<title>Kolos'), r.status);
    check('GET / is text/html', /text\/html/.test(r.headers.get('content-type')), r.headers.get('content-type'));
    check('GET / sends no-cache so deploys are picked up',
      r.headers.get('cache-control') === 'no-cache', r.headers.get('cache-control'));
    check('served HTML contains the programme reference',
      body.includes('PROGRAMME REFERENCE'));
  }

  {
    const r = await fetch(BASE + '/api/healthz');
    const j = await r.json();
    check('GET /api/healthz -> 200 {ok:true}', r.status === 200 && j.ok === true, j);
    check('healthz is application/json', /application\/json/.test(r.headers.get('content-type')));
  }

  {
    // Proves the shim's res.status().json() path works under plain Node.
    const r = await fetch(BASE + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const j = await r.json();
    check('POST /api/chat with no key -> 500 via the shim', r.status === 500, r.status);
    check('500 body names ANTHROPIC_API_KEY', /ANTHROPIC_API_KEY/.test(j.error.message), j);
  }

  {
    const r = await fetch(BASE + '/api/chat');
    check('GET /api/chat -> 405', r.status === 405, r.status);
    check('405 sets Allow: POST', r.headers.get('allow') === 'POST', r.headers.get('allow'));
  }

  // ---------- Static file safety ----------
  for (const [label, url, expected] of [
    ['.env.example is not served', '/.env.example', 404],
    ['server.js is not served', '/server.js', 404],
    ['api/chat.js source is not served', '/api/chat.js', 404],
    ['test sources are not served', '/test/test-server.js', 404],
    ['.gitignore is not served', '/.gitignore', 404],
    ['BUILD_NOTES.md is not served', '/BUILD_NOTES.md', 404],
    ['unknown path 404s', '/nope', 404],
  ]) {
    const r = await fetch(BASE + url);
    check(label, r.status === expected, r.status);
  }

  {
    // Path traversal, both raw and percent-encoded.
    const r1 = await fetch(BASE + '/../../etc/passwd');
    const r2 = await fetch(BASE + '/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    check('raw ../ traversal blocked', r1.status === 403 || r1.status === 404, r1.status);
    check('encoded ../ traversal blocked', r2.status === 403 || r2.status === 404, r2.status);
    const body1 = await r1.text();
    check('traversal response leaks no file content', !body1.includes('root:'), body1.slice(0, 40));
  }

  srv.child.kill();
  await new Promise((r) => srv.child.on('exit', r));

  // ---------- Phase 2: key present, so body handling is reachable ----------
  srv = start({ ANTHROPIC_API_KEY: 'sk-ant-fake-never-used', KOLOS_TRUST_PROXY: '1' });
  await srv.ready;

  {
    // Gets past the key check and into field validation, which proves
    // req.body was parsed by the server. Never reaches the network.
    const r = await fetch(BASE + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: 'x', messages: [] }),
    });
    const j = await r.json();
    check('body is parsed and reaches field validation', r.status === 400, r.status);
    check('400 explains the messages field', /messages/.test(j.error.message), j);
  }

  {
    const r = await fetch(BASE + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    const j = await r.json();
    check('malformed JSON -> 400, not a crash', r.status === 400, r.status);
    check('400 says the body was not valid JSON', /valid JSON/.test(j.error.message), j);
  }

  {
    const r = await fetch(BASE + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: 'x'.repeat(600 * 1024), messages: [{ role: 'user', content: 'hi' }] }),
    }).catch((e) => ({ status: 'network-error', err: e.message }));
    check('oversized body rejected with 413', r.status === 413, r.status);
  }

  {
    // Server still answers normally after all the bad input above.
    const r = await fetch(BASE + '/api/healthz');
    check('server still healthy after malformed input', r.status === 200, r.status);
  }

  check('startup log reports proxy trust state',
    /Client IP source\s*:\s*X-Forwarded-For/.test(srv.log()), srv.log().split('\n').slice(0, 4));

  srv.child.kill();
  await new Promise((r) => srv.child.on('exit', r));

  // ---------- Phase 3: safe-by-default proxy trust ----------
  srv = start({ ANTHROPIC_API_KEY: 'sk-ant-fake-never-used' }); // KOLOS_TRUST_PROXY unset
  await srv.ready;
  check('proxy trust is OFF unless explicitly enabled',
    /Client IP source\s*:\s*socket address/.test(srv.log()), srv.log().split('\n').slice(0, 4));
  srv.child.kill();
  await new Promise((r) => srv.child.on('exit', r));

  // ---------- Phase 3b: managed platform auto-detection ----------
  // Getting either of these wrong fails silently: bound to 127.0.0.1 on a PaaS
  // the app is simply unreachable, and untrusted forwarded headers make the
  // rate limiter count the whole platform as one visitor.
  for (const [label, env] of [
    ['Render', { RENDER: 'true' }],
    ['Railway', { RAILWAY_ENVIRONMENT: 'production' }],
    ['Fly.io', { FLY_APP_NAME: 'kolos' }],
    ['Vercel', { VERCEL: '1' }],
  ]) {
    srv = start({ ANTHROPIC_API_KEY: 'sk-ant-fake-never-used', HOST: undefined, ...env });
    await srv.ready;
    const log = srv.log();
    check(`${label} detected by name`, new RegExp('Platform\\s*:\\s*' + label.replace('.', '\\.')).test(log), log);
    check(`${label}: binds 0.0.0.0 so the platform router can reach it`,
      /listening on http:\/\/0\.0\.0\.0:/.test(log), log);
    check(`${label}: trusts the platform's forwarded header automatically`,
      /Client IP source\s*:\s*X-Forwarded-For/.test(log), log);
    check(`${label}: no plain-HTTP warning (platform terminates TLS)`,
      !/WARNING: bound to 0\.0\.0\.0/.test(log), log);
    srv.child.kill();
    await new Promise((r) => srv.child.on('exit', r));
  }

  {
    // Self-hosted with no proxy: 0.0.0.0 must still warn loudly.
    srv = start({ ANTHROPIC_API_KEY: 'sk-ant-fake-never-used', HOST: '0.0.0.0' });
    await srv.ready;
    check('self-hosted on 0.0.0.0 still warns about plain HTTP',
      await srv.waitForLog(/WARNING: bound to 0\.0\.0\.0/), srv.log());
    check('self-hosted is labelled as such', /Platform\s*:\s*self-hosted/.test(srv.log()), srv.log());
    srv.child.kill();
    await new Promise((r) => srv.child.on('exit', r));
  }

  // ---------- Phase 4: .env loading ----------
  // Only runs when there is no real .env to clobber.
  const fsx = require('node:fs');
  const envPath = path.join(__dirname, '..', '.env');
  if (fsx.existsSync(envPath)) {
    console.log('  SKIP  .env loading checks (a real .env exists; not touching it)');
  } else {
    fsx.writeFileSync(envPath,
      '# test env\nANTHROPIC_API_KEY=sk-ant-from-dotenv\nKOLOS_TRUST_PROXY=1\nQUOTED="quoted-value"\n');
    try {
      srv = start({ ANTHROPIC_API_KEY: undefined });
      await srv.ready;
      check('.env is read without --env-file or any dependency',
        /API key configured\s*:\s*yes/.test(srv.log()), srv.log());
      check('.env settings reach api/chat.js at module load',
        /Client IP source\s*:\s*X-Forwarded-For/.test(srv.log()), srv.log());
      srv.child.kill();
      await new Promise((r) => srv.child.on('exit', r));

      // A real environment variable must beat the file, or systemd and shell
      // overrides would silently do nothing.
      srv = start({ ANTHROPIC_API_KEY: 'sk-ant-real-env', KOLOS_TRUST_PROXY: '0' });
      await srv.ready;
      check('real environment variables override .env',
        /Client IP source\s*:\s*socket address/.test(srv.log()), srv.log());
      srv.child.kill();
      await new Promise((r) => srv.child.on('exit', r));
    } finally {
      fsx.unlinkSync(envPath);
    }
  }

  // ---------- Phase 5: deployment config ----------
  // Config, not code, but it is config whose failure mode is a days-long
  // debugging session (see HANDOVER.md 3.1), so it gets assertions.
  {
    const fsy = require('node:fs');
    const root = path.join(__dirname, '..');
    const vercelIgnore = fsy.readFileSync(path.join(root, '.vercelignore'), 'utf8');
    const vercelJson = JSON.parse(fsy.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    const pkg = JSON.parse(fsy.readFileSync(path.join(root, 'package.json'), 'utf8'));

    check('.vercelignore excludes server.js (stops the Express misdetection)',
      /^server\.js\s*$/m.test(vercelIgnore));
    check('.vercelignore excludes the test folder', /^test\/\s*$/m.test(vercelIgnore));
    check('vercel.json pins framework to null (second line of defence)',
      Object.prototype.hasOwnProperty.call(vercelJson, 'framework') &&
      vercelJson.framework === null, vercelJson.framework);
    check('vercel.json rewrites / to the app HTML',
      vercelJson.rewrites[0].source === '/' &&
      vercelJson.rewrites[0].destination === '/Kolos_Funding_Advisor.html', vercelJson.rewrites);
    check('chat function given more time than a web-searched answer needs',
      vercelJson.functions['api/chat.js'].maxDuration >= 30,
      vercelJson.functions['api/chat.js']);
    check('maxDuration stays within the legacy Hobby ceiling of 60s',
      vercelJson.functions['api/chat.js'].maxDuration <= 60,
      vercelJson.functions['api/chat.js']);
    check('package.json declares no dependencies',
      !pkg.dependencies && !pkg.devDependencies, Object.keys(pkg));
    check('start script points at a file that exists',
      fsy.existsSync(path.join(root, pkg.scripts.start.replace('node ', ''))), pkg.scripts);
    check('no build script for Vercel to trip over', !pkg.scripts.build, pkg.scripts);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
