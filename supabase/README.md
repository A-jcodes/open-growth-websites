# Supabase backend

Database, sign-in and server code for the Open Growth site. Project reference: `kascnahwustrexmopjtd` (`https://kascnahwustrexmopjtd.supabase.co`). The URL and the public key are in `../shared/supabase-config.js` and are safe to publish. **Never put a secret or service key in this repository.**

## Database migrations (apply in this order)

| # | Applied as | File | Adds |
|---|---|---|---|
| 1 | `create_leads_table` | [`leads.sql`](leads.sql) | `leads` table, insert-only for the public key |
| 2 | `sync_leads_to_beehiiv` | [`migrations/20261029051933_sync_leads_to_beehiiv.sql`](migrations/20261029051933_sync_leads_to_beehiiv.sql) | Trigger that calls `sync-beehiiv` |
| 3 | `move_pg_net_to_extensions_schema` | [`migrations/20261029051945_move_pg_net_to_extensions_schema.sql`](migrations/20261029051945_move_pg_net_to_extensions_schema.sql) | Moves the `pg_net` extension out of `public` |
| 4 | `accounts_scans_quotes` | [`migrations/20261029060223_accounts_scans_quotes.sql`](migrations/20261029060223_accounts_scans_quotes.sql) | `profiles`, `site_scans`, `quote_requests`, profile-on-sign-up trigger |
| 5 | `dashboard_updates_and_messages` | [`migrations/20261029062807_dashboard_updates_and_messages.sql`](migrations/20261029062807_dashboard_updates_and_messages.sql) | `activity_feed`, `work_items`, `messages`, realtime, welcome rows |
| 6 | `admin_access_and_alerts` | [`migrations/20261029063707_admin_access_and_alerts.sql`](migrations/20261029063707_admin_access_and_alerts.sql) | `admins`, `is_admin()`, staff policies, alert triggers |
| 7 | `stripe_payments_tables` | [`migrations-stripe/001_payments_tables.sql`](migrations-stripe/001_payments_tables.sql) | `stripe_customers`, `payment_requests`, `payment_events` |
| 8 | `stripe_payments_policies` | [`migrations-stripe/002_payments_policies.sql`](migrations-stripe/002_payments_policies.sql) | Row level security and grants for payments |
| 9 | `stripe_payment_request_activity` | [`migrations-stripe/003_payment_request_activity.sql`](migrations-stripe/003_payment_request_activity.sql) | Tells the customer when a payment is requested |
| 10 | `premium_plan_columns` | [`migrations-stripe/004_premium_plan.sql`](migrations-stripe/004_premium_plan.sql) | `plan`, `plan_status`, `plan_renews_at`, `plan_cancel_at_period_end` on `profiles` |

All ten are applied to the live project. To rebuild on a new project, run them in this order in the SQL Editor. In files 2 and 6, replace `YOUR-PROJECT-REF` and `YOUR_ANON_KEY` first. Rollbacks for the payments work: `migrations-stripe/rollback-payments.sql` and `rollback-premium.sql` (manual use only).

Check the Supabase security advisor after applying. Expected notices: `admins` and `stripe_customers` have RLS but no policies (intended: nobody reaches them through the website), `is_admin()` is callable by signed-in users (intended), and leaked-password protection is off (it may need a paid plan).

## Edge Functions

Source is in `functions/<name>/`. Deploy each from the Supabase dashboard or the Supabase CLI, including **every file in the function's folder**.

| Function | Login required (`verify_jwt`) | Purpose |
|---|---|---|
| `analyze-site` | yes | Scans a customer's website and saves the result |
| `create-checkout-session` | yes | Starts a Stripe checkout for a payment request or for Premium |
| `create-portal-session` | yes | Opens Stripe's billing page |
| `stripe-webhook` | **no** (Stripe's signature is the check) | Records payments and plan changes |
| `notify-team` | yes (called by a database trigger) | Emails the team |
| `sync-beehiiv` | yes (called by a database trigger) | Adds a lead to beehiiv |

## Secrets

Set these in the Supabase dashboard under **Edge Functions, Secrets**. The dashboard supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically.

| Secret | Used by | Status |
|---|---|---|
| `STRIPE_SECRET_KEY` | checkout, portal, webhook | Set (restricted **test** key) |
| `STRIPE_WEBHOOK_SECRET` | webhook | Set (sandbox endpoint) |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` | notify-team, webhook alerts | Set |
| `BEEHIIV_API_KEY` | sync-beehiiv | **Not set yet** |
| `PSI_API_KEY` (Google PageSpeed) | analyze-site | **Not set yet** |
| `SITE_URL` | checkout, portal, alerts | Optional (defaults to the live site) |
| `NOTIFY_FROM`, `BEEHIIV_PUBLICATION_ID` | alerts, sync | Optional |
| `STRIPE_AUTOMATIC_TAX`, `STRIPE_TAX_BEHAVIOR`, `STRIPE_PORTAL_CONFIG` | checkout, portal | Optional |
| `STRIPE_ALLOW_LIVE` | all Stripe functions | **Leave unset** until you intend to take real payments |

The Stripe key needs only: Checkout Sessions (write), Customers (write), Customer portal (write), Subscriptions (read).

## Stripe webhook

In Stripe's Workbench, Webhooks, create an event destination: your account, **Snapshot** payloads, destination type Webhook endpoint, URL `https://kascnahwustrexmopjtd.supabase.co/functions/v1/stripe-webhook`, and these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Test and live modes each have their own endpoint and signing secret.

## Auth settings (dashboard)

- **Authentication, URL Configuration:** Site URL `https://open-growth-websites.vercel.app`; redirect URLs for `/account/` (the Vercel preview addresses are already allowed).
- **Confirm email:** on means new customers click an emailed link first; off sends them straight to the dashboard. Supabase's built-in email sends only a few messages an hour, so add a real email service before launch.

## Tests

`tests-stripe/` has automated tests that run without Supabase or Stripe: security rules and grants (against an in-memory Postgres), Stripe signature checks, webhook logic and the Premium plan rules including the simultaneous-events case.

```bash
cd supabase/tests-stripe
npm install
npm test
```

See also [`ADMIN-SETUP.md`](ADMIN-SETUP.md) for making someone staff.
