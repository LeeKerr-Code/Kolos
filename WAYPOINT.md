# Kolos — working waypoint

**Build:** `2026-08-03.11`
**Status:** live and working in production, verified 3 August 2026
**Git tag:** `working-2026-08-03.8` (last production-verified); `.11` adds inline links, the ECA programme, a process reference and two more programmes

Read this first. `BUILD_NOTES.md` is the full history and is long; this is the
state of things and what to do next.

---

## Where everything is

| | |
|---|---|
| Live site | https://kolos-5knq.vercel.app |
| Health / build check | https://kolos-5knq.vercel.app/api/healthz |
| GitHub | `LeeKerr-Code/Kolos` (personal account, not an org — Vercel Hobby cannot use org repos) |
| Vercel project | `kolos-5knq`, Hobby plan |
| Local working copy | `~/Documents/Panterrea/Projects/Farmer Funding Agent/` |
| Snapshot | `Kolos_WORKING_2026-08-03.8.zip` and `kolos-repo-2026-08-03.8.bundle` in that folder |

**Confirm what is live before debugging anything.** `/api/healthz` returns
`{"ok":true,"build":"..."}`. The same string is logged to the browser console on
page load. A missing feature and a broken one look identical from the page, so
check the build first — this has already cost time twice.

---

## What works

Verified in production, not just in tests:

- Answers arrive complete, with sources, in English and Ukrainian.
- Twelve situation-led suggestion chips on the front page; contextual follow-up
  suggestions under every answer.
- Two knowledge blocks in the system prompt, split by how fast they decay:
  `PROCESS_REFERENCE` (registration, legal forms, which portal serves which
  programme, common disqualifiers) which Kolos may state directly, and
  `PROGRAMME_REFERENCE` (nine programmes) which it may never quote a figure or
  deadline from without confirming by live search that turn.
- Application links appear inline in the answer, on readable words, next to the
  step they serve. Only http/https is ever made clickable.
- Farm profile (oblast, activity, size) feeds the answer.
- Conversation persists across reload; export works.
- API key is server-side only and never reaches the browser.

**260 checks** pass across three suites:

```bash
node test/test-handler.js     # 59 — request handling, continuations, salvage
node test/test-server.js      # 68 — server.js live, plus deploy config
node test/test-frontend.js    # 133 — the UI in headless Chromium
```

None of them spend API credit.

---

## Configuration

Only `ANTHROPIC_API_KEY` is required, set in Vercel → Settings → Environment
Variables. **Adding or changing it does nothing until you redeploy** —
environment variables are only picked up by a new build.

Everything else has a working default and is documented in `.env.example`.
The ones worth knowing:

| Variable | Default | What it does |
|---|---|---|
| `KOLOS_MAX_SEARCHES` | 5 | Web searches per question. The largest cost item, at $10/1000. |
| `KOLOS_MAX_LEGS` | 12 | Continuation attempts per answer. |
| `KOLOS_TIME_BUDGET_MS` | 240000 | Must stay below `maxDuration` in `vercel.json` (300s). |
| `KOLOS_MODEL` | `claude-sonnet-5` | |
| `KOLOS_RATE_LIMIT_MAX` | 20 | Per IP, per hour. |

---

## Cost

About **5.4¢ per question**, and the Anthropic bill is essentially the whole
cost of running this. Vercel Hobby is free. Roughly $49/month at 30 questions a
day.

Set a monthly spend limit at console.anthropic.com → Billing. It is the only
cost control that actually binds.

Anthropic's prices rose on 1 September 2026; if that has passed, a question is
nearer 6.6¢.

---

## Open items, in priority order

**1. Rate limiting is not durable.** 20 questions per hour per visitor, counted
in memory. On serverless that memory belongs to one warm instance and is lost
when it recycles, which on the free plan is often. Treat it as a speed bump.
Replace with Vercel KV or Upstash before the URL is shared publicly. Swap point
is marked in `api/chat.js`.

**2. Nobody with Ukrainian agri-funding knowledge has reviewed the answers.**
This is the gate before a farmer acts on anything Kolos says. Have someone
qualified read a dozen answers against the reference brief. Kolos is instructed
never to state an unverified figure, which reduces the risk without removing it.

**3. Vercel Hobby is non-commercial only.** Their fair use guidelines define
commercial usage as any deployment for the financial gain of anyone involved in
producing it, including paid contributors. The risk is suspension without much
warning. Fine for a dev site with a few testers; not something to rely on the
day the link goes to farmers. Move to Vercel Pro, Render ($7/mo) or a VPS
(€5.49/mo) before launch — the package runs on all of them unchanged.

**4. The Ukrainian UI copy wants a native reader.** Chips, intro and warnings
are grammatical but were not written by a native speaker, and the frontline and
occupation wording carries tone.

**5. The reference has mixed provenance, by design.** `PROCESS_REFERENCE` is
stable and needs review roughly yearly. In `PROGRAMME_REFERENCE`: sections 1-6
are a 22 July 2026 web snapshot with the FAO-EU intakes already `[EXPIRED]`;
section 7 (ECA war-damage) is primary-source correspondence; sections 8-9
(credit guarantee fund, demining) are public sources verified 3 August 2026,
with the demining figures carrying a 2024 vintage warning. Re-verify the
programme sections monthly. Provenance for everything after section 6 is in
`reference-sources/`.

---

## How to update

Drop new files into GitHub; Vercel redeploys within a minute. Your API key lives
in Vercel, not in the files, so it survives every update.

Then, in order: check `/api/healthz` shows the new build, open the page with F12
on the Console tab and confirm it is clean, and ask one real question.

The console check is not a formality. An earlier build was declared live on the
strength of the page loading while none of its JavaScript ran.

---

## If an answer looks wrong

The browser console prints one line per answer:

```
Kolos answer: stop_reason=end_turn legs=3/12 blocks=7 ms=18432
```

If an answer is incomplete it says `INCOMPLETE` and names what stopped it:
`leg-budget`, `time-budget`, or `upstream-error`. That line is the fastest route
to a diagnosis, and it matters more than the Vercel logs, which the free plan
discards after an hour.
