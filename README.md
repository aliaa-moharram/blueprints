# Lean blueprints

Hosts client integration blueprints behind private links. For each blueprint you can:

- **Share a private link per client contact**, labelled with who it's for, and revoke it at any time.
- **See who opened it**, when, and for how long. Optionally, get a Slack message when a client opens it.
- **Keep checklist progress.** Ticks in a blueprint's checklists are saved and shown to everyone with a link, along with who ticked each item.

Blueprints are uploaded from the admin page and stored in the database, never in this repository and never as public files. They are only served through their links, so nobody can open one by guessing a URL.

## How it fits together

| Path | What it is |
|---|---|
| `api/b.js` | Serves `/b/<token>`: checks the link, returns the blueprint with the tracking script added |
| `api/track.js` | Records visits and time on page |
| `api/checklist.js` | Reads and saves checklist ticks |
| `api/admin/*` | Admin endpoints (upload blueprints, create and revoke links, overview), protected by `ADMIN_PASSWORD` |
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
5. **Create the tables.** Either run `DATABASE_URL=<connection string> npm run migrate` from a laptop, or paste `db/schema.sql` into your provider's SQL editor. It's safe to run more than once.
6. **Deploy, then check these things on the live site:**
   - `/admin` loads and accepts the password.
   - Upload a blueprint with **Add a blueprint**.
   - Create a **Lean teammate** link for yourself and open it.
   - Tick a checklist item, reload, and confirm it's still ticked.
   - Keep the page open for 10 seconds, then refresh `/admin`: the visit appears under "Recent visits".

## Add a blueprint for a new client

Anyone on the team with the admin password can do this. No GitHub or Vercel access needed.

1. **Prepare the file.** One self-contained HTML page, with images embedded, under 4 MB.
   - It needs a `<title>`, which names the blueprint in the admin page and in Slack alerts.
   - Add `data-check="<key>"` to each checklist item you want saved, for example `<li data-check="otp-1">`. Keys must be unique within the blueprint and use lowercase letters, digits and hyphens.
2. **Upload it.** In `/admin`, click **Add a blueprint**, choose the file, and give it a short name such as `acme-remit`. Only your team sees the short name. The page tells you exactly what to fix if the file is rejected.
3. **Share it.** Create a link for each client contact, plus a **Lean teammate** link for your own previews. Teammate visits are labelled separately and never trigger client alerts.

**To update a blueprint**, open it in `/admin` and use **Replace file**. Existing links show the new version straight away, and ticks are kept for every checklist key that's still in the file. If you remove or rename a ticked item's key, the admin page lists the ticks that no longer show; restore the key to bring them back.

## How visits are counted

- A visit counts once the page has been **visible for 10 seconds**, so email link scanners and quick previews don't inflate it.
- Each page load is one visit. Time on page counts only while the tab is visible, capped at 4 hours per visit.
- **Visits are attributed to the link, not the person.** If a client forwards their link, the colleague's visits show under the same label. Give each contact their own link.
- No IP addresses are stored. Each visit records the browser, operating system and country (from Vercel's location header).
- Slack alerts go out for client links only, at most once every 12 hours per link.

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
- **Generating blueprints from a template.** Today each blueprint is a finished HTML file. A shared template, with a Claude skill that drafts a client's blueprint from their meeting notes, is the planned next step.
