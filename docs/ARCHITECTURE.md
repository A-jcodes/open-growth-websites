# Architecture

How the Open Growth site fits together. For setup steps see [`../supabase/README.md`](../supabase/README.md); for the history see [`CHANGELOG.md`](CHANGELOG.md).

## Overview

```
Browser (static pages on Vercel)
  |  public Supabase key only
  v
Supabase
  |-- Auth ............ sign-up, log-in, password reset (email + password)
  |-- Postgres ........ tables with row level security (RLS)
  |-- Edge Functions .. server code that holds secrets and talks to other services
  |        analyze-site ........ scans a customer's website
  |        create-checkout-session / create-portal-session ... start Stripe pages
  |        stripe-webhook ...... receives Stripe's payment notices
  |        notify-team ......... emails the team (Resend)
  |        sync-beehiiv ........ adds leads to the mailing list (beehiiv)
  `-- Realtime ........ pushes new messages and updates to the dashboard

Stripe (checkout pages, billing portal, subscriptions)   Resend (alert emails)   beehiiv (mailing list)
```

The site has **no build step and no server of its own**. Everything that needs a secret or trust runs in an Edge Function.

## Pages

| Path | What it is |
|---|---|
| `/`, `/v1-claude-editorial/`, `/v2-agent-dark-3d/`, `/v3-framer/`, `/sitesmith/` | Home page and the four marketing designs. v2 is the main one. |
| `/checklist/` | The free Calgary Calls Checklist (tick-as-you-go, printable). |
| `/account/` | Customer dashboard: sign-up and log-in, plan card, work steps, updates, messages, website scanner, quotes. |
| `/admin/` | Staff screen. Locked by the database, not by the page. |

Shared code lives in `shared/`. The libraries, icons and fonts the account, admin and v2 pages use are copies hosted on our own site (`shared/vendor`, `shared/fonts`), so a page makes fewer outside connections. Licences are in `shared/vendor/README.txt`.

## Data model

| Table | Holds | Who can read | Who can write |
|---|---|---|---|
| `leads` | Form leads: name, email, revenue range, biggest problem, source, offer, email-list sync status | Staff | The public key can only **insert** |
| `profiles` | One per customer: name, business, website, stage, problem, **plan**, plan status, renewal date | Owner, staff | Owner can edit name, business and website only. **Plan fields: only the Stripe webhook.** |
| `site_scans` | Saved scan results | Owner, staff | Only the `analyze-site` function |
| `quote_requests` | Quote requests and their status | Owner, staff | Owner adds; staff change status |
| `work_items` | Steps Open Growth is doing for a customer | Owner, staff | Staff |
| `activity_feed` | Updates shown on the dashboard | Owner, staff | Staff and database triggers |
| `messages` | Two-way thread (`customer` or `team`) | Owner, staff | Owner as `customer`; staff as `team` |
| `admins` | The staff list | Nobody through the website | Project owner in the database |
| `payment_requests` | A payment staff ask a customer to make | Owner (limited columns), staff | Staff create and void; **paid state: only the webhook** |
| `stripe_customers` | Maps a customer to their Stripe customer | Nobody through the website | Edge Functions |
| `payment_events` | One row per Stripe event seen (makes retries harmless) | Staff | Webhook |

Row level security is on for every table. The public key gets only the specific columns and actions listed above; everything else is revoked.

## Main flows

**Lead form.** The form inserts a row into `leads` with the public key. A database trigger calls `sync-beehiiv`, which re-reads the lead by id and adds the email and first name to beehiiv, then marks `crm_synced_at` (or records `crm_error`).

**Sign-up pop-up.** Five steps (name, email and password, business, stage, biggest problem). It saves a lead, calls Supabase `signUp`, and a database trigger creates the profile, a welcome update and three starting work steps. With email confirmation off the customer lands on the dashboard; with it on they get a "check your email" step. The dashboard scans their website on the first visit.

**Website scan.** `analyze-site` needs a signed-in user. It fetches the page (refusing private addresses, following at most four redirects, capping size and time), runs about 20 checks, adds Google PageSpeed results, scores them, and saves the scan. The per-hour limit depends on the plan read from the database.

**Messages and updates.** Customers and staff write to `messages`; staff post to `activity_feed` and `work_items`. The dashboard listens in realtime and also refreshes every 15 seconds as a backup.

**Alerts.** A trigger on new customer messages, quote requests and profiles calls `notify-team`, which claims the row once (`team_notified_at`) and sends one email through Resend.

**Payments.** Two paths share one webhook.
1. *Payment request:* staff create a request in the admin screen. The customer clicks Pay now. `create-checkout-session` reads the amount from the database row and returns a Stripe-hosted checkout URL.
2. *Premium:* the customer clicks Upgrade. The function builds a subscription for exactly $30.00 CAD per month (fixed in server code) and returns the checkout URL.

After payment, Stripe calls `stripe-webhook`. It verifies the signature on the raw body, records the event id once, re-reads the subscription from Stripe, checks amount, currency and customer against our own records, and only then updates the plan or marks the request paid. The plan write is a compare-and-set, so when Stripe sends several events for one upgrade at once, only one announces it. `create-portal-session` opens Stripe's billing page so a customer can update a card or cancel.

## Security model

- **Public key only in the browser.** It can do only what the RLS policies and column grants allow.
- **Server decides money.** Amounts, currency and plan come from our database or server code, never from the browser.
- **Plan and paid state are written only by the webhook** with the service role. A customer cannot upgrade themselves by editing a request.
- **Staff access** is the `admins` table plus `public.is_admin()`. Every staff policy requires it. Make someone staff only by a deliberate database change.
- **Webhook** runs without a Supabase login (Stripe cannot send one), so the Stripe signature is the check. Unsigned or forged requests get a 400.
- **Edge Functions that serve customers** require a signed-in user (`verify_jwt`). They look the user up from the token and never trust an id sent by the browser.
- **Stripe test mode only** unless `STRIPE_ALLOW_LIVE=true` is set on purpose. The restricted Stripe key has only Checkout Sessions (write), Customers (write), Customer portal (write) and Subscriptions (read).
- **Scanner safeguards:** blocks localhost, private and link-local addresses, caps response size and time, and limits scans per hour.
- **Secrets** are only in Supabase Edge Function Secrets. See `supabase/README.md`.
- **Known limits:** Supabase's leaked-password protection is off (it may need a paid plan); two security-advisor notices (`admins` and `stripe_customers` have no policies) are intentional because nobody should reach them through the website.

## Branches

`main` is production. `stripe-integration` and `premium-plan` were feature branches and are fully merged into `main`; they can be deleted. `seo-keywords` and `ux-best-practices` are older design branches already merged.
