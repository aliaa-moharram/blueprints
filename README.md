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
   - `SLACK_WEBHOOK_URL`: optional, but recommended. A Slack incoming-webhook URL for alerts when a client first opens a blueprint, and when a client team requests production access.
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

1. Enter the client name and a short name such as `acme-remit`, then pick a starting point:
   - **Standard template for a vertical:** journeys and a three-phase launch plan, with that vertical's pain points and use cases from the Verticals page.
   - **A copy of another form-built blueprint:** its content, without the other client's logo and screenshots.
   - **Meeting notes, drafted by Claude:** paste notes and get a first draft, with open questions listed for you. Only appears once `ANTHROPIC_API_KEY` is set. The notes are sent to Anthropic's API.
   - **Blank.**
2. Review and edit, in either tab:
   - **Form:** the sections. In the **Launch plan**, pick a phase for each product in scope; product cards, table rows, endpoints, guides and effort fill in from the library. Rarely used fields sit under **More options**.
   - **Edit on page:** the page as the client will see it. Click any text to change it; images, products and layout stay in the form.
3. **Save draft** as you go, **Preview** to check, then **Publish** and create links. Clients keep seeing the last published version until you publish again.

Use `**double asterisks**` for bold text. Screenshots are resized automatically.

## Verticals

The **Verticals** page holds each vertical's pain points, introduction and use cases. Blueprints started from the standard template copy them in, so keeping verticals up to date improves every new blueprint. Blueprints already made keep their own copy. Use `{client}` where the client's name should go.

Remittance comes filled in from the Wise blueprint. Trading & Gaming, Lending and Emerging Industries start empty, for the team to fill in.

## Drafting from meeting notes (optional)

Set `ANTHROPIC_API_KEY` in Vercel to switch it on, and optionally `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`; check Anthropic's models page for current names). Claude is told to use only facts in the notes and leave anything else empty. Every draft opens with a review note and its open questions. Check with security before sending client meeting notes to the API.

### Upload a finished HTML file

1. **Prepare the file.** One self-contained HTML page, with images embedded, under 4 MB. It needs a `<title>`. Add `data-check="<key>"` to each checklist item you want saved, with unique keys using lowercase letters, digits and hyphens.
2. **Upload it** with a short name. The page tells you what to fix if the file is rejected.
3. **To update it**, use **Replace file**. Ticks are kept for every checklist key still in the file.

## The admin sidebar

Blueprints are listed by client name, in two groups: **Published** and **Not published yet**. Form-built blueprints take the client name from Basics. Uploaded files take it from the page title ("Wise UAE Integration Blueprint - Prepared by Lean" becomes "Wise"), or from the name you type when uploading. Use **Rename** on an uploaded blueprint to change it. The client's browser tab keeps the page's full title.

## Team links and checklists

- **One client team per blueprint.** Create one **Client team** link, used by everyone on the client team, plus any **Lean team** links for your own previews. To change the client team, revoke its link first.
- **Each client team has its own checklist.** Ticks made through one team's link never show on another team's link, and a new team starts with an empty checklist.
- **Open** on a link's row opens the page in a new tab. For a client team, it opens their page with their real ticks, read only, and isn't counted as a visit; that view expires after 2 hours, so open it again from the admin page when it does. For a Lean team link, it opens the link as it is.
- **Lean team links are read only.** They show each client team's ticks, with a switcher when there are several client teams, and can't change them. Lean visits are labelled separately and never trigger client alerts.
- **Revoking a team's link** keeps its checklist and visit history. Restore the link to bring them back. Revoked links are hidden from the Links table unless you tick **Show revoked links**.
- **Deleting a link** permanently removes it with its visits and checklist ticks. An active link stops working straight away, so use **Revoke** instead if you might want it back.
- **Deleting a blueprint** (at the bottom of its page) permanently removes it with all its links, visits and checklist ticks. You type its short name to confirm.

## Progress in the admin page

Each published blueprint's page in `/admin` has a **Progress** section. For the chosen client team, it shows overall progress, each phase with its bar and count, and each guide within the phase. Expand a guide to see every item and when it was ticked. The phases and guides are read from the page when it's uploaded or published.

## Phase progress

Each card under **Delivery phases** shows how many guide checklist items in that phase are done, for the team whose page it is. Form-built blueprints set this up automatically from the products in each phase. In an uploaded file, add `data-panels` to a phase card with the ids of its guide panels, for example `<div class="phase" data-panels="otp rec">`. Phases without guide checklists show no progress.

## API reference links

Endpoints in the plan table and in the implementation guides link to their page in Lean's v4 API reference (marked ↗). Blueprints that include One-Time Payments, Recurring Payments, CMI or Name match also get **Phase 0 · Setup** at the top of the table, with three rows, each with its own guide and checklist:

- **Developer portal setup:** account and application, the sandbox app token (shared with Lean), Open Finance enablement, client secret, redirect URLs (the host is enough), purpose and benefit statements, a Settlement Account, and the webhook endpoint and events (in collapsible groups, under **Other** in the dev portal). Production steps follow, not counted.
- **Authentication:** the Sandbox addresses, the access token, the Bearer header, then the first API call: creating the Settlement Account with `POST /payments/v1/destinations` (no `customer_id`). Its `id` is the `settlement_account_id`. Idempotency and treating Lean as the source of payment state are listed under Keep in mind.
- **Webhooks:** the seven core steps (signing secret, endpoint, `lean-signature`, fast acknowledgement, `event_id`, ordering, Sandbox tests). Reference material sits in collapsed sections, and edge cases (IP allowlisting, failed deliveries, rotating secrets, unknown events) are linked to the exact doc sections rather than listed as steps.

Phase 1 ends with an **End-to-end test** row and guide, counted in Phase 1's progress. It runs the whole integration against the Sandbox in six groups (environment, a one-time payment, a recurring payment, webhooks, failure cases, the go-live checklist), followed by the go-live steps (not counted). Following the checklists in order (Phase 0, then One-Time and Recurring Payments, then the end-to-end test) gives a working, tested integration. It follows Lean's "Testing your integration" guide.

**Progress and environment.** The Phase 0 header shows "Sandbox setup: x of y", then "✓ Sandbox setup complete" once every sandbox step in Phase 0 is ticked, and every row with a guide shows its own count. Lean sets each client team's environment in the links table (Environment: Sandbox or Production). The page shows it next to Market and Vertical. Once a team is in Production, a "Production setup" count appears and the production steps are marked as applying now. Production steps are never counted in phase progress.

**Guides** put things to keep in mind (not to-dos) in a Keep in mind list above the checklist. Each guide has a progress bar in its header, and Next and Previous buttons at the end, in the plan table's order. Guides can be resized: drag the handle on the left edge, use the arrow keys on it, or click **Expand**. The width is remembered in that browser. Every diagram can open full screen. A Phase 0 · Setup card in Delivery phases shows setup progress, and every row with a guide shows its own progress bar.

**Checkboxes and progress bars** appear in every view. On a client link, ticks save for the client team. In the admin Preview and Edit on page, they work but aren't saved. A copy of the page opened outside the site saves ticks in that browser only.

The One-Time and Recurring Payments guides follow Lean's v4 guides step by step, and One-Time Payments opens with the payment lifecycle. Key terms (Charge, Agreement, Settlement Account, Customer, app token, Idempotency-Key, webhook, signing secret) show a short definition on hover or focus: write `[[key|word]]` in guide text, with definitions in `TERMS` in `lib/products.js`.

Checklist keys containing `-prod-` are left out of every progress figure: guide counts, phase progress, the admin Progress section and the sidebar. The links live in `ENDPOINT_LINKS` and the row in `PREREQUISITES`, both in `lib/products.js`; update them when the API reference changes, then republish.

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


**Requesting production access.** "Your path to production", a four-step tracker, is shown on the main page (above Delivery phases) and in the Developer portal setup and End-to-end test guides:

1. Sandbox setup.
2. End-to-end test.
3. Production access.
4. Production setup, locked until access is granted.

Only someone on the client team (an email on the link's client domains) can send a request. It opens a form with three parts:

1. **Demo recording:** a screen recording of the integration working end to end in Sandbox, uploaded straight from the browser to Vercel Blob, with progress. It can be up to 100 MB, in common video formats. Or the client ticks **Not applicable for this integration** and says why.
2. **Production Settlement Account:** account holder name, trade licence number, IBAN (check digits verified), account number and bank address.
3. **An optional note.**

The server checks everything again before saving.

When a request is sent:
- **The blueprint's owner is emailed.** Set **Notify by email** on the blueprint in the admin page, or `NOTIFY_EMAIL` as the default. The email has who sent it, their progress, the recording link or the N/A reason, and the bank details **masked**. Reply goes to the client.
- **Slack** gets a short message if `SLACK_WEBHOOK_URL` is set. It never includes bank details.
- **The admin page** shows the full request on the team's row, with copy buttons.
- **The client's page** shows only a masked summary.

To grant access, set the team's Environment to **Production**.

**Setup for requests:**
- **Video storage:** in Vercel, open **Storage**, choose **Create Database**, then **Blob**, and connect it to this project. That adds `BLOB_READ_WRITE_TOKEN`. Recordings are stored with unguessable addresses. Without it, the form explains that uploads aren't set up and the client can tick Not applicable.
- **Email:**
  1. Create a free account at resend.com and an API key.
  2. Add `RESEND_API_KEY` and `NOTIFY_EMAIL` (your address) in Vercel, then redeploy.

  Until you verify a sending domain in Resend, it only delivers to the email address of the Resend account, so use that address as `NOTIFY_EMAIL`. Optionally, set `EMAIL_FROM`, for example `Lean blueprints <blueprints@yourdomain>`, once a domain is verified.


**Vercel's Hobby plan allows 12 serverless functions per deployment.** Every file in `api/` is one function, so the admin endpoints share one: `api/admin.js` routes each `/api/admin/<name>` request (rewritten in `vercel.json`) to its handler in `lib/admin/`. The site uses 5 functions. Add new admin endpoints to `lib/admin/` and the router, not as new files in `api/`.


**Who's viewing a client link.** The first time someone opens a client team's link in a browser, the page asks for their work email. It's required: there's no skip.

| Email | View | Counted as the client team? |
|---|---|---|
| A Lean domain (`@leantech.me`, or the domains in `LEAN_EMAIL_DOMAINS`) | Read-only Lean view | Never |
| One of the link's **client email domains** | Normal: can tick and request production access | Yes |
| Anything else | Read-only | Never |

- **Client email domains** are set per client link in the admin page, for example `wise.com, transferwise.com`. Lean domains are refused. Until they're set, nobody can tick, so nothing is ever misattributed.
- **The server applies these rules** to every visit, tick and production request, whatever the page sends.
- **Each tick records who made it,** so the Progress section shows "Oct 23 · David Vu".
- **Visits without a valid email** are stored as unknown and never counted.
- **A "Viewing as … · Not you?" note** lets someone switch.

The email isn't verified, so it prevents mistakes, not deliberate impersonation: someone could still type a fake address on a client domain. Existing links keep working, and visits from before this change stay under the team's name.


## Staying within Vercel's free (Hobby) plan

**Use:** the Hobby plan is for personal, non-commercial projects. A site for Lean's client integrations is commercial use, so for production it belongs on a Lean team account (Pro).

**Usage:** the site is built to fit Hobby's limits:

| Limit on Hobby | How the site stays within it |
|---|---|
| 12 serverless functions per deployment | 6 functions: the admin endpoints share one router (`api/admin.js`). |
| 300 s maximum function duration | The longest is 120 s (drafting from notes). |
| 4.5 MB request body | Recordings upload straight from the browser to Blob, never through a function. |
| Blob: 1 GB storage in total (Blob is switched off for 30 days if exceeded) | Recordings are capped at 100 MB each, and the total at a budget, `BLOB_BUDGET_MB`, default 900 MB. The server reserves each file's size before issuing an upload token, the token only allows that size, and uploads that would go over are refused with a clear message. Replaced and leftover recordings are deleted automatically. Delete reviewed recordings from the admin page, which shows storage used. |
| Blob: 2,000 upload operations a month | One operation per recording: no multipart uploads, and no listing of the store. |
| Blob: 10 GB downloads a month | Only Lean watches recordings, from the admin page or the email link. |
| Resend free plan: 3,000 emails a month, 100 a day | One email per production request. |


## Downloading, version history, and editing uploaded blueprints in the form

**Download.** Every published blueprint has **Download HTML** and **Download PDF** in the admin page.
- **HTML** is the exact published file.
- **PDF** opens a print-ready version in a new tab, then the browser's print dialog: choose **Save as PDF**. It keeps the desktop layout, scaled to A4, and adds every implementation guide at the end. The browser makes the PDF, so it costs nothing on the server and stays within Vercel's free plan.
- **Links:** downloads use signed links that expire after 10 minutes.

**Version history.** Each blueprint keeps its previous version before every Replace file, publish, restore and switch to the form, up to the latest 20. Open **Version history** on the blueprint to download any version as HTML or PDF, or **Restore** it. Restoring keeps the current version too, so you can switch back. Clients' ticks stay as they are.

**Edit in form.** Uploaded blueprints made from the Lean template, like Wise, can be switched to the form, so anyone can edit them without code.
1. **Read and check.** **Edit in form** reads the published page into the form, then checks the result: it renders the form version and compares it with the published page, section by section (text and images).
2. **Review.** The dialog shows each section as matched or not, with what differs, and anything worth checking, such as a logo converted from an inline graphic.
3. **Switch,** or keep it as an uploaded file. Switching doesn't change the published page until someone publishes from the form, and the uploaded HTML is kept in Version history. Links, ticks, visits and production requests are unaffected.

Pages not made from the Lean template can't be read into the form. Download them, edit the file, then use Replace file.
