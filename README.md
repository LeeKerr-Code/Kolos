# Kolos — Funding Advisor for Ukrainian Farmers

**This is the only package to use.** If you have any earlier zip from this project
(anything with `server.js` as the backend, or named `Kolos_v1.zip` /
`Kolos_v1_bundle.zip`), delete it and the GitHub repo contents built from it — those
were superseded and are the likely source of the "Cannot GET /" error, since that repo
was still running the old Express server instead of this Vercel setup.

## Files (7 total — that's everything)

- `Kolos_Funding_Advisor.html` — the chat UI. No secrets inside; safe to be public.
- `api/chat.js` — Vercel serverless function. Holds your Anthropic API key
  server-side and is the only thing that ever talks to `api.anthropic.com`.
- `api/healthz.js` — a tiny liveness check at `/api/healthz`.
- `vercel.json` — routes the site's root URL to `Kolos_Funding_Advisor.html`.
- `package.json` — no dependencies required.
- `.env.example` — template for your local `.env` file (local testing only).
- `Ukraine_Farm_Funding_Reference_Brief.docx` — sourced research on current
  Ukrainian farm grant/loan programmes (compiled 22 July 2026) for your team to
  use as background reading. Not part of the deployed app.

There is no `server.js` in this package — that was the source of the confusion in the
previous zips. Everything the app needs to run lives in the 6 files above (the .docx
is just reference material).

## Deploy: GitHub + Vercel

1. Unzip this into an **empty** folder. Confirm `vercel.json` and
   `Kolos_Funding_Advisor.html` sit at the top level of that folder — not nested one
   level down inside another folder.
2. Turn that folder into a fresh git repo and push it to GitHub:
   ```
   git init
   git add .
   git commit -m "Kolos v1"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
   (If you already have a `Kolos` repo from a previous attempt, it's cleanest to
   delete it on GitHub and create a new one, so there's no old `server.js` left over
   on another branch to confuse Vercel later.)
3. In Vercel: **Add New... > Project**, import that repo. Leave the framework preset
   as "Other" — no build command is needed.
4. Go to **Project Settings > Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your real Anthropic key
   Add it for the Production environment at minimum.
5. Deploy. Visiting your `*.vercel.app` URL should now load the Kolos chat UI
   directly (via the `vercel.json` rewrite), and the chat should work because
   `/api/chat` is live.
6. From here, every `git push` to `main` redeploys automatically, same as any other
   Vercel project.

### If you still see "Cannot GET /" after this

That specific message only comes from an Express app's default 404 — it means
something is still serving the old `server.js` instead of this setup. Check, in order:
1. Does the GitHub repo's **root** (not a subfolder, not another branch) contain
   `vercel.json` and `Kolos_Funding_Advisor.html`?
2. In the Vercel project's **Deployments** tab, open the latest deployment's build
   log — does it list `api/chat.js` and `api/healthz.js` as detected functions?
3. In **Project Settings > General**, is "Root Directory" set to blank/`.`  (not to
   `api` or any subfolder)?

If any of those don't match, that's the fix — no code change needed, just the repo/
project pointing at the right files.

### Local testing before you push

Install the Vercel CLI once (`npm i -g vercel`), then run `vercel dev` from this
folder. Create a `.env` file from `.env.example` first (or run `vercel env pull`
after your first deploy) — `vercel dev` reads it automatically and emulates the same
`api/` routing Vercel uses in production.

### Before putting this in front of real farmers

There's no rate limiting on `/api/chat` yet — anyone who can reach the URL can call
it, and every call costs API credit. Consider Vercel's Edge Config, a KV store, or a
service like Upstash Ratelimit to cap usage per visitor. Also flagged in the comments
at the top of `api/chat.js`.

## What was fixed from the original file, and why

The original `Kolos_Funding_Advisor.html` called the Anthropic API directly from
browser JavaScript, with no API key in the request at all — so as shipped it could
never have worked. Even if a key had been hardcoded into the HTML, that would expose
it to every visitor (view-source, browser devtools' Network tab, or anyone who saves
and reshares the file) — not a minor bug, but the difference between a demo and
something safe to put in front of real users. The fix: the frontend now POSTs to
`/api/chat`, and `api/chat.js` is the only thing holding the real key, server-side.

Also flagged, not silently changed: the original code requested model
`claude-sonnet-4-6`, which doesn't match any current Anthropic model name I can
verify — it looks like a typo or a stale alias. `api/chat.js` defaults to
`claude-sonnet-5` (Anthropic's current Sonnet model per their own docs as of this
writing); confirm against your Anthropic account / https://docs.claude.com before
relying on it, since model access can vary by account and I couldn't test this
against your actual API key.

## Features in this version

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
women- and veteran-led business grants, and more), each with its source link and a
"last verified" date. It also explicitly flags where information is uncertain — most
importantly, that USAID's Ukraine programming was heavily disrupted by the 2025
restructuring of the agency, so it should not be treated as a reliably open channel
without checking current status first.

This brief is a snapshot, not a live feed — several cited deadlines will likely have
already passed. Kolos itself is instructed to always search the web live rather than
rely on a static list, since programmes change fast; use this document as background
and a sanity-check on what Kolos says, not as something to hard-code into the app.
