# Kolos — Build Notes

**Compiled:** 3 August 2026, from the files in the Kolos project folder.
**Revised:** 3 August 2026 — reference brief embedded (§7), front-page chips
reworked (§8), self-hosted server added (§9), Vercel Hobby target (§10), follow-up
suggestions (§11), env-file defect found on-device (§12),
pause_turn handling after the first production failure (§13),
resume ceiling and self-diagnosis (§14),
guaranteed complete answers (§15),
prefill rejection and answer salvage (§16),
inline links in answers (§17),
first primary-source reference entry (§18),
knowledge split by volatility (§19).
**Scope:** assemble the deployable file set, verify it, and record where
`HANDOVER.md` and `README.md` no longer match what the files actually contain.

**For the current state of the project, read `WAYPOINT.md` first.** This file is
the full history of what changed and why; the waypoint is where things stand.

Read this alongside `HANDOVER.md`, not instead of it. Where the two disagree,
this file is newer and each claim below is backed by a test you can re-run.

---

## 1. One fatal bug was found and fixed

**`Kolos_Funding_Advisor.html` did not run at all in a browser.** Not "the chat
didn't answer" — the entire application was dead on load.

The cause was a literal `</script>` sequence inside a JavaScript comment at the
top of the inline script block:

```
   deployed backend origin, e.g. <script>window.KOLOS_API_BASE='https://your-backend.example.com';</script>
```

An HTML parser terminates a `<script>` element at the first `</script>` byte
sequence it sees. It has no idea that sequence sits inside a JS comment. So the
browser closed the script element there, 723 characters in, and threw:

```
Uncaught SyntaxError: Invalid or unexpected token
```

Measured on the unfixed file:

| | |
|---|---|
| JS the author wrote | 22,590 characters |
| JS the browser executed | 723 characters |
| Uncaught page errors | `["Invalid or unexpected token"]` |
| `sendMessage` defined | `undefined` |
| Suggestion chips rendered | 1 (should be 6 — the one that appeared was a fragment of source text being parsed as HTML) |
| Raw JS source visible as page text | yes, ~20,000 characters, **including the full system prompt** |

Consequences: no chat, no send button, no UA/EN toggle, no farm profile, no
persistence, no export. And the complete system prompt was printed on the page
for any visitor to read.

**Fix applied:** the closing tag in that comment is now escaped as `<\/script>`.
A backslash breaks the `</script` match for the HTML tokenizer and is inert
inside a JS block comment. This is a comment-only edit — no application logic
changed. A warning comment now sits next to it so it does not get un-escaped.

This is the only change made to application code.

### Why nobody caught it

`HANDOVER.md` §2 records the live site as "Working. Verified 25 Jul 2026: root
serves the app". That verification was a `fetch` of the root URL — it confirms
the server returns HTTP 200 and the right bytes. It cannot tell you whether the
JavaScript in those bytes parses. §10 separately admits "the chat has never
produced a real answer end-to-end", which is the check that would have caught it.

**Still to confirm:** whether the currently-live `kolos-ecru.vercel.app` was
built from this exact HTML. `HANDOVER.md` §3.1 says the live deployment and the
git repo are out of sync, so the live file may differ. Open the live URL, press
F12, and look at the Console tab. `Invalid or unexpected token` means the live
site has the same bug.

---

## 2. Where HANDOVER.md is now out of date

| HANDOVER.md says | What the files actually contain |
|---|---|
| §10: "no rate limiting" | **Wrong — it is there.** `api/chat.js` has per-IP rate limiting (header comment dated 28 Jul, three days after the handover was written). Default 20 requests/hour, configurable via `KOLOS_RATE_LIMIT_MAX` and `KOLOS_RATE_LIMIT_WINDOW_MS`. Tested: trips on request 21, isolates per IP. The §5 caveat still stands — it is in-memory per warm instance, not durable. |
| §3.2: model `claude-sonnet-5` is unverified, "confirm before launch" | **Now verified.** Checked against `platform.claude.com/docs/en/about-claude/models/overview` on 3 Aug 2026. `claude-sonnet-5` is a real, current model ID. Anthropic moved to a dateless pinned-snapshot ID format from the 4.6 generation, which is why it has no date suffix. No change needed. Access can still vary by account — if you get a 404 from the API, `KOLOS_MODEL` overrides it. |
| §3.1: "`\"framework\": null` in `vercel.json`" | The project copy of `vercel.json` had only the rewrite, no `framework` key. **Added**, matching what §3.1 describes. It is harmless on a fresh Vercel project and is the guard against the stuck Express preset if you reuse the old one. |
| §7 and README list `.env.example` as part of the file set | **It was missing from the project folder.** Recreated, documenting all four environment variables the code actually reads. |
| §5 / README: "Lock CORS to your real frontend origin rather than leaving it open" | **Misdescribed.** `api/chat.js` sets no `Access-Control-Allow-Origin` header at all, so browsers already block cross-origin calls. Nothing is "open" to lock down. The real residual exposure is non-browser callers — `curl`, scripts — which CORS cannot stop by design. Rate limiting is the control that matters there. |
| §7: files listed flat | `chat.js` and `healthz.js` were stored at the project root. Vercel derives the route from the path, so they **must** sit at `api/chat.js` and `api/healthz.js` or the routes do not exist. Placed correctly here. |
| §8: Claude artifact test build "unverified", errors when opened | Not investigated. `Kolos_Claude_Artifact_Test.html` is a separate file that is not deployed. **Worth checking it for the same `</script>` defect** before concluding anything about `window.claude.complete`. |

The project folder also contains two documents both named `HANDOVER.md`. Worth
deleting one.

---

## 3. What was verified, and how

Two test harnesses, both re-runnable and both shipped in `test/`. Neither spends
API credit — the upstream Anthropic call is stubbed.

```bash
node test/test-handler.js     # 20 checks, no browser needed
node test/test-frontend.js    # 47 checks, needs playwright + chromium
```

**`test/test-handler.js` — 20 checks against `api/chat.js` and `api/healthz.js`:**
missing key returns 500 naming `ANTHROPIC_API_KEY`; `GET` returns 405 with an
`Allow: POST` header; empty `messages`, missing `system` and an absent body all
return 400 rather than crashing; rate limiting trips on request 21 and lets a
different IP straight through; an upstream throw becomes a 502; an upstream 401
is passed through as 401; the outbound payload carries `model:
"claude-sonnet-5"` and the `web_search_20250305` tool; `KOLOS_MODEL` overrides
the model; the system prompt is wrapped as a cacheable content block with
`cache_control: {type: "ephemeral"}` and its text survives the wrap verbatim;
`/api/healthz` returns `{ok:true}`.

**`test/test-frontend.js` — 47 checks driving the real HTML in headless Chromium**
against a local server that reproduces the `vercel.json` rewrite and a stubbed
`/api/chat` returning an Anthropic-shaped payload: page loads with no uncaught
errors; 10 suggestion chips render and the two dead-end chips are gone; a question round-trips and the answer
renders with `**bold**` and bullet lists converted; source chips dedupe
correctly across `citations` and `web_search_tool_result` blocks (3 references
collapse to 2 unique URLs) and link to the real URLs; the farm profile reaches
the system prompt; the UA toggle switches both the UI and the "Respond in
Ukrainian" instruction; conversation, sources and profile survive a reload; a
500 from the server surfaces as a readable error with the typing indicator
cleared and the send button re-enabled; "New chat" clears thread and
localStorage; **no API key appears anywhere in the browser's outbound request**;
and user-supplied HTML (`<img src=x onerror=...>`) is escaped rather than
executed. A further block asserts the programme reference reaches the API intact:
its compiled-on date, the `[EXPIRED]` tag on the closed FAO-EU cycle with both
lapsed dates named, at least eight `[STATUS UNVERIFIED]` tags, the rule
forbidding stale figures, the rule that live search overrides the reference, the
USAID and Ukraine Facility framings, and livestock routing to the State Agrarian
Registry rather than Diia.

All 67 checks pass on the files in this package.

**Not covered:** no real call to the Anthropic API has ever been made. Nothing
here proves your key works, your account has `claude-sonnet-5`, or that the
answers are any good. That is step 5 of the checklist below and it needs a
human.

---

## 4. What is in this package

```
kolos/
├── Kolos_Funding_Advisor.html   the chat UI — no secrets, safe to be public
├── api/
│   ├── chat.js                  serverless function; holds the key server-side
│   └── healthz.js               liveness check at /api/healthz
├── vercel.json                  rewrite, framework:null, function maxDuration
├── .vercelignore                keeps server.js away from Vercel (see §10)
├── package.json                 no dependencies
├── .env.example                 local-testing template — never holds a real key
├── .gitignore                   excludes .env, .vercel, node_modules
├── server.js                    self-hosted server, zero dependencies
├── DEPLOY.md                    deploy guide: managed hosting or your own server
├── reference-sources/           provenance for the programme reference
├── test/
│   ├── test-handler.js          59 checks on the request handlers
│   ├── test-server.js           68 checks: server.js live, plus deploy config
│   └── test-frontend.js         133 checks driving the UI in headless Chromium
└── BUILD_NOTES.md               this file
```

Deliberately absent: `server.js`. `HANDOVER.md` §7 explains why — having both it
and `api/` in one package is what produced the `Cannot GET /` confusion.

---

## 5. Deploy checklist

Order matters. Do not skip step 6.

**1. Fresh GitHub repo under the PanTerrea account.** Do not reuse
`LeeKerr-Code/Kolos`. It has a stray `api` branch and an old `server.js` in its
history, both of which caused the original debugging detour.

**2. Push this folder to it.**

```bash
cd kolos
git init
git add .
git commit -m "Kolos v1 — verified build, </script> parse bug fixed"
git branch -M main
git remote add origin https://github.com/<panterrea-account>/<repo>.git
git push -u origin main
```

**3. New Vercel project under the PanTerrea account.** Import the repo. Framework
preset "Other". No build command. Confirm **Root Directory is blank** — not
`api`.

**4. Set the API key.** console.anthropic.com → API Keys → Create Key (starts
`sk-ant-`, shown once). Then Vercel → Project Settings → Environment Variables →
`ANTHROPIC_API_KEY`. Production at minimum; add Preview and Development if you
want preview deploys and `vercel dev` to work. Never in the HTML, never in git,
never pasted into a chat window.

**5. Deploy, then verify in this order:**

- `https://<project>.vercel.app/api/healthz` → `{"ok":true}`. Proves the API
  routes deployed.
- Open the root URL and **press F12 → Console**. It must be clean. This is the
  check that was missing before; a page that loads is not a page that works.
- Ask one real question. Confirm an answer appears with source chips under it.
- Switch to UA and ask one question in Ukrainian.

**6. Before you share the URL with anyone.** Two things, both cost money if
skipped:

- **Durable rate limiting.** The current limiter is a `Map` in module scope. It
  works within one warm serverless instance and is lost when that instance goes
  cold. Vercel runs several concurrently under load, so the real ceiling is
  20/hour × however many instances are alive. Swap point is marked in
  `api/chat.js`; Upstash Ratelimit or Vercel KV both do it in a few lines.
- **Cap searches per request.** `api/chat.js` attaches the web search tool with
  no `max_uses`, so a single question can trigger an unbounded number of
  searches at $10 per 1,000 searches plus token cost. One line:

  ```js
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  ```

  Not applied here — it changes runtime behaviour and answer quality, so it is
  your call, not mine.

**7. Retire the old stack.** Once the new deployment answers correctly, delete
or archive `kolos-ecru.vercel.app`, the old Vercel project
(`prj_wAU6cV49J2IHTljdbmVNFqlVbYCI`), and the `LeeKerr-Code/Kolos` repo — so
nobody follows a stale link to a version with the parse bug in it.

**8. Then the things `HANDOVER.md` §9 already lists** — Anthropic Startup
Program application, and a domain expert reviewing a sample of real answers
against the research brief before farmers act on any of it.

---

## 6. Optional, not applied

Left alone because they change behaviour and were outside the agreed scope:

- **Newer web search tool versions exist.** `web_search_20250305` is still
  valid. `web_search_20260209` adds dynamic filtering and `web_search_20260318`
  adds response inclusion control. Upgrading is a one-string change in
  `api/chat.js` if either capability is useful.
- **`max_tokens` is 1200.** Fine for a scannable answer; long multi-programme
  replies may truncate. The server caps anything above 4096.
- **The research brief's lapsed deadlines.** `HANDOVER.md` §6 flags several as
  already passed. Kolos searches live and never reads the brief, so this does
  not affect the app — but it does affect anyone using the brief to sanity-check
  Kolos's answers.

---

## 7. Reference brief embedded in the system prompt

At the project owner's direction, the whole of
`Ukraine_Farm_Funding_Reference_Brief.docx` is now carried in Kolos's system
prompt as `PROGRAMME_REFERENCE`, including amounts, deadlines and status
figures. This reverses HANDOVER §6's instruction not to hard-code the brief.
The decision was made with the trade-off stated; what follows is what was built
to contain the risk, not an argument against it.

**The risk being managed.** The brief is a 22 July 2026 snapshot. Its own §7
flags that several deadlines had already lapsed when it was written. A farmer
who acts on a closed application window loses real time and money, and Kolos now
holds those dates in context on every turn.

**What contains it.** Six absolute rules sit immediately above the reference in
the prompt:

1. No amount, percentage, deadline, application window, allocation or
   disbursement figure may be taken from the reference. Every number in an
   answer must come from a search performed in that turn. If the search does not
   confirm a figure, Kolos gives no figure and hands the farmer the link.
2. `[EXPIRED]` entries may never be presented as open.
3. `[STATUS UNVERIFIED]` entries must be searched before Kolos says open or
   closed either way.
4. Absence from the reference is not evidence a programme does not exist.
5. Where live search contradicts the reference, the search wins and Kolos says
   the reference is out of date.
6. The reference's programme names, bodies and portals are to be used as search
   terms. "State Agrarian Registry livestock subsidy 2026" beats "Ukraine farm
   grants".

**Tagging applied.** The two FAO-EU 2026 intakes (closed 17 April and 14 June)
are marked `[EXPIRED]` with both dates named as closed. Ten entries whose
opening was reported but whose closing was never confirmed are marked
`[STATUS UNVERIFIED]`. The Ukraine Facility is marked
`CONTEXT ONLY, NOT FARMER-FACING`. USAID is headed
`TREAT AS NOT AVAILABLE UNLESS SEARCH PROVES OTHERWISE`. World Bank ARISE is
marked `LIKELY NOT OPEN`. Livestock is explicitly routed to the State Agrarian
Registry `(NOT Diia)`, which the brief shows is a common wrong turn.

Every one of these markers is asserted by a test, so a careless edit to the
reference fails the suite rather than shipping quietly.

**Honest limitation.** These are prompt-level instructions, not enforcement.
Models do sometimes restate background context as current fact. The rules
reduce that materially; they do not eliminate it. The version that eliminates it
is stripping the volatile fields so the model has no stale number to reach for.
That option was offered and not taken, which is a legitimate call, but the
residual risk should be understood rather than assumed away.

**Refreshing it.** Re-verify each entry, update the date on the first line of
`PROGRAMME_REFERENCE`, and re-apply the `[EXPIRED]` and `[STATUS UNVERIFIED]`
tags. The tests will tell you if you break the structure. This wants doing
monthly at minimum; the brief decays fastest around application windows.

### Cost, with real numbers

The system prompt is now 14,239 characters, very roughly 3,800 tokens (a
character-count estimate, not a tokeniser count — treat it as ±15%). It is sent
on every message.

Anthropic's published Sonnet 5 pricing, checked 3 August 2026: $2 per million
input tokens, $10 per million output, cache writes $2.50 and cache reads $0.20.

Uncached, the reference alone costs about **0.8 cents per message**. So
`api/chat.js` now marks the system prompt cacheable. First message in a session
pays a write (about 1.0 cent); every message after it inside the 5-minute window
pays a read (about 0.08 cents). A six-question session drops from roughly 4.6
cents of system-prompt cost to about 1.4 cents.

Two things to know. The cache TTL is 5 minutes and refreshes on each hit, so a
farmer who reads an answer for six minutes then asks again pays another write.
And the whole system string is cached as one block, so changing language or farm
profile mid-conversation writes a new entry — one wasted write, rare in
practice. Neither is worth engineering around yet.

Separately: **Anthropic's prices rise on 1 September 2026** to $3 input, $15
output, $3.75 cache write, $0.30 cache read. Four weeks out. Worth factoring
into any budget written now.

---

## 8. Front-page suggestion chips reworked

The original six chips were organised by funding body — government, EU,
EBRD/World Bank — plus two sectors. That mirrors how the research brief was
compiled rather than how a farmer thinks, and two of the six pointed at money a
farmer cannot apply for: the brief is explicit that IFI support arrives through
partner banks and leasing companies, and that the Ukraine Facility is a macro
instrument channelled through the government.

The set is now ten, situation-led, ordered urgent first:

| Chip | Why |
|---|---|
| My farm is in a frontline area | Five programmes improve at once in frontline and de-occupied territory: horticulture co-financing 70%→80%, construction reimbursement 25%→50%, machinery compensation 25%→40%, reclamation UAH 30k→48k per hectare, plus 0.1% restoration loans. None of this was reachable from the old front page. |
| Rebuilding after war damage | Distinct from location. Routes to the 0.1% two-year restoration loans. |
| Generators & energy equipment | The 5-7-9% scheme's 0% energy loan up to UAH 10m. The most striking number in the brief and previously invisible. |
| Fertilizer & inputs this season | UAH 1,000/ha, recurs annually, so it is the chip most likely to bring someone back. |
| Storage, cold chain & processing | Horticulture grant covers storage; FAO-EU covers processing capacity. |
| Machinery & equipment | Kept. Broadened from "loans" to cover compensation too, which is the larger pot. |
| Livestock & dairy | Kept. Rewritten to lead with per-head subsidies rather than "grants". |
| I run a small household farm | Does persuasion, not search. The FAO-EU small-producer tier and the 3–100 cow band target this group, who are least likely to think any of it applies. |
| Women-led / veteran-led farms | Kept. |
| What do I need to apply? | Diia, State Agrarian Registry and partner banks are three different doors, and the brief shows people pick wrong. Answers the blocker before the blocker. |

Removed: "EBRD / World Bank programmes" (dead end), "EU & reconstruction
funding" (macro, not farmer-facing), "Ukrainian government grants open now" (too
broad — nearly everything else listed is also a government grant).

Just below the line, if you want to swap any in: irrigation and land reclamation
(UAH 30k–48k per hectare, but a narrower audience), and a chip pointing
specifically at the EU-funded cycles through the State Agrarian Registry.

The welcome intro was rewritten to match. It previously advertised "EBRD, World
Bank and other donors", which contradicted the new set.

**Ukrainian copy needs a native check.** All ten chips and the intro have
Ukrainian versions. They are grammatical, but the frontline and occupation
wording carries tone that a non-native writer should not be the last word on.
Have someone read `UI.uk.chips` before farmers see it.

**Latent bug, not fixed.** `escapeHtml()` builds a text node and reads back
`innerHTML`, which escapes `&`, `<` and `>` but **not** double quotes. Chip text
is interpolated into a `data-q="..."` attribute and search-result titles into
`title="..."`, so a double quote in either breaks out of the attribute. No chip
contains one, and a test now enforces that. The `title` case is the real
exposure, because those strings come from web search results rather than from
this repo. Fixing it properly means escaping quotes in `escapeHtml`. Flagged
rather than changed, since it is unrelated to the requested work.

---

## 9. Retargeted from Vercel to a self-hosted server

Vercel is no longer the target. `server.js` is back, which HANDOVER §7 removed
and explicitly said would be needed if the app ever moved to something running
a persistent Node process. That is now the case.

**What would have broken without it.** `api/chat.js` and `api/healthz.js` call
`res.status(...).json(...)` and read an already-parsed `req.body`. Those are
Vercel/Express conventions; Node's own `http` module provides neither. Dropped
onto a plain server the first request dies on `res.status is not a function`.

**Approach: shim, do not fork.** `server.js` adds the missing response methods
and parses the body, then calls the existing handlers unchanged. The `api/*.js`
files are therefore byte-identical to what ran on Vercel, so the rate limiting,
caching, validation and model logic exist once rather than twice, and the test
suite covers the code actually deployed. `vercel.json` is left in place and
unused, so returning to Vercel remains a no-work option.

**Zero dependencies.** `node:http`, `node:fs`, `node:path` only. No
`npm install`, no lockfile, no dependency advisories to chase on a box nobody
is watching.

**`.env` is loaded by the server itself.** Node 20.6+ has `--env-file`, but
relying on it makes the server misbehave quietly on older Node. Twenty lines of
parser removes an install step from the deploy guide and a class of "why is my
key not loading" support questions. Real environment variables always win over
the file, so systemd and shell overrides behave as expected. Both directions
are tested.

### Security decisions made here

**`X-Forwarded-For` is no longer trusted by default.** The old `getClientIp`
took the first entry of that header unconditionally. On Vercel that is safe
because the platform controls it. On your own box it is attacker-controlled: a
forged header buys a fresh rate-limit quota on every request, making the
limiter decorative. It now defaults to the socket address and only reads the
header when `KOLOS_TRUST_PROXY=1` is set, which is auto-enabled when the
`VERCEL` env var is present. `.env.example` ships with it set to 1 because the
documented setup puts Caddy in front.

When trusting, it takes the **last** entry rather than the first. nginx's usual
`$proxy_add_x_forwarded_for` appends the peer it saw to whatever the client
sent, so the first entry is forgeable and the last is the only hop your proxy
vouched for. Both behaviours are asserted by tests, including a test that
forging the header cannot buy extra quota when the header is untrusted.

**Bind address defaults to 127.0.0.1.** The server is not reachable from the
internet unless a proxy forwards to it, so there is no window in which plain
HTTP is publicly exposed while TLS is still being set up. Binding to 0.0.0.0
prints a warning at startup.

**Static serving is locked down.** Path traversal is blocked by resolving and
confirming the result stays under the app root, both raw and percent-encoded.
Dotfiles, `server.js`, the `api/` and `test/` sources, and the markdown docs are
all refused. `.env` is covered twice over. Each of these is a test.

**Request bodies are capped at 512KB.** The first implementation destroyed the
socket on overflow, which reset the connection so the client saw a network
error rather than the 413 being sent. It now stops buffering but keeps draining
so the response can be delivered, with a hard abort at 8MB for anyone streaming
in earnest. Caught by the test suite, not by inspection.

### Cost changes applied

**Web search capped at 3 uses per question** (`KOLOS_MAX_SEARCHES`). This is
the largest line item in the bill at $10 per 1,000 searches and it was
previously uncapped, so a single question could fire eight or ten. At 30
questions a day this saves roughly $63 a month, which is more than eleven
months of the €5.49 server.

**Conversation history capped at the last 8 messages.** Every turn previously
resent the entire conversation, so turn ten paid for the nine before it. The
window shifts forward until it starts on a user message, because the API
rejects a request whose first message is from the assistant — slicing blindly
would have produced intermittent 400s on long conversations.

Not changed: `max_tokens` stays at 1200, and the model stays `claude-sonnet-5`.
Haiku 4.5 would cut about 22% and does nothing to the search fee. Kolos exists
to judge whether a source is current and to hedge correctly on a deadline, and
being confidently wrong costs a farmer money. That is a poor thing to buy a
22% discount with.

### Managed platforms

The target is now managed hosting rather than a VPS, so `server.js` detects
Render, Railway, Fly.io and Vercel from their environment variables and adjusts
two settings that have opposite correct answers depending on where it runs.

**Bind address.** Self-hosted, 127.0.0.1 is right: your proxy reaches it and the
internet cannot. On a managed platform the router lives outside the container,
so 127.0.0.1 makes the app unreachable and the deploy fails health checks with
no useful error. Managed platforms get 0.0.0.0, which is safe there because
their router terminates TLS in front of you. The plain-HTTP warning is
suppressed on a managed platform and still fires when self-hosting.

**`X-Forwarded-For`.** Managed platforms set it themselves and strip whatever
the client sent, so it is trustworthy and proxy trust switches on automatically.
On a bare server it stays off until you say otherwise.

Both are detected rather than left to a checklist, because both fail silently
when wrong. All four platforms are covered by tests, as is the self-hosted case.

`package.json` gains `start` and `test` scripts so platforms that look for a
start command find one.

**Vercel Hobby is not a legal option for this project.** Their fair use
guidelines define commercial usage as any deployment "used for the purpose of
financial gain of anyone involved in any part of the production of the project,
including a paid employee or consultant writing the code", and restrict Hobby to
non-commercial personal use. Kolos is built for PanTerrea. Vercel means Pro at
$20 per user per month. This is worth knowing before anyone reaches for the free
tier as an easy answer. The Vercel code path is still maintained and tested, so
Pro remains a no-work option if it is ever wanted.

### Test coverage now

```bash
node test/test-handler.js     # 23 checks — the request handlers
node test/test-server.js      # 49 checks — server.js as a live process
node test/test-frontend.js    # 51 checks — the UI in headless Chromium
```

123 checks, all passing. `test-server.js` spawns the real server exactly as the
deploy guide runs it and makes real HTTP requests against it, so the shim is
verified rather than assumed. No test reaches api.anthropic.com; every
`/api/chat` case is rejected by the handler before an upstream call.

Still untested, and unchanged from §3: no real call to the Anthropic API has
ever been made from this code. Nothing here proves the key works or the answers
are any good.

---

## 10. Vercel Hobby as the deployment target

Target changed again, to Vercel's free Hobby plan. Everything already worked on
Vercel, so no application code changed. Two config files did, both for reasons
rooted in this project's own history.

### `.vercelignore` — the important one

`server.js` is now excluded from Vercel deployments.

HANDOVER §3.1 records that Vercel auto-detected the original project as an
Express app because the upload contained a `server.js`, that the guess stuck at
the project level, and that the resulting `Cannot GET /` — Express's own 404
page — cost days of debugging. §7 concluded there must deliberately be no
`server.js`.

`server.js` is back, because it is how Kolos runs on anything other than Vercel.
`.vercelignore` means Vercel never receives it and so cannot repeat the guess.
`vercel.json` keeps `"framework": null` as a second, independent line of
defence. Both are asserted by tests, because the failure mode is a days-long
debugging session rather than a stack trace.

`test/` and the markdown docs are excluded too, which also keeps them off the
public site.

`"main": "server.js"` was removed from `package.json` for the same reason: one
less signal that could make a platform think this is a Node server app rather
than static files plus functions.

### Function duration — checked, not assumed

A Kolos answer takes 10 to 20 seconds because of live web search, so the
serverless timeout was a genuine go/no-go question rather than a detail.

Verified against Vercel's docs on 3 August 2026. With fluid compute, which is
enabled by default, Hobby's default **and** maximum are both 300 seconds. The
frequently-quoted 10-second Hobby default applies only to projects deployed
before 23 April 2025 that are not using fluid compute.

`vercel.json` now pins `api/chat.js` to `maxDuration: 60`. That is well clear of
a 20-second answer, and 60 is deliberately chosen as the largest value that is
also legal under the legacy non-fluid Hobby ceiling — so the deploy cannot fail
on a project that somehow lands on the old regime. Both bounds are tested.

### Two Hobby restrictions the deploy guide now leads with

**Organisation repositories are not supported.** Vercel's limits state it "does
not support connecting a project on your Hobby team to Git repositories owned by
Git organizations". The repo must sit under a personal GitHub username. The
failure mode is that the repository simply does not appear in the import list,
with no explanation, which is exactly the kind of thing that eats an afternoon.

**Hobby is non-commercial only.** Vercel defines commercial usage as any
deployment "used for the purpose of financial gain of anyone involved in any
part of the production of the project, including a paid employee or consultant
writing the code". Kolos is being built for PanTerrea. Whether a private dev
site with no users, no payments and no advertising crosses that line is
arguable, and Vercel's guidance is to ask them.

This is recorded rather than argued. The operational point is that the downside
is suspension without much warning, which is tolerable for a dev site with a
handful of testers and is not something to be relying on the day the link goes
to farmers. Either get a ruling from Vercel support or plan to move to Pro,
Render, or self-hosting before launch. All three run this package unchanged.

### Rate limiting is weakest here

Worth restating in the Vercel context. The in-memory limiter survives only
within one warm serverless instance. Vercel runs instances concurrently and
recycles them aggressively, more so on the free plan. On a VPS the limiter was a
speed bump that reset on restart; on Hobby it resets far more often and several
instances may each be allowing 20 an hour independently. Unchanged as a
conclusion, worse as a magnitude. Durable replacement is still the last thing to
do before the URL is shared.

### Test coverage

```bash
node test/test-handler.js     # 23 checks — the request handlers
node test/test-server.js      # 58 checks — server.js live, plus deploy config
node test/test-frontend.js    # 51 checks — the UI in headless Chromium
```

132 checks, all passing. The new deployment-config phase asserts the
`.vercelignore` exclusions, `framework: null`, the root rewrite, both
`maxDuration` bounds, that there are no dependencies, that the start script
points at a file that exists, and that no build script exists for Vercel to trip
over.

Unchanged and still true: no real call to the Anthropic API has ever been made
from this code.

---

## 11. Follow-up suggestions under each answer

Kolos now ends every answer with two or three clickable next steps.

### The design decision

The obvious version of this feature is "suggested questions", which move a
farmer sideways into more browsing. That is not where they are stuck. A farmer
who has just been told three programmes exist is not short of topics; they are
stuck on "does this apply to me, and what do I do now".

So the suggestions move DOWN a funnel rather than across a menu:

discovery → am I eligible → what documents do I need → where and when do I
apply → what if I do not qualify

The last stage is the one most tools skip and the one that decides whether a
farmer leaves with something. The prompt requires that when an answer is
essentially "you probably do not qualify", at least one suggestion must point
at an alternative or at where local programmes are listed.

Two behaviours were chosen explicitly and could reasonably have gone the other
way. Kolos always answers in full before offering next steps, and never
withholds an answer to ask a qualifying question first — the user is often on a
phone with poor signal and wants the answer now. And a dead end must always
carry an alternative.

### How it works

The model appends a final line, `[[NEXT]] one || two || three`, which the
frontend strips before display. The marker never reaches the screen, the export
file, or localStorage.

Parsing is deliberately forgiving: the marker is removed wherever it appears and
whatever its case, because a leaked `[[NEXT]]` in a farmer's answer looks worse
than no suggestions at all. Suggestions are capped at three and 120 characters,
and empty entries are dropped.

When nothing parses, a fixed four-item funnel fallback is shown instead, in the
current language. This matters more than it sounds: a chat interface that shows
suggestions most of the time and nothing the rest of the time reads as broken,
and models do drift on output format.

Chips render only under the newest answer. Leaving a row under every historical
message turns a long conversation into a wall of stale buttons and invites
clicks on a next step that stopped being next four answers ago.

### The figures prohibition extends to chip text

Chip text sits outside the answer body, so without an explicit rule it would
escape the §7 guard rails. The prompt forbids any amount, percentage, deadline
or date in a suggestion. Naming a programme is fine. "Check if I qualify for the
machinery compensation" is allowed; "Apply before 30 September" is not.

### A real vulnerability fixed on the way

`escapeHtml()` built a text node and read back `innerHTML`, which escapes `&`,
`<` and `>` but **not** quotes, because quotes need no escaping in a text node.
Several values were interpolated into HTML attributes, notably
`title="${escapeHtml(s.title)}"` for source chips. A web-search result whose
title contained a double quote could break out of that attribute. It now escapes
both quote characters, and is tested against a hostile string.

Follow-up chips separately avoid attributes altogether: the text is attached
through a DOM property rather than serialised into an HTML string, so
model-generated content never passes through markup at all. Belt and braces,
because this is the one place where text from outside the repo reaches the DOM.

### Cost

The generation overhead is negligible, roughly 60 output tokens per answer. The
real cost is that the feature works: suggestions that land will roughly double
questions per session, at about 5.4¢ each. That is the point of it and also the
price, and it will show up on the Anthropic bill rather than anywhere else.

The system prompt grew from about 3,850 to about 4,250 tokens, still cached.

### Test coverage

```bash
node test/test-handler.js     # 23 checks
node test/test-server.js      # 58 checks
node test/test-frontend.js    # 70 checks
```

151 checks, all passing. The new ones cover: chips render from model output; the
marker never appears in visible text; clicking a chip sends it as a question;
only one chip row survives a second answer and it is under the newest; chips and
their text survive a reload; an answer with no marker parses cleanly and falls
back; the marker is stripped inline, case-insensitively, and after a blank line;
suggestions are capped and empties dropped; and a hostile string containing
quotes and a tag is neutralised by `escapeHtml`.


---

## 12. A defect found by running the tests on the target machine

Worth recording because it argues for something: the suites were run on the
user's own Mac, from the unpacked repo, not just in the build container. That is
where this surfaced.

**Symptom.** `test-server.js` reported one failure there and none here:
`proxy trust is OFF unless explicitly enabled`. The server was reading
`X-Forwarded-For` when nothing had asked it to.

**Cause.** Not the server. The test itself. Its `.env` phase wrote a file
containing `KOLOS_TRUST_PROXY=1` into the **app directory** and removed it in a
`finally`. An earlier run had been killed partway through by an unrelated
timeout, so the `finally` never ran and the file survived. `server.js` then did
exactly what it should: loaded `.env` and turned proxy trust on.

**Second, worse failure.** Re-running it there crashed on teardown with
`EPERM: operation not permitted, unlink`. The folder was reached through a
bridge that refuses deletes, so the cleanup could never succeed and the stale
`.env` would be recreated on every single run.

**Why this mattered more than a red test.** A leftover `.env` in the app folder
silently overrides real configuration at next start, and the values in it were
test values. On a real deployment that is a rate limiter quietly trusting a
forgeable header, with nothing in the logs to suggest anything is wrong beyond
one line most people would not read.

**Fix.** `server.js` now honours `KOLOS_ENV_FILE`, and the test writes its env
file to a temp directory and points at it. Nothing is ever written to the app
directory, so neither a killed process nor an undeletable filesystem can leave
anything behind. A new assertion checks the app folder still contains no `.env`
after the phase, and cleanup is best-effort because it no longer matters if it
fails.

`KOLOS_ENV_FILE` is also genuinely useful outside tests, for deployments that
keep configuration outside the application directory.

**Verified two ways:** the suite passes, and killing it mid-run with `SIGKILL`
leaves no `.env` behind.

**The general lesson.** A container is not the target. This bug was invisible
here and reproducible there, and the mechanism — an interrupted run plus a
filesystem that refuses deletes — is not something inspection would have caught.
Run the suite where the code will actually live.

### Test coverage

```bash
node test/test-handler.js     # 23 checks
node test/test-server.js      # 59 checks
node test/test-frontend.js    # 70 checks
```

152 checks, all passing.

---

## 13. `pause_turn` — the bug that reached production

The first real deployment produced this, in front of the user:

> "Frontline and de-occupied farmers in Ukraine do get meaningfully better
> terms across several programmes — let me verify the current numbers and
> status before I lay them out, since these rates change often."
>
> Sources (23)

A promise, 23 real sources, and no answer. Presented as finished.

### Cause

From Anthropic's web search documentation, verbatim:

> "The API can pause a long-running search turn and return
> `stop_reason: "pause_turn"`. To continue, send the paused assistant message
> back unchanged in a new request."

`api/chat.js` returned whatever the first upstream call produced. When the API
paused the turn mid-search, that partial content was handed to the browser,
which rendered it as a complete answer. No `[[NEXT]]` line either, because the
model never reached the end of its reply.

Note what this was **not**: not `max_tokens`, and not the `max_uses: 3` search
cap. Search results count as input tokens, not output, so they never competed
with the answer for the `max_tokens` budget. Worth stating because both were
plausible-looking suspects and fixing either would have changed nothing.

### Fix

`api/chat.js` now loops: while `stop_reason` is `pause_turn`, it appends the
paused assistant message unchanged and calls again, accumulating content blocks
from every leg. The client receives one response containing the sources
gathered before the pause **and** the answer written after it. Bounded at
`MAX_PAUSE_RESUMES` (default 3, so at most 4 upstream calls) so a pathological
loop cannot run up a bill. Prompt caching means each resume re-sends the large
system prompt as a cache hit rather than at full rate.

### The deeper problem it exposed

The response's `stop_reason` was being discarded entirely. Any stopped answer —
paused, or cut off at `max_tokens` — looked identical to a finished one.

For a tool people make money decisions on, an answer that stops mid-thought
while *looking* complete is worse than an outright error, because nothing
signals that anything is missing. A farmer reading "let me verify the numbers"
has no way to know the numbers were never coming.

The client now treats any `stop_reason` other than `end_turn` or
`stop_sequence` as truncated and renders a visible warning inside the answer
bubble. Five cases are tested, including that `end_turn` and a missing
`stop_reason` do **not** trigger it.

### Also changed

**Preamble suppression.** Two prompt rules were added: never announce an
intention to search, and never promise an answer not yet written. Even with
paused turns resumed, that preamble would still have opened the final answer.
Kolos now searches silently and leads with what the farmer can act on.

**`max_uses` raised from 3 to 5** and **default `max_tokens` from 1200 to 2000**
(cap 4096 → 8192). The brief asked for a tool that holds a farmer's hand through
complex eligibility questions; three searches and a short budget were tuned for
cost, not for that. Costs roughly 2¢ more per question at worst.

**A build marker.** `/api/healthz` now returns `{ok: true, build: "..."}` and the
same string is in the HTML and logged to the console on load. Working out which
version was actually deployed cost real time here, because a missing feature and
a broken one look identical from the page. A test asserts the two strings match
so they cannot drift.

### Test coverage

```bash
node test/test-handler.js     # 40 checks
node test/test-server.js      # 59 checks
node test/test-frontend.js    # 78 checks
```

177 checks. New ones cover: a paused turn is resumed rather than returned;
content from both legs is merged so pre-pause sources survive; the paused
assistant message is sent back unchanged; endless pausing is capped at four
calls; an upstream error mid-resume surfaces its real status instead of being
swallowed; the raised defaults; the truncation flag across five `stop_reason`
values; the warning renders; and the HTML and healthz build strings agree.

### What this says about the process

Every earlier bug was caught by a test before shipping. This one was not,
because the stub always returned a finished turn. The suite tested the code's
handling of the responses I had thought to imagine, and `pause_turn` was not one
of them.

Reading the API documentation for the failure modes of a tool, rather than only
its happy path, would have caught it. That is now a cheap check to repeat
whenever a new tool or capability is added.


### A flaky-test bug found while fixing the above

Three assertions in `test-frontend.js` waited on `document.querySelectorAll('.msg-row').length`. The typing indicator **is** a `.msg-row`, so those waits returned the moment the spinner appeared — before the request had even been sent — and then asserted against an answer that had not arrived. Selectors like `.msg-row.agent .bubble` matched the spinner's own empty bubble for the same reason.

It failed roughly one run in four, with a different assertion each time, which is exactly the profile of a test nobody trusts and everybody eventually deletes.

Replaced with a single `waitForAnswers(n)` helper that counts `.msg-row.agent:not(.typing)`, and every selector that could match the spinner now excludes it. Verified by running the suite eight times consecutively: 78 passed, 0 failed, every time.

Worth stating plainly: this was a defect in the tests, not the product. But a suite that fails intermittently is worse than no suite, because it teaches you to ignore red.

---

## 14. Still truncating — raising the ceiling, and making it diagnose itself

Build `.4` fixed the mechanism but the answers still stopped early. Second
production screenshot: a good opening paragraph, a bold heading introducing a
list, and then nothing under it. The truncation warning fired correctly, which
at least meant it was no longer being passed off as complete.

### Diagnosis

Almost certainly the resume ceiling, not `max_tokens`. `MAX_PAUSE_RESUMES` was
3 while `MAX_SEARCHES` had just gone up to 5, and each search can cost a pause.
Three resumes is not enough headroom for five searches, so the turn ran out of
continuations partway through the answer. The stop point supports this: the text
ends cleanly at the end of a heading rather than mid-word, which is what running
out of legs looks like rather than running out of tokens.

**This is stated as the likely cause, not a confirmed one.** Which is the point
of the next change.

### Made self-diagnosing

Guessing twice was one time too many. Every answer now logs, server-side and in
the browser console:

```
kolos stop_reason=pause_turn resumes=8/8 searches=5/5 blocks=14  <-- RAN OUT OF RESUMES
```

The browser line matters more than the server one on Vercel's free plan, where
runtime logs are kept for an hour. Anyone seeing a short answer can now read
why in the console instead of inferring it from prose.

Logged unconditionally, not only on failure. A log that appears only in the
interesting case gives you nothing to compare against.

### Ceiling raised

`MAX_PAUSE_RESUMES` 3 → 8, env-configurable via `KOLOS_MAX_PAUSE_RESUMES`.

It stays bounded rather than looping to completion because resumes are not free:
each one re-sends the conversation so far, including search results already
returned, as input tokens. The system prompt is cached; that accumulated content
is not. An unbounded retry loop on a pathological question is a bill, not a
feature.

### A way out, not just a warning

Telling a farmer their answer is incomplete and leaving them to work out what to
type is half a feature. A truncated answer now leads its suggestions with a
**Finish that answer** button, styled as the primary action, which sends an
instruction to continue from exactly where it stopped without repeating itself.
The normal next-step suggestions stay alongside it.

Tested: the button appears first and only when truncated, is the only chip
styled primary, normal suggestions survive next to it, and a complete answer
gets no button at all.

### Test coverage

```bash
node test/test-handler.js     # 41 checks
node test/test-server.js      # 59 checks
node test/test-frontend.js    # 84 checks
```

184 checks, all passing, frontend suite run three times consecutively to confirm
the earlier flakiness is gone.

Build `2026-08-03.5`. Check `/api/healthz` to confirm what is actually live
before drawing conclusions from the page.

---

## 15. Guaranteeing the whole answer

Third production screenshot, and a genuinely different failure from the second:

> "Do you know if your farm is registered as a FOP or a legal entity, and rough"

Cut mid-word. That is `max_tokens`, not `pause_turn`. So §14's resume fix worked
— the answer was now long, well-sourced and good — and it then ran into the
2000-token output ceiling set in the same build.

Three truncations, three different causes, each initially mistaken for the last.
Worth stating because the lesson is not "fix pause_turn" or "raise max_tokens",
it is that a turn can stop early for several unrelated reasons and the code has
to treat *stopping early* as the condition, not any one cause of it.

### What changed

**One budget for all stop reasons.** `RESUMABLE` is now a set containing both
`pause_turn` and `max_tokens`, and one `MAX_LEGS` budget (12) covers every
continuation. Adding a third reason later is a one-line change rather than a
new special case.

**`max_tokens` is continued by assistant prefill.** The partial assistant turn
is sent back and the model carries on writing the same message.

**Default `max_tokens` 2000 → 8000.** Raising it costs nothing unless the tokens
are generated; output is billed per token produced, not per token allowed. At
8000 (~6000 words) a single leg should never truncate a farmer's answer.

**A wall-clock budget, which matters more than it sounds.** Continuations cost
time, `maxDuration` was 60s, and a function killed by the platform returns
*nothing at all* — strictly worse than a long answer one paragraph short. So:
`maxDuration` raised to 300 (the Hobby ceiling under fluid compute) and a
240-second budget in `api/chat.js` that stops starting new legs with headroom.
A test asserts the budget stays comfortably below the platform timeout, because
those two numbers live in different files and must move together.

> If a deploy ever fails complaining about `maxDuration`, the project is on the
> pre-April-2025 non-fluid regime where the Hobby ceiling is 60s. Set
> `maxDuration` back to 60 and `KOLOS_TIME_BUDGET_MS` to 45000.

### The "Finish that answer" button is gone

It was added in §14 and removed here at the user's instruction, correctly.
Completing an answer is the server's job. A button asking the farmer to repair a
half-written answer is a failure wearing a feature's clothes, and on a tool
people make money decisions on it also invites acting on the half they were
given.

The incomplete-answer warning stays, reworded to promise nothing and to ask for
a report if it appears. It should now be unreachable in practice; if it fires,
that is a bug worth hearing about, not a workflow.

A test asserts no chip ever offers a finish or continue action in either
language, and that the strings are gone from the UI entirely.

### A bug the tests caught before it shipped

Trimming trailing whitespace before prefill is necessary — the API rejects an
assistant message ending in whitespace, and a truncation lands on a space often
enough to matter. The first implementation trimmed the copy sent upstream but
handed the *untrimmed* original to the browser.

The model continues from what it was given. So "…and rough " trimmed to
"…and rough", continued with "ly how many hectares…", and displayed from the
untrimmed original, produced **"and rough ly how many hectares"** — a space
inserted into the middle of a word, in every continued answer.

Fixed by using one prepared copy for both purposes. A test now asserts the text
shown to the client is byte-identical to the text the model continued from, and
that the two halves join into the correct sentence.

### Test coverage

```bash
node test/test-handler.js     # 54 checks
node test/test-server.js      # 60 checks
node test/test-frontend.js    # 82 checks
```

196 checks. New ones cover: `max_tokens` is continued rather than accepted as
the end; both halves join correctly; trailing whitespace is trimmed before
prefill; a block that becomes empty after trimming is dropped rather than sent
empty; the client sees exactly what the model continued from; the time budget
stops the loop early and reports why; everything gathered before a cutoff is
still returned; and no finish/continue action exists anywhere in the UI.

Verified end to end with a simulated four-leg answer — pause, pause, max_tokens,
end_turn — confirming sources from leg one survive, the split word rejoins, and
the `[[NEXT]]` line arrives at the very end.

Build `2026-08-03.7`.

---

## 16. Going backwards: when a fix made things worse

Build `.7` produced this, with no answer at all:

> Kolos ran into a problem: This model does not support assistant message
> prefill. The conversation must end with a user message.

That is worse than the truncation it replaced. A truncated answer is most of
something; an error is nothing. Two separate defects, and the second one is the
one that matters.

### Defect 1: the continuation method was illegal for this model

`.7` continued a `max_tokens` cut by sending the partial assistant message back
so the model would carry on writing it. That is assistant prefill, and
`claude-sonnet-5` rejects it outright, in those words.

**Why `pause_turn` resumption worked and this did not**, which is the whole
insight: a paused search turn ends on **tool blocks**, and sending it back is a
documented tool continuation, not prefill. A `max_tokens` cut ends on **text**,
and sending that back is prefill. Same-looking code, different legality.

The Anthropic docs pages searched did not state the restriction, so the API's
own error is being taken as ground truth here rather than a documented rule.

**Fix.** The continuation shape is now chosen by inspecting the last content
block, not by `stop_reason`:

- Ends on a tool block → send the assistant message back unchanged. Proven path.
- Ends on text → append the partial as an assistant message **followed by a user
  instruction** to continue. The conversation ends with a user message, which is
  what the model requires.

Chosen by last block rather than by `stop_reason` deliberately: a *paused* turn
can also end on text, and would have hit exactly the same wall. Verified end to
end against a four-leg answer (pause on tools, pause on text, max_tokens,
end_turn) confirming no call ever ends with a text-terminated assistant message.

The continue instruction is explicit about joining cleanly: no repetition, no
restating the question, no acknowledgement, no opening phrase, first character
carries on even mid-word.

### Defect 2: a failed continuation destroyed a good partial answer

This is the more serious one, and it is a design failure rather than an API
misunderstanding.

The loop passed any non-200 straight back to the browser. So when leg two was
rejected, leg one's work — a partly written answer with its sources — was
discarded and the farmer got a red error box.

**A partial answer clearly marked incomplete beats an error, every time.** The
loop now salvages: if a continuation fails and content has already been
gathered, it returns that content with `kolos_stopped_by: "upstream-error"` and
logs the real error server-side. An error on the *first* leg still surfaces
normally, because there is genuinely nothing to salvage.

This turns a whole class of future upstream failures — overload, rate limits,
transient 5xx — from total losses into degraded answers.

### Two smaller things fixed alongside

**The incomplete flag no longer depends on `stop_reason` alone.** A salvaged
partial carries whatever reason its last good leg had, which can be `end_turn`
and look perfectly healthy. `kolos_stopped_by` is now the authoritative signal
and the client checks both.

**Multiple `[[NEXT]]` markers.** An answer assembled from several legs can carry
more than one: the model writes suggestions, gets cut off, and writes them again
when it continues. Every occurrence is now stripped and the **last** one wins,
being the one at the true end of the finished answer. Previously the first won,
which meant a continued answer could show suggestions written before it was
finished.

### What went wrong in the process

Three builds in a row shipped a fix that either did not address the real cause
or introduced a new failure. Two things would have prevented it:

1. **The tests mirrored my assumptions.** The `.7` suite asserted that a
   continuation prefills the assistant turn — it tested that the code did what I
   intended, not that the API would accept it. A stub cannot tell you a real API
   will reject the shape you are sending.
2. **No fallback path.** Every continuation change was written as though it would
   succeed. The salvage behaviour above should have existed from the first
   version; it costs six lines and converts total failures into partial ones.

### Test coverage

```bash
node test/test-handler.js     # 59 checks
node test/test-server.js      # 60 checks
node test/test-frontend.js    # 88 checks
```

207 checks. New ones: a text-ending continuation never prefills and always ends
with a user message; the partial rides as an assistant message before it; the
continue instruction forbids restating; a tool-ending turn still goes back
unchanged; a failed continuation returns the partial with `upstream-error`
rather than an error; a first-leg error still surfaces; a salvaged partial is
flagged incomplete even when `stop_reason` looks clean; and every `[[NEXT]]`
marker is stripped with the last one winning.

Build `2026-08-03.8`.

---

## 17. Links inside the answer

Requirement: when Kolos names an application form or portal, the link belongs in
the answer next to the instruction, not buried in a collapsed Sources list.

### The app was punishing the right behaviour

`inlineFormat` only linkified bare URLs. A markdown link rendered as literal
text: `[State Agrarian Registry](https://dar.gov.ua)` appeared on screen exactly
like that. So if Kolos wrote a link the readable way, the farmer saw brackets
and a raw URL; if it wrote a bare URL, they saw an unreadable string. Neither is
usable on a phone.

`inlineFormat` now converts markdown links, and the prompt instructs Kolos to
write them on the words describing the destination, beside the step they serve.

### Safety, because model output is not trusted input

**Scheme allowlist.** Only `http` and `https` become links. `[click
here](javascript:alert(1))` would otherwise have produced a working script link
inside an answer. Rejected links keep their words and lose the anchor.

**Only real URLs.** The prompt forbids assembling, guessing or completing a URL,
and forbids linking a homepage assumed to exist. A clickable link reads as a
promise; a wrong one sends a farmer somewhere useless while looking
authoritative. If the exact URL is not in that turn's search results, Kolos
names the destination and says how to find it instead.

### Two bugs found by the tests

**Stray bracket.** The URL pattern `[^)\s]+` stops at the first `)`, so
`[here](javascript:alert(1))` matched only as far as `alert(1` and left a `)`
in the farmer's answer. The pattern now allows one level of nested parentheses,
which real URLs contain too.

**NUL bytes in the HTML file.** Markdown links are extracted to placeholders
before the bare-URL pass, or that pass chews through the `href` of a link just
built — its pattern stops at `<` but not at a quote. The first placeholder
implementation used NUL bytes as delimiters, which wrote four raw control
characters into the deployed HTML. Invisible, and liable to be stripped or
mangled by anything in the delivery path. Replaced with a plain ASCII sentinel,
and a test now fetches the served page and asserts it contains no NUL bytes and
no stray control characters at all.

### Presentation

Links are heavier than body text, underlined at 2px with an offset, and get a
tint on hover and a focus ring. They are the actionable part of the answer and
need to survive being read on a phone in a field.

### Test coverage

```bash
node test/test-handler.js     # 59 checks
node test/test-server.js      # 60 checks
node test/test-frontend.js    # 101 checks
```

220 checks. New ones: a markdown link becomes a real link on readable words; no
raw brackets survive; links open in a new tab with `rel="noopener"`; bare URLs
still work; `javascript:` and `data:` URLs are refused while their words remain;
markdown and bare links coexist without corrupting each other; query strings
survive escaping; the served HTML has no NUL or control characters; and the
prompt carries both the placement rule and the no-invented-URLs rule.

Build `2026-08-03.9`.

---

## 18. First primary-source addition to the reference

An official written reply from ПрАТ «Експортно-кредитне агентство» (the Export
Credit Agency) describing the programme of partial compensation for business
property destroyed or damaged by Russian armed aggression, and partial
compensation of war-risk insurance premiums.

### It was handed over labelled as veteran funding

It is not. Filing it there would have had Kolos answer veteran-status questions
with a war-damage scheme, which is a wrong answer delivered confidently. Filed
under its actual subject as section 7 instead, and the mismatch reported rather
than quietly corrected — if a veteran-funding document exists, it has not
arrived.

### Why it earns its place

It fills a genuine hole. The **Rebuilding after war damage** front-page chip had
nothing better to answer with than the general 0.1% restoration-loan line inside
the 5-7-9% programme. This is a dedicated compensation scheme with a named
administering body and a working application page.

It is also the best-sourced thing in the reference. Sections 1 to 6 were
compiled from web search; this came from the agency that runs the programme, in
writing. The reference header now states that provenance is mixed and section 7
carries a `[PRIMARY SOURCE]` tag.

### What was encoded, and what deliberately was not

Encoded: both components; the legal basis (Cabinet Resolution No. 1541 of 28
November 2025); that ECA administers it rather than a ministry or Diia; the four
property categories eligible under the damage component and that the list is
closed; that the insurance component turns on the property's **location** and
the **insurance contract terms** rather than the type of property; that a
contribution must be paid; and that ECA cannot amend the rules or grant
exceptions.

Not encoded: any amount, percentage, deadline or application window. The reply
states none, so none was invented. Section 7 says this explicitly so the model
cannot fill the gap from memory.

Links were verified rather than reconstructed. `https://www.eca.gov.ua/produkty/pk/`
was confirmed by direct fetch. `zakon.rada.gov.ua` blocks automated fetching, so
no link to the consolidated legal text is included — the resolution number is
given so it can be searched. The resolution PDF on kmu.gov.ua is included from
search results.

Ukrainian search hints are included, because the authoritative material is
Ukrainian and an English-only search misses most of it.

### Provenance kept, not just summarised

`reference-sources/2026-08-03_ECA_war-damage-compensation.md` holds the original
correspondence verbatim alongside the structured summary. A reference section
that cannot be audited against its source is a claim, not a citation.

### A hole that folder immediately exposed

`server.js` refused a hand-maintained list of filenames plus the `api/` and
`test/` prefixes. Adding `reference-sources/` meant its contents were publicly
servable on a self-hosted deploy — caught by a test written at the same time,
which failed with a 200.

That list was the wrong shape. It is now rules first: whole directories blocked
by prefix, and `.js`, `.json`, `.md`, `.example` and `.log` refused by extension
outright, since a self-contained single-page app has no reason to serve any of
them. The explicit filenames remain as belt and braces. Tests now assert the
class, not the instance — `/anything-at-all.md` is refused because of what it
is, not because someone remembered to list it.

`.vercelignore` excludes the folder too, so it never reaches Vercel at all.

### Test coverage

```bash
node test/test-handler.js     # 59 checks
node test/test-server.js      # 68 checks
node test/test-frontend.js    # 113 checks
```

240 checks. New ones: section 7 is present and tagged primary-source; the
administering agency, legal basis and verified application URL are all carried;
all four property categories are listed; the closed-list warning survives; the
insurance component's location and contract-terms conditions are stated; the
contribution is flagged; the no-amounts rule is explicit; Ukrainian search hints
are present; the header declares mixed provenance; and seven new static-serving
refusals covering directories and extensions rather than names.

Build `2026-08-03.10`.

---

## 19. Splitting knowledge by how fast it decays

Three additions, and one structural change that matters more than any of them.

### The structural change

Everything used to live in one `PROGRAMME_REFERENCE` block under one rule: never
state a figure or deadline without confirming it by live search this turn. That
rule is right for programmes and wrong for process.

Amounts and windows go stale in months. How you register, what a qualified
electronic signature is, which body runs which portal, what disqualifies an
application — that moves on a scale of years. Forcing Kolos to hedge on the
second category produced a worse advisor, not a safer one. A farmer asking "do I
need to register somewhere before any of this is available to me?" was getting a
hedged answer to a question whose answer will still be true in 2028.

So there are now two blocks with different rules:

- **`PROCESS_REFERENCE`** — stable. Kolos MAY state it directly. Review yearly.
- **`PROGRAMME_REFERENCE`** — volatile. Strict no-unverified-figures rule
  unchanged. Review monthly.

Process comes first in the prompt, because it is the gate that precedes the
offers. New material goes in whichever block matches its volatility, not
whichever is nearer.

### What went into the process block

**The State Agrarian Register as the gate before every other gate.** Most state
support runs through it; an unregistered farmer cannot apply at all however
eligible they are. Verified from dar.gov.ua: open to all producers regardless of
size, including household plots, ФОП and legal entities of any form.

**The qualified electronic signature, called out by name.** Registration needs a
КЕП, an email, a phone and a computer. Three of those every farmer has. The КЕП
is the one they probably do not, and it cannot be obtained in the same sitting.
That single fact is the difference between "register at dar.gov.ua" and advice
someone can act on.

**Which door for which programme.** Register vs Diia vs partner banks vs ECA vs
oblast administration, with the counter-intuitive ones flagged — livestock
subsidies are the Register, not Diia, and they are different systems, so an
application to the wrong one is simply lost time.

**Legal form decides the tier.** ОСГ, ФОП, ФГ and ТОВ are distinguished, with
the instruction to ASK which one the farmer is rather than assume or answer for
all four at once. Some programmes are written for a "суб'єкт господарювання" and
exclude a private individual outright; the ECA scheme is one.

**Common disqualifiers**, tax debt first. Presented as verified for the demining
programme and worth checking elsewhere, not as a universal rule, because only
one instance was confirmed. Tax debt is singled out because it catches farmers
doing nothing wrong and is fixable in advance if they know to look.

### Section 8 — Partial Credit Guarantee Fund

The answer to "the bank refused me because I have no collateral", which is the
most common reason a small Ukrainian farm cannot borrow. Neither a grant nor a
loan: it covers part of the lender's risk so a bank can say yes.

The critical practical point, stated as such: applications go **through a
partner bank or non-bank institution with a business plan, never directly to the
Fund**. A farmer who contacts the Fund has gone to the wrong place.

Paired with the 5-7-9% scheme rather than offered as an alternative — that
programme sets the rate, this is what makes a lender approve at all.

The guarantee percentage and any limit are not published on the Fund's homepage.
Section 8 says so rather than supplying them.

### Section 9 — Humanitarian demining compensation

Sequenced explicitly ahead of everything else in the reference: machinery grants
are meaningless on fields nobody can safely enter.

Verified as approved in 2024: 80% of the cost of demining a plot, once per plot,
UAH 3 billion allocated, prices set by open Prozorro tender, Ministry of Economy
administering, approved 12 March 2024. Every figure carries an explicit 2024
vintage warning and an instruction to confirm the current year first.

The application route was not stated in the source, so section 9 says it was not
stated rather than inventing one.

### Two new chips

**"The bank refused me"** and **"My land needs demining"**, in both languages.
Both are farmer situations the previous ten did not cover, and both now have
material behind them. Twelve chips total.

### Provenance and honesty about sourcing

`reference-sources/2026-08-03_process-and-two-programmes.md` records what each
source did and did not establish. These are public sources I researched, not
correspondence from an agency, so they carry `[STATUS UNVERIFIED]` rather than
the `[PRIMARY SOURCE]` tag the ECA entry earned. The reference should be honest
about which parts came from an agency in writing and which came from me reading
government websites.

### A test bug worth noting

Several new assertions failed on phrases that straddle a line break, because the
prompt text is hard-wrapped. Fixed by normalising whitespace once and asserting
against that, rather than by weakening the assertions to substring fragments
that would have passed for the wrong reasons.

### Cost

System prompt is now about 29,400 characters, roughly 8,000 tokens, up from
5,700. Cached that is a fraction of a cent per message. The reason for splitting
rather than piling on is dilution, not money: two focused blocks the model can
navigate beat one long one it wades through. Retrieval — injecting only relevant
sections — remains the right move above roughly 10,000 tokens and premature
below it.

### Test coverage

```bash
node test/test-handler.js     # 59 checks
node test/test-server.js      # 68 checks
node test/test-frontend.js    # 133 checks
```

260 checks. Twenty new ones covering: the process block reaches the API and
declares its looser rule; the Register is named as the gate and the КЕП as the
obstacle; the routing table names each body; all four legal forms appear and
Kolos is told to ask rather than assume; the disqualifier list leads with tax
debt; the Fund is framed as neither grant nor loan with the never-directly rule
and the unpublished percentage flagged as unpublished; demining is sequenced
first, its 80% tied to its 2024 vintage, and its missing application route
admitted; twelve chips render with both new ones present in both languages.

Build `2026-08-03.11`.

---

## 20. Build `2026-08-20.12` — History, edit-and-re-ask, two production fixes

Tester feedback: *"can we incorporate a history option so users can go back to a
previous question if needed to change answers?"*

### What was there before

`conversation` was a single flat array in `localStorage` under `kolos_state_v1`,
and **New chat deleted it**. There was no way to revisit a question and no record
of previous chats.

### What `.12` adds

- **History drawer** (`#historyBtn`). Lists every question in the current chat;
  tapping one scrolls to it in the thread. Below that, previously saved chats.
- **Edit and re-ask.** Edit any earlier question. Everything after it is
  discarded, because those answers were produced in a context that no longer
  exists, and the user is told how many answers that is before committing.
- **New chat archives instead of destroying.** Empty chats are dropped on save so
  the list stays honest.
- **Storage v2.** `kolos_state_v2` holds `{lang, profile, chats[], activeChatId}`.
  A v1 state is migrated into a single chat on first load, and **the v1 key is
  left in place** so rolling back the deploy loses nothing. Migration persists
  immediately, so a visitor who migrates and leaves does not re-migrate.

### Two defects found while testing, both live in `.11`

**`applyLanguage()` threw for every returning visitor.** It wrote to elements
inside the welcome panel, which `restoreState()` removes when a saved
conversation exists. The first null aborted the function, so chips, profile
dropdowns, placeholder and disclaimer were never localised for anyone coming
back. Confirmed against the `.11` file, not just inferred. Every write is now
guarded by a `setText` helper, and `chipGrid` is null-checked.

This is why the console check in "How to update" is not a formality — the page
looked fine, and the failure only showed on a *second* visit.

**`max_tokens: 1200` in the front end overrode the 8000 default.** The handler
computes `Math.min(Number(max_tokens) || 8000, 8192)`, so a supplied 1200 wins.
Answers still completed via the resume loop, which is why nobody noticed, but
long answers were spending several legs — and every leg re-sends the whole
conversation. Now sends 8000.

### Tests

New suite `test/test-history.js`, 24 checks: drawer contents, jump-to-question,
edit-and-re-ask truncation, what the re-ask actually sends upstream, New chat
archiving, chat switching, reload persistence, v1→v2 migration, and a guard on
`max_tokens` so the ceiling cannot silently regress again. 284 checks now pass
across four suites. None spend API credit.

### Not done

Deployment. `.12` is built and tested but live is still `.11`.
