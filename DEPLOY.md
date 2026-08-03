# Putting Kolos on the internet

This is the Vercel route, which is what you have chosen. It is free, needs no terminal, and takes about 15 minutes.

Two alternatives are at the end if Vercel turns out not to suit.

* * *

## Before you start

**An Anthropic API key.** Go to console.anthropic.com, sign in as PanTerrea, then **API Keys → Create Key**. It starts `sk-ant-` and is shown exactly once, so copy it somewhere safe immediately. This is the only thing here that costs money. Treat it like a bank card.

**A spend limit on that key.** While you are in the console, go to **Billing** and set a monthly limit. Do it now rather than later. It is the difference between a surprise and a capped surprise. Vercel is free; the Anthropic bill is the whole cost of running Kolos.

**A GitHub account.** Vercel reads the code from GitHub.

* * *

## Two things to know about Vercel's free plan

Neither stops you starting today. Both are better known now than discovered later.

**The repository must be your personal one, not an organisation's.** Vercel's own limits say it "does not support connecting a project on your Hobby team to Git repositories owned by Git organizations". So when you create the repo in step 1, create it under your own GitHub username. If you put it under a PanTerrea organisation, Vercel will not offer it for import and the reason will not be obvious.

**The free plan is for non\-commercial use.** Vercel defines commercial usage as any deployment "used for the purpose of financial gain of anyone involved in any part of the production of the project, including a paid employee or consultant writing the code", and restricts the free Hobby plan to personal non\-commercial use. Kolos is being built for PanTerrea. Whether a private dev site with no users, no payments and no advertising crosses that line is genuinely arguable, and Vercel's own guidance is to ask them if you are unsure.

The practical risk is not a fine, it is suspension without much warning, which would take Kolos offline in front of whoever is using it. That is survivable while it is a dev site with a handful of testers. It is not something to still be relying on the day you send the link to farmers. Either ask Vercel support for a ruling, or plan to move to Vercel Pro or another host before launch.

* * *

## Step 1 — Put the code on GitHub

1. Go to github.com and sign in.
2. Click **New repository**. Make sure the **Owner** dropdown shows **your own username**, not an organisation. Name it `kolos`. Choose **Private**. Do not tick "add a README". Click **Create repository**.
3. On the page that appears, click the **uploading an existing file** link.
4. Unzip the Kolos folder on your Mac. Drag the whole `kolos` folder onto the upload area in the browser. Dragging the folder rather than its contents is what keeps the `api` subfolder intact, and that subfolder is what makes the chat work.
5. Scroll down and click **Commit changes**.

**Check before moving on.** The file list must show a folder called `api`. If you only see loose files and no `api` folder, the upload flattened the structure. Delete the repository and try again, dragging the folder itself.

* * *

## Step 2 — Import it into Vercel

1. Go to vercel.com and sign up. Choose **Continue with GitHub**.
2. On the dashboard, click **Add New… → Project**.
3. Find `kolos` in the list and click **Import**.
4. Leave every setting alone. Framework Preset should say **Other**. Build Command, Output Directory and Install Command should all be empty or greyed out. Kolos has no dependencies and nothing to build, so there is genuinely nothing to fill in.
5. Click **Deploy**.

Wait a minute or two. You will get a congratulations screen with a link like `kolos-something.vercel.app`.

* * *

## Step 3 — Add your API key

The site is live now but the chat will not answer yet, because the key is not there.

1. In your project, click **Settings** in the top nav.
2. Click **Environment Variables** in the left sidebar.
3. **Key:** `ANTHROPIC_API_KEY` — exactly that, capitals, no spaces.
4. **Value:** your `sk-ant-…` key.
5. Tick **Production**. Tick Preview and Development as well if you want test deploys to work.
6. Click **Save**.

**Then the step everyone misses.** Adding the variable does nothing to the site that is already live. Environment variables are only picked up when a deployment is built.

Go to the **Deployments** tab, find the most recent deployment, click the **⋯** menu on its right, and choose **Redeploy**. Confirm. Wait for it to finish.

* * *

## Step 4 — Check it actually works

Four checks, in order. **Do not skip the third.**

**1\. The API routes deployed.** Visit `/api/healthz` on your Vercel address. It must show `{"ok":true}`. If you get a 404 instead, the `api` folder did not upload in step 1.

**2\. The page loads.** Visit the main address. Kolos appears with ten grey\-green suggestion buttons.

**3\. The page actually works.** Press **F12**, click the **Console** tab, and reload. It must be empty.

This is not a formality. The previous version of Kolos was declared live and working on the strength of the page loading, and it was completely broken: a single stray character meant none of its JavaScript ever ran. The page looked fine and did nothing. The console is what tells you the difference.

**4\. It answers.** Click a suggestion button and wait. The first real answer takes 10 to 20 seconds because Kolos is searching the web. When it arrives, click **Sources** underneath it and check the links are real.

If step 4 says the server is not configured with an API key, you missed the redeploy at the end of step 3. If it mentions the model, add a second variable `KOLOS_MODEL` set to `claude-haiku-4-5` and redeploy, which tells you whether your account has Sonnet access.

* * *

## Step 5 — Your own domain

Optional. The `.vercel.app` address works fine.

1. **Settings → Domains**, add `kolos.panterrea.com`.
2. Vercel shows you a DNS record. Add exactly that record wherever `panterrea.com` is managed.
3. Wait. DNS is usually minutes, occasionally an hour.

The HTTPS certificate is automatic and renews itself.

* * *

## Living with it

**Updating when I send new files:** upload them to GitHub the same way as step 1. Vercel notices and redeploys on its own, usually within a minute. Your API key lives in Vercel, not in the files, so it survives every update.

**Watching it:** the **Logs** tab in your project. Note that on the free plan runtime logs are kept for one hour, so check soon after a problem rather than the next day.

**Limits worth knowing:** 100 deployments a day, and 1 million function calls a month. Neither is anywhere near reachable for a dev site.

* * *

## What this costs

|  |  |
| --- | --- |
| Vercel Hobby | free |
| Domain | you already own it |
| HTTPS | included |
| **Anthropic API** | **about 5.4¢ per question** |

At thirty questions a day that is roughly $49 a month, and it is the entire bill. This is why the spend limit at the top of this document matters more than anything else here.

Two things to diary. Anthropic's prices rise on 1 September 2026, taking a question from about 5.4¢ to about 6.6¢. And Kolos is capped at three web searches per question, which is the setting holding that number down; raising `KOLOS_MAX_SEARCHES` improves sourcing on hard questions at about 1¢ per extra search.

* * *

## Two things still worth doing

**Rate limiting is weaker on Vercel than anywhere else.** Kolos allows 20 questions per hour per visitor, counted in memory. On a serverless platform that memory belongs to one warm instance and disappears when it goes cold, which on the free plan is often. Treat the limit as a speed bump, not a wall. Before the link goes anywhere public it needs replacing with something durable. Notes are in `BUILD_NOTES.md`.

**Nobody has checked the answers yet.** No call to Anthropic has ever been made from this code, and nobody who knows Ukrainian agricultural funding has read a single Kolos answer. Before a farmer acts on anything it says, have someone qualified read a dozen answers against `Ukraine_Farm_Funding_Reference_Brief.docx`. Kolos carries a July snapshot of programme information and is under instruction never to quote a figure it has not re\-checked live, but that reduces the risk rather than removing it. A farmer who applies to a closed programme loses time they do not have.

* * *

## If you get stuck

Send me two things: the last 50 lines from the **Logs** tab, and a screenshot of the browser **Console** from check 3. Between them they almost always contain the actual answer.

* * *

## If Vercel does not suit

The same package runs on either of these with no code changes.

**Render, $7 a month.** Connect the same GitHub repo, set Start Command to `npm start`, leave Build Command empty, add `ANTHROPIC_API_KEY` under Environment. No commercial\-use restriction and no organisation\-repository restriction. Avoid their free tier: it sleeps when idle, and a cold start on top of a 15\-second answer is a poor experience for someone on a phone in a field.

**Your own server, €5.49 a month.** Hetzner's cheapest x86 plan with Ubuntu, running `server.js` behind Caddy for HTTPS. Cheapest of the three, and the only one where patching, monitoring and fixing it at 11pm are your job. Ask me and I will write that guide out in full.
