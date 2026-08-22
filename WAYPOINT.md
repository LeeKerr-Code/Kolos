# Kolos — working waypoint

**Build:** `2026-08-20.13` — pushed 20 August, live state to be confirmed
**Status:** `.12` deployed and confirmed live 20 August (History drawer seen
working in production). `.13` fixes a real defect found while recording a demo:
a returning visitor who pressed **New chat** got the welcome panel back with no
suggestion chips in it. `#chipGrid` sits inside the welcome panel, which is
detached from the document whenever a conversation exists, so
`document.getElementById` could not find it and the chips were never populated.
Now queried through `welcomeEl` itself. Regression test added — it fails against
`.12` and passes against `.13`.
**Git tag:** `working-2026-08-03.8` (last production-verified); `.11` adds inline links, the ECA programme, a process reference and two more programmes

Read this first. `BUILD_NOTES.md` is the full history and is long; this is the
state of things and what to do next.

---

## Where everything is

| | |
|---|---|
| Live site | https://kolos-5knq.vercel.app — **this one only** |
| Deleted | `kolos-ecru.vercel.app` was a *second* Vercel project fed by the same repo, with no `ANTHROPIC_API_KEY`, so every question there failed with "Server is not configured with an API key". Deleted 11 August 2026. If a Kolos URL ever gives that error again, check you are not on a duplicate project before touching the key. |
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

**286 checks** pass across four suites:

```bash
node test/test-handler.js     # 59 — request handling, continuations, salvage
node test/test-server.js      # 68 — server.js live, plus deploy config
node test/test-frontend.js    # 133 — the UI in headless Chromium
node test/test-history.js     # 26 — History, edit-and-re-ask, v1 migration, chip regression
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

## Defects fixed in `.12` and `.13` (all were live in production)

**A returning visitor got no localisation.** `applyLanguage()` wrote to elements
inside the welcome panel, which `restoreState()` removes as soon as a saved
conversation exists. The first null threw and aborted the function part-way, so
chips, profile dropdowns, the input placeholder and the disclaimer were never
localised for anyone coming back to a saved chat. Every write is now guarded.
Found by accident while testing History; it has been live since at least `.11`.

**`max_tokens` was pinned at 1200 by the front end.** `api/chat.js` defaults to
8000, but the browser sent 1200 and `Math.min(Number(max_tokens) || 8000, 8192)`
took it verbatim. Answers still completed, because `max_tokens` is `RESUMABLE`,
but a long answer burned several continuation legs where one would do — each
re-sending the whole conversation. Now sends 8000, as BUILD_NOTES always said.

---

## Open items, in priority order

**1. Rate limiting is not durable.** 20 questions per hour per visitor, counted
in memory. On serverless that memory belongs to one warm instance and is lost
when it recycles, which on the free plan is often. Treat it as a speed bump.
Replace with Vercel KV or Upstash before the URL is shared publicly. Swap point
is marked in `api/chat.js`.

**2. Human auditors are coming on board (confirmed 20 August 2026).**
This was the gate before a farmer could safely act on anything Kolos says, and it
is being closed. Still to settle before it counts as done:

- **What they audit and how often.** Sampling after publication and reviewing
  before publication are different products with different costs and different
  permissible marketing claims. Decide which.
- **How findings get back into the build.** An auditor finding is only worth
  anything if a correction reaches `PROGRAMME_REFERENCE` with provenance in
  `reference-sources/`. Without that loop the audit produces opinions, not fixes.
- **Their real cost.** The cost model in both Elishka emails carries a £185/month
  estimate for roughly four hours. Replace it with the actual figure.
- **Start them on Kolos Light.** Three fixed answers is a small, bounded first
  job that proves the process before it meets an open-ended agent.

Until an auditor has actually signed off answers, no marketing material may claim
the answers are checked by a specialist. See `COMPETITIVE_PRICING.md` and the
marketing description for the claim rules.

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

## Going live on kolos.panterrea.com

Planned 20 August 2026, not started. Do these in order.

1. **Upgrade Vercel to Pro** ($20/user/month). Hobby is licensed for personal,
   non-commercial use — taking subscription payments on it is a breach and risks
   suspension. This is owed regardless of the subdomain.
2. **Make rate limiting durable first.** Open item 1 below. In-memory counting is
   survivable on an unlisted URL and not on a public branded one: it is the only
   thing between an ad campaign and an uncapped Anthropic bill. Upstash free tier
   covers expected volume.
3. **Fix the deploy path before pointing DNS.** Today's method is dragging files
   into GitHub's web UI, which has already put the wrong build live twice. Clone
   the repo fresh as the single working copy, archive the stale `kolos 2`–`kolos 8`
   folders, then deploy by `git push`.
4. **Deploy through Preview, not straight to main.** Push a branch, check the
   preview URL (healthz build string, clean console, one real question), then
   merge.
5. **Add the domain.** Vercel → project `kolos-5knq` → Settings → Domains → add
   `kolos.panterrea.com`. Vercel issues a **project-specific CNAME target**, shaped
   like `d1d4fc829fe7bc7c.vercel-dns-017.com` — read it off the dashboard. Do not
   use the generic `cname.vercel-dns.com` that older guides still quote. Create
   CNAME `kolos` → that value at whoever hosts panterrea.com DNS. Certificates are
   automatic.
6. **After it resolves:** update the GitHub About link (still points at the deleted
   `kolos-ecru.vercel.app`), and swap the new URL into the marketing description
   and Kolos Light's upsell so nothing ships pointing at a `vercel.app` address.

Unknown: where panterrea.com DNS is managed. Needed for exact steps at step 5.

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
