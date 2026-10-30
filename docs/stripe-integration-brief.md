# Stripe integration brief (Open Growth)

Written for the sub-agent that builds the Stripe integration. Read this fully before touching anything.

## 1. The business and the goal

Open Growth is a Calgary web design and local SEO studio run by Austin (owner, only staff member for now).
Customers are small local businesses. The goal of this work: **let customers pay Open Growth online, safely,
from inside the account area we already built**, and let Austin request payments from the admin screen.

Published prices (from the live v2 page, CAD):
- **Launch**: custom website, **$3,900 one-time**. Optional care plan **$200/month**.
- **Grow** (recommended): **$1,200/month + $1,500 one-time setup**. Care plan included.
- **Scale**: **$2,500/month + the customer's own Google Ads spend** (ad spend is paid to Google, not to us).

Austin quotes by hand today (quote requests land in the admin screen). So the first useful flow is
**pay what was quoted**, not a self-serve cart.

## 2. What already exists (do not rebuild it)

Repo: `C:\Users\asus\OneDrive\Documents\best priciples.md\websites` (public GitHub repo `A-jcodes/open-growth-websites`,
static HTML/CSS/JS, no build step). **Vercel auto-deploys every push to `main` to production.**
Backend: one Supabase project, ref `kascnahwustrexmopjtd` (`https://kascnahwustrexmopjtd.supabase.co`).

Folders:
- `v1-claude-editorial/`, `v2-agent-dark-3d/` (the main design), `v3-framer/`, `sitesmith/`: four design directions.
- `v2-agent-dark-3d/start-modal.js|css`: five-step sign-up pop-up that creates a Supabase Auth account.
- `account/` (`index.html`, `account.js`, `account.css`): customer dashboard. Shows work steps and updates from the team,
  a two-way message thread, website scan results (SEO / speed / local), and a quote request form.
- `admin/` (`index.html`, `admin.js`, `admin.css`): staff screen at `/admin/`: customers, messages, work steps,
  updates, scans, quotes, leads.
- `shared/supabase-config.js` (public URL + publishable key), `shared/lead-capture.js`.
- `supabase/` : SQL and Edge Function sources: `leads.sql`, `ADMIN-SETUP.md`, `functions/sync-beehiiv`,
  `functions/analyze-site`, `functions/notify-team`.

Supabase tables (all have row level security; read the policies before adding yours):
`leads`, `profiles` (id = auth user id; email, full_name, business_name, website_url, revenue_range, biggest_problem),
`site_scans`, `quote_requests` (services[], budget, timeline, notes, status), `work_items`, `activity_feed`,
`messages`, `admins` (staff list; `public.is_admin()` is the check used by every staff policy).

Edge Functions already deployed: `sync-beehiiv` (adds leads to beehiiv), `analyze-site` (website scan),
`notify-team` (emails Austin through Resend on new message / quote / sign-up).
Patterns to copy: a DB trigger calls an Edge Function with `net.http_post` (pg_net) and the public anon JWT;
the function re-reads the row with the service role and "claims" it (`team_notified_at`) so repeats are harmless;
functions use `verify_jwt: true`; customer-facing functions read the user from the Authorization header.

Auth: Supabase Auth, email + password. Customers sign up through the pop-up. Austin is in `public.admins`.
Email alerts to Austin go through Resend (`RESEND_API_KEY`, `NOTIFY_EMAIL` Supabase secrets are set).
beehiiv holds the marketing list (key not set yet, not your concern).

## 3. What to build (proposed scope; improve it if you find a better approach, and say why)

**Flow A, pay a quoted amount (build this first):**
1. Austin opens a customer in `/admin/` and creates a **payment request**: description, amount (CAD), type
   (`one_time` or `subscription` with monthly interval), optional setup fee.
2. The customer sees it on their dashboard with a **Pay now** button.
3. Pay now calls an Edge Function that creates a **Stripe Checkout Session** (hosted by Stripe; no card data ever
   touches our site) and returns the URL; the browser redirects there.
4. A **Stripe webhook** Edge Function (signature verified with the signing secret) marks the payment request
   paid, stores Stripe ids, adds an `activity_feed` entry for the customer ("Payment received, thank you"),
   and alerts Austin (reuse the `notify-team` pattern).
5. Subscriptions: store the Stripe customer and subscription ids; show status on the dashboard; offer the
   **Stripe Customer Portal** so the customer can update their card or cancel. Handle at least
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated|deleted`.

**Flow B, later, not now:** self-serve plan buttons on the pricing section. Only sketch it in the plan.

Design notes: customer UI uses the v2 dark style (reuse classes in `account/account.css` and
`v2-agent-dark-3d/styles.css`: `.glass`, `.pill`, `.btn btn-primary`, `.card-label`, etc.). Currency is **CAD**.
Canadian sales tax (GST 5% in Alberta) may apply; do not guess, make tax handling a clearly marked decision for Austin
and use Stripe Tax settings or a configurable flag.

## 4. Hard rules (non-negotiable)

1. **Stripe TEST mode only.** Never use live keys, never create real charges, never move real money.
2. **Never ask the user to paste a key into chat, never print a key, never write a key into any file or commit.**
   Secrets live only in Supabase Edge Function Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; optionally
   `STRIPE_PORTAL_CONFIG`). Austin enters them himself in the dashboard. Hosted Checkout means no publishable key
   is needed in the browser.
3. **Do not push to `main` and do not deploy to production.** Work on branch **`stripe-integration`** (already created
   and checked out). Commit to that branch only. Do not run `git push` at all, and do not touch the Vercel project.
4. **Do not apply migrations to or deploy functions to the live Supabase project.** It is the production database.
   Write migrations as files under `supabase/migrations-stripe/` and functions under `supabase/functions/<name>/`,
   and report. The main assistant will review and apply them with Austin's approval. If you genuinely need to verify
   SQL, you may use `execute_sql` for read-only queries (`select`, `explain`) only.
5. Every new table needs **row level security** and least-privilege grants (`revoke all` from `anon, authenticated`,
   then grant exactly what is needed, column-level where possible). Customers must only ever see their own rows.
   Writes that change payment state must come from Edge Functions using the service role, never from the browser.
   Confirm the amount, currency and customer server-side from the database, never trust the browser.
6. Verify Stripe webhook signatures. Make handlers **idempotent** (Stripe retries). Never log card or key data.
7. Do not ask the user questions you can resolve from the code or Stripe's docs. Make reasonable defaults and list
   them in the report. If something truly needs Austin (account setup, a choice), put it in an "Open decisions" list.

## 5. Practical notes

- Windows machine. Use `node` for scripting (there is **no Python**). Files use CRLF in places; the Edit tool works
  but multi-line `old_string` can fail on CRLF files, so prefer small unique single-line anchors or a node script.
- Use the **Stripe docs** (docs.stripe.com) through the available web search / scrape tools for current API versions
  and Checkout / webhook / Customer Portal details. Pin API versions and package versions you use
  (Edge Functions run Deno: `npm:stripe@<version>`). Use the Deno-compatible webhook verification
  (`constructEventAsync` with the raw body).
- Local testing: you can serve the repo with a tiny static node server and drive pages in the browser tools.
  Do not create real Supabase accounts through the sign-up form. If you need test users, do not create any in the
  production project; test logic with unit-style scripts and by reading code instead.
  (If a runtime test of the database layer is essential, say so in the report instead of doing it.)
- Style: match the surrounding code (comment density, naming, idiom). Keep functions small and commented where
  the security reasoning is not obvious.

## 6. Deliverables (write these in the repo, on the branch)

1. `docs/stripe-integration-plan.md`: architecture, data model, flows, security model, what Austin must do in
   Stripe (create account, products, webhook endpoint URL, which events), tax decision, test plan with Stripe
   test cards, rollout steps, and rollback.
2. `supabase/migrations-stripe/*.sql`: tables + RLS + grants (e.g. `payment_requests`, `stripe_customers`,
   `payment_events` for idempotency). Additive only; never alter existing tables destructively.
3. Edge Function sources: `create-checkout-session`, `stripe-webhook`, `create-portal-session` (and anything else
   needed), each with a header comment that states required secrets.
4. Front end: admin "Request payment" form on the customer page in `admin/`, and "Payments" panel + Pay now /
   Manage billing buttons in `account/`. Keep them hidden or inert until the backend exists (feature flag
   or graceful "payments not available yet" state) so a merge cannot break the live dashboard.
5. A final **report** (your last message): what you built, what you verified and how, what you could NOT verify,
   the "Open decisions" list, the exact steps Austin must do, and the exact order the main assistant should apply
   migrations and deploy functions. Be honest about gaps.
6. Commit your work to `stripe-integration` in small logical commits.
   Commit message trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
