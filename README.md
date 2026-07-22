# Kolos — Funding Advisor for Ukrainian Farmers

This package contains an updated version of `Kolos_Funding_Advisor.html` plus a minimal
backend (`server.js`) it now talks to, and a sourced reference document on current
Ukrainian farm funding programmes.

## Files

- `Kolos_Funding_Advisor.html` — the chat UI (frontend only, no secrets inside)
- `server.js`, `package.json`, `.env.example` — a minimal Node/Express backend proxy
- `Ukraine_Farm_Funding_Reference_Brief.docx` — sourced research on current grant/loan
  programmes, compiled 22 July 2026, for your team to review as ground-truth content
- `build_doc.js` — the script used to generate the .docx (kept for reproducibility)

## What was fixed and why

**The original file called the Anthropic API directly from browser JavaScript, with no
API key in the request at all — so as-shipped it could never have worked.** Even if a
key had been added directly in the HTML, that would expose it to every visitor (anyone
can view-source or open devtools' Network tab and copy it out, then run up your API
bill or worse). This is not a minor bug — it's the difference between a demo and
something you can safely put in front of real users.

The fix: the frontend now POSTs to `/api/chat` instead. `server.js` is a small Express
server that holds `ANTHROPIC_API_KEY` as a server-side environment variable and is the
only thing that ever talks to `api.anthropic.com`.

**Also flagged, not silently changed:** the original code requested model
`claude-sonnet-4-6`, which doesn't match any current Anthropic model name I can
verify — it looks like a typo or a stale alias. `server.js` defaults to
`claude-sonnet-5` (Anthropic's current Sonnet model per their own docs as of this
writing), but you should confirm against your Anthropic account / https://docs.claude.com
before relying on it, since model access can vary by account and this wasn't something
I could test against your actual API key.

## Running it

1. `cd` into this folder.
2. `npm install`
3. `cp .env.example .env` and put your real `ANTHROPIC_API_KEY` in it.
4. `npm start` — runs the backend on `http://localhost:8787` (override with `PORT`).
5. Open `Kolos_Funding_Advisor.html` in a browser. By default it calls `/api/chat` on
   its own origin. If you serve the HTML from a different host than the backend, add
   this line **before** the existing `<script>` tag in the HTML:
   ```html
   <script>window.KOLOS_API_BASE = 'https://your-backend.example.com';</script>
   ```

Before putting this in front of real farmers, add rate limiting and tighten
`KOLOS_ALLOWED_ORIGIN` in `.env` to your actual frontend's origin — the reference
server accepts unlimited requests from any origin by default, and every request costs
API credit. This is called out again in comments at the top of `server.js`.

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
