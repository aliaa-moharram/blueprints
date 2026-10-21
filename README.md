# Lean blueprints

Builds and hosts client integration blueprints behind private links. Teammates build a blueprint in a form in the admin page, or upload a finished HTML file. For each blueprint you can:

- **Share one private link per team**, labelled with the team's name, and revoke it at any time.
- **See which team opened it**, when, and for how long in total and per visit. Optionally, get a Slack message when a client opens it.
- **Keep checklist progress per client team.** Each client team ticks its own checklist. Lean team links show a client team's progress, read only.

Blueprints are uploaded from the admin page and stored in the database, never in this repository and never as public files. They are only served through their links, so nobody can open one by guessing a URL.

## How it fits together

| Path | What it is |
|---|---|
| `api/b.js` | Serves `/b/<token>`: checks the link, returns the blueprint with the tracking script added |
| `api/track.js` | Records visits and time on page |
| `api/checklist.js` | Reads and saves checklist ticks |
| `api/admin/*` | Admin endpoints (build, upload, links, overview, product library), protected by `ADMIN_PASSWORD` |
| `lib/products.js` | The product library: every product a form-built blueprint can include, with its guide panel |
| `lib/render.js`, `lib/template.js` | Turn form content into a finished page in the blueprint design |
| `public/theme.js` | Client colour handling, shared by the form preview and the page |
| `public/admin/index.html` | The admin page at `/admin` |
| `public/bp-runtime.js` | The script added to every blueprint (visit timer and checkboxes) |
| `db/schema.sql` | Database tables: `blueprints`, `links`, `views`, `checklist` |
| `tests/` | End-to-end checks and a small sample blueprint |

## Deploy (once, about 20 minutes)

1. **Put this folder in a private GitHub repository owned by Lean**, not a personal account.
2. **In Vercel, create a project from that repository.** Choose the "Other" framework preset and leave the build command empty. `vercel.json` already sets the output folder and routes.
3. **Add a Postgres database.** Any Postgres works: one from Vercel's storage marketplace (such as Neon), Supabase, or Lean's own. Connect it to the project so the connection string is available as `DATABASE_URL`. If your provider names the variable differently, add `DATABASE_URL` yourself with the same value.
4. **Set the environment variables** (see `.env.example`):
   - `ADMIN_PASSWORD`: required, at least 12 characters. Use a long random value and share it with your team through a password manager.
   - `SLACK_WEBHOOK_URL`: optional. A Slack incoming-webhook URL for alerts when a client first opens a blueprint.
   - `PUBLIC_BASE_URL`: optional. Set it if you add a custom domain, so new links use that domain.
5. **Create the tables.** Either run `DATABASE_URL=<connection string> npm run migrate` from a laptop, or paste `db/schema.sql` into your provider's SQL editor. If the editor says it "cannot insert multiple commands into a prepared statement", paste `db/schema-single-statement.sql` instead; it's the same schema as one command. Both are safe to run more than once.
6. **Deploy, then check these things on the live site:**
   - `/admin` loads and accepts the password.
   - Upload a blueprint with **Add a blueprint**.
   - Create a **Lean team** link for yourself and open it.
   - Tick a checklist item, reload, and confirm it's still ticked.
   - Keep the page open for 10 seconds, then refresh `/admin`: the visit appears under "Recent visits".

## Add a blueprint for a new client

Anyone on the team with the admin password can do this. No GitHub or Vercel access needed. In `/admin`, click **Add a blueprint**, then choose one of these.

### Build it with the form (most blueprints)

1. Enter the client name and a short name such as `acme-remit`, then **Start blueprint**.
2. Fill in the sections:
   - **Basics:** client details; the header (Lean and client logos, or Lean logo and client name); colours (Lean colours, or a client colour with a live readability check); subtitle and summary.
   - **Pain points & opportunities:** rows under Business impact or Technical & operational.
   - **Journeys:** each with a label, title, the client feature, the need, Lean products, up to two screenshots and an optional "Also covers" line. Tick "Not confirmed yet" for a dashed outline.
   - **Design reference:** optional Figma card with preview images and flow links.
   - **Launch plan:** product cards, phases, table rows, totals and a note under the table. Products come from the library, with their endpoints and guide panels added automatically. Use "Custom product" for anything not in it.
3. **Save draft** as you go. **Preview** opens the page exactly as the client will see it.
4. **Publish** when it's ready, then create team links. Later edits stay as a draft, and clients keep seeing the published version until you publish again.

Use `**double asterisks**` for bold text. Screenshots are resized automatically, so add them at any size.

### Upload a finished HTML file

1. **Prepare the file.** One self-contained HTML page, with images embedded, under 4 MB. It needs a `<title>`. Add `data-check="<key>"` to each checklist item you want saved, with unique keys using lowercase letters, digits and hyphens.
2. **Upload it** with a short name. The page tells you what to fix if the file is rejected.
3. **To update it**, use **Replace file**. Ticks are kept for every checklist key still in the file.

## Team links and checklists

- **One link per team.** Create one **Client team** link per client team, plus a **Lean team** link for your own previews. Everyone on a team uses the same link. Creating a link for a team that already has one on that blueprint returns the existing link.
- **Each client team has its own checklist.** Ticks made through one team's link never show on another team's link, and a new team starts with an empty checklist.
- **Lean team links are read only.** They show each client team's ticks, with a switcher when there are several client teams, and can't change them. Lean visits are labelled separately and never trigger client alerts.
- **Revoking a team's link** keeps its checklist and visit history. Restore the link to bring them back. Revoked links are hidden from the Links table unless you tick **Show revoked links**.
- **Deleting a link** is only possible once it's revoked. It permanently removes the link with its visits and checklist ticks.
- **Deleting a blueprint** (at the bottom of its page) permanently removes it with all its links, visits and checklist ticks. You type its short name to confirm.

## The product library

`lib/products.js` lists every Lean product the form offers: name, short label, card description, endpoints, the standard note under the endpoints, default effort and, where there is one, the guide panel. Change it when Lean's products or docs change; blueprints pick up the change the next time they're published.

Guide checklist items are saved against keys like `otp-1`, `otp-2`, in order. **Add new checklist steps at the end of a list**, so ticks already saved on published blueprints stay on the right steps.

## Updating an existing installation

When a new version of this tool changes the database, paste `db/schema-single-statement.sql` into the Neon SQL Editor and run it again. It only adds what's missing and keeps all existing data.

## How visits are counted

- A visit counts once the page has been **visible for 10 seconds**, so email link scanners and quick previews don't inflate it.
- Each page load is one visit. Time on page counts only while the tab is visible, capped at 4 hours per visit.
- **Visits and time are tracked per team link.** Individual people on a team aren't distinguished. If two people on the same team have the page open at once, both of their time counts toward the team total.
- No IP addresses are stored. Each visit records the browser, operating system and country (from Vercel's location header).
- Slack alerts go out for client team links only, at most once every 12 hours per link.

Consider telling clients in your cover note that the link is personal to them.

## Security notes

- Link tokens are random 24-character values and can't be guessed. Anyone holding an active link can read the blueprint and tick checklist items; revoke the link to stop that.
- The admin page uses one shared password. Rotate it in Vercel when someone leaves the team. Individual sign-in for teammates is a sensible next step if the team grows.
- Every response carries `noindex`, so search engines don't list the pages.

## Run it locally

```
npm install
DATABASE_URL=postgres://... ADMIN_PASSWORD=<12+ characters> PGSSL=disable npm run dev
```

Then open http://localhost:3000/admin. `npm test` runs the end-to-end checks against the database in `DATABASE_URL`.

## Not included yet

- **Teammate comments.** Options are a comment widget added to `bp-runtime.js`, or a review tool on preview deployments. Check what your Vercel plan offers before building one.
- **Version history.** Each form-built blueprint has one draft and one published version.
- **Two people editing one blueprint at once.** The last save wins.
