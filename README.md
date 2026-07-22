# Kolos — Funding Advisor for Ukrainian Farmers

This package contains an updated version of `Kolos_Funding_Advisor.html` plus a minimal
backend (`server.js`) it now talks to, and a sourced reference document on current
Ukrainian farm funding programmes.

## Files

- `Kolos_Funding_Advisor.html` — the chat UI (frontend only, no secrets inside)
- `api/chat.js`, `api/healthz.js`, `vercel.json` — Vercel serverless functions that
  hold the Anthropic API key server-side (this is the deployment path below)
- `server.js` — an alternative Express backend, only relevant if you self-host on a
  platform that runs a persistent Node process (Render, Railway, a VPS) instead of
  Vercel. **Ignore it for the Vercel path** — it is not used there.
- `package.json`, `.env.example` — shared config
- `Ukraine_Farm_Funding_Reference_Brief.docx` — sourced research on current grant/loan
  programmes, compiled 22 July 2026, for your team to review as ground-truth content

## What was fixed and why

**The original file called the Anthropic API directly from browser JavaScript, with no
API key in the request at all — so as-shipped it could never have worked.** Even if a
key had been added directly in the HTML, that would expose it to every visitor (anyone
can view-source or open devtools' Network tab and copy it out, then run up your API
bill or worse). This is not a minor bug — it's the difference between a demo and
something you can safely put in front of real users.

The fix: the frontend now POSTs to `/api/chat` instead. That route is a serverless
function (`api/chat.js`) that holds `ANTHROPIC_API_KEY` as a server-side environment
variable and is the only thing that ever talks to `api.anthropic.com`.

**Also flagged, not silently changed:** the original code requested model
`claude-sonnet-4-6`, which doesn't match any current Anthropic model name I can
verify — it looks like a typo or a stale alias. `api/chat.js` defaults to
`claude-sonnet-5` (Anthropic's current Sonnet model per their own docs as of this
writing), but you should confirm against your Anthropic account / https://docs.claude.com
before relying on it, since model access can vary by account and this wasn't something
I could test against your actual API key.

## Deploying via GitHub + Vercel

This is set up to deploy the normal way, with one thing to know: Vercel doesn't run a
persistent server from a repo — it runs the files under `api/` as serverless functions,
one route per file. `api/chat.js` and `api/healthz.js` are already written as Vercel
functions, so the usual flow works as-is:

1. Push this whole folder to a GitHub repo (all these files at the repo root, `api/`
   as a real subfolder).
2. In Vercel: **Add New... > Project**, import that GitHub repo. Framework preset can
   stay "Other" — there's no build step needed.
3. Before (or right after) the first deploy, go to **Project Settings > Environment
   Variables** and add `ANTHROPIC_API_KEY` with your real key. Add it for Production
   at minimum; add it for Preview and Development too if you want preview deploys and
   `vercel dev` to work.
4. Deploy. Vercel auto-detects `api/chat.js` → `/api/chat` and `api/healthz.js` →
   `/api/healthz`. `vercel.json` routes the root URL to `Kolos_Funding_Advisor.html` so
   visiting the deployment's main URL opens the app directly.
5. Every `git push` to the connected branch redeploys automatically, same as any other
   Vercel project.

**Local testing before you push:** install the Vercel CLI once (`npm i -g vercel`),
then run `vercel dev` from this folder. It emulates the same `api/` routing Vercel uses
in production. Either run `vercel env pull` first (pulls the env vars you set in the
dashboard into a local `.env.development.local` file) or create your own `.env` from
`.env.example` — `vercel dev` reads it automatically.

**Before putting this in front of real farmers:** there's no rate limiting on
`/api/chat` — anyone who can reach the URL can call it, and every call costs API
credit. Consider Vercel's Edge Config, a KV store, or a service like Upstash Ratelimit
to cap usage per visitor. This is called out again in the comments at the top of
`api/chat.js`.

## Self-hosting instead of Vercel (alternative)

If you'd rather run this on a platform that keeps a persistent Node process alive
(Render, Railway, a VPS) instead of Vercel's serverless model, use `server.js` instead
of the `api/` folder:

1. `cd` into this folder, `npm install express cors dotenv` (not included by default
   since the Vercel path needs no dependencies).
2. `cp .env.example .env` and put your real `ANTHROPIC_API_KEY` in it.
3. `node server.js` — runs the backend on `http://localhost:8787` (override with `PORT`).
4. Point the frontend at it by adding, **before** the existing `<script>` tag in
   `Kolos_Funding_Advisor.html`:
   ```html
   <script>window.KOLOS_API_BASE = 'https://your-backend.example.com';</script>
   ```

## Features added

- **Ukrainian / English toggle** (UA / EN buttons in the header) — switches all UI
  text and instructs Kolos to answer in the selected language (it still follows
  whichever language the farmer actually types in, if that differs).
- **Optional farm profile** (region/oblast, main activity, business size) — collapsible
  panel above the chat. Saved details are quietly added to Kolos's context so answers
  can be tailored, without cluttering the visible conversation.
- **Conversation persistence** — the chat, language choice and farm profile are saved
  to the browser's `localStorage` and restored on reload. "New chat" clears everything.
- **Export chat** — downloads the full conversation, including cited sources, as a
  plain-text file. (For a PDF, use the browser's own Print → Save as PDF; a print
  stylesheet is included that hides the input bar and buttons for a cleaner printout.)

## About the reference brief

`Ukraine_Farm_Funding_Reference_Brief.docx` lists specific programmes (government
grants, the 5-7-9% loan scheme, EU/FAO grant cycles, EBRD/World Bank/IFC financing,
women- and veteran-led business grants, and more) each with its source link and a
"last verified" date. It also explicitly flags where information is uncertain — most
importantly, that USAID's Ukraine programming was heavily disrupted by the 2025
restructuring of the agency, so it should not be treated as a reliably open channel
without checking current status first.

This brief is a snapshot, not a live feed — several cited deadlines will likely have
already passed. Kolos itself is instructed to always search the web live rather than
rely on a static list, since programmes change fast; use this document as background
and a sanity-check on what Kolos says, not as something to hard-code into the app.
