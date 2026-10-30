# Stripe integration plan (Open Growth)

Status: built on branch `stripe-integration`, **nothing applied, deployed or pushed**. Test mode only.

## 1. What it does

Austin creates a **payment request** for a customer in `/admin/` (description, CAD amount, one-time or monthly plan,
optional one-time setup fee). The customer sees it in a **Payments** card on `/account/` and clicks **Pay now**. That
opens a **Stripe-hosted Checkout** page (card details never touch our site). A **signed webhook** then marks the request
paid, tells the customer on their dashboard, and emails Austin. Monthly plans get a **Manage billing** button that opens
the Stripe Customer Portal (update card, invoices, cancel).

Not in scope now (Flow B): self-serve plan buttons on the pricing section. Sketch: a public "Choose Grow" button would
call a function that creates a payment request for the signed-in user from a fixed server-side price list and then runs
the same checkout path. It needs a decision on prices living in code vs Stripe Products.

## 2. Architecture

```
Browser (account/)  --JWT-->  create-checkout-session  --> Stripe Checkout (hosted) --> customer pays
Browser (account/)  --JWT-->  create-portal-session    --> Stripe Customer Portal
Stripe  --signed POST-->  stripe-webhook (no JWT, signature check)  --> Postgres (service role)
Browser (admin/)    --RLS-->  payment_requests (create / withdraw only)
```

- `supabase/functions/create-checkout-session` (verify_jwt true): input is only `payment_request_id`. It checks the
  row belongs to the signed-in user and is `pending`, then builds the session from the **database row**.
- `supabase/functions/create-portal-session` (verify_jwt true): no input; uses the caller's own `stripe_customers` row.
- `supabase/functions/stripe-webhook` (verify_jwt **false**): the Stripe signature is the authentication.
- Pure logic lives in `handlers.ts` / `params.ts` (no imports) so it is unit tested under plain Node.
- Pinned: `npm:stripe@23.1.0` (latest at time of writing), Stripe API version `2026-10-28.endive` (the version that SDK
  release is built for), `npm:@supabase/supabase-js@2` as the existing functions use.
- Front end switch: `shared/payments-config.js` (`enabled: false`). While false, neither page requests anything
  payment related, the admin Payments tab is hidden and the customer card stays hidden. Merging is safe.

## 3. Data model (`supabase/migrations-stripe/`)

| Table | Purpose | Browser access |
|---|---|---|
| `payment_requests` | What staff asked a customer to pay, amounts in whole cents, status, Stripe ids | Customer: select own rows, safe columns only. Staff: select all, insert (user, text, kind, amount, setup fee), update `status` pending -> void only |
| `stripe_customers` | user id <-> Stripe customer id | none (no grants) |
| `payment_events` | Every webhook event id once (idempotency + audit) | Staff select only |

Statuses: `pending`, `paid` (one-time), `active` / `past_due` / `canceled` (follow the Stripe subscription), `void`.
Currency is constrained to `cad`. Additive only; no existing table is altered. Migration 003 adds a trigger that posts a
"Payment requested" entry to the customer's `activity_feed` (never blocks the insert).

## 4. Security model

- **RLS everywhere**, `revoke all` from `anon, authenticated`, then column-level grants. Stripe ids and `created_by`
  are not readable from a browser (so the browser must list columns; `select('*')` is denied by design).
- **Money state is written only by the webhook** (service role). Staff can create and withdraw requests but cannot set
  `paid`, Stripe ids or amounts after creation.
- **Amount, currency, mode and customer come from the database**, never the browser. The browser sends only a request id.
- **Webhook**: raw body read with `req.text()`, verified with `constructEventAsync` (Deno-compatible SubtleCrypto
  provider). Bad or missing signature -> 400. On `checkout.session.completed` the session's subtotal, currency, mode and
  Stripe customer are compared with our stored request; any mismatch is NOT marked paid and Austin is alerted.
- **Idempotency**: `payment_events.id` is the Stripe event id; a finished event returns immediately; an unfinished one
  (error mid-way) is retried by Stripe. Subscription state is re-read from Stripe, so out-of-order events cannot move a
  request backwards. A second payment for an already-paid request raises a "refund may be needed" alert.
- **Checkout creation** is idempotent (10-minute key) and reuses a still-open session on a double click.
- **Test mode guard**: all three functions refuse a key that is not `sk_test_`/`rk_test_` unless `STRIPE_ALLOW_LIVE=true`
  is set deliberately. Live events are ignored the same way.
- **No secrets in code.** Secrets only in Supabase Edge Function secrets. Logs contain event type/id and error name only.
- **Front end**: all dynamic text goes through `esc()`; redirects only to `https://checkout.stripe.com/` or
  `https://billing.stripe.com/`; success/cancel URLs come from the `SITE_URL` secret, not the browser.
- Known limit: CORS on the two JWT functions is `*` (same as the existing functions); they need a valid user JWT anyway.

## 5. Flows

1. **Request**: admin Payments tab -> insert into `payment_requests` -> trigger posts a feed entry.
2. **Pay**: Pay now -> `create-checkout-session` -> Stripe Checkout -> `success_url=/account/?payment=success`.
3. **Confirm**: Stripe -> `stripe-webhook` -> `paid` + feed entry "Payment received, thank you" + email to Austin.
   The dashboard polls for up to 36 seconds after returning from Stripe, then says it is still confirming.
4. **Subscription**: first checkout sets `active`, period end, cancel-at-period-end from Stripe. `invoice.paid` /
   `invoice.payment_failed` / `customer.subscription.*` re-sync; failures show "Payment problem" and notify both sides.
5. **Manage billing**: `create-portal-session` -> Customer Portal; changes come back through subscription events.

## 6. Tax decision (Austin must choose; code supports both)

Alberta has no PST; **GST is 5%**. A small business with worldwide taxable revenue of **$30,000 CAD or less** over four
consecutive quarters is a "small supplier" and need not register or charge GST; above that, registration is mandatory.
Confirm with the CRA / an accountant; this is not advice.
- **Not registered yet (default)**: amounts are charged as entered, no tax added. Nothing to configure.
- **Registered for GST**: in Stripe enable **Stripe Tax**, add your GST number and Alberta origin address, then set the
  Supabase secrets `STRIPE_AUTOMATIC_TAX=true` and `STRIPE_TAX_BEHAVIOR=exclusive` (GST added on top of the amount; use
  `inclusive` if quoted prices already include GST). Checkout then collects a billing address. The webhook compares the
  pre-tax subtotal, so the check keeps working. Stripe Tax has its own fee.
Marked clearly in the admin form: "Tax is handled in Stripe settings."

## 7. What Austin must do in Stripe (test mode)

1. Create/sign in to a Stripe account (Canada) and make sure the dashboard shows **Test mode / a sandbox**.
2. Developers -> API keys: create a **restricted key** (or use the test secret key). Restricted key permissions:
   Customers write, Checkout Sessions write, Customer portal write, Subscriptions read, Invoices read, PaymentIntents read.
   Never paste it in chat; paste it only into Supabase.
3. Settings -> Billing -> **Customer portal**: save a configuration (allow update payment method, invoice history,
   cancel subscription). Required before Manage billing works. Optionally put its `bpc_...` id in `STRIPE_PORTAL_CONFIG`.
4. Developers -> **Webhooks** -> add endpoint `https://kascnahwustrexmopjtd.supabase.co/functions/v1/stripe-webhook`
   with events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy the **signing secret** (`whsec_...`).
5. Branding (Settings -> Branding): logo, colours, so Checkout looks like Open Growth. Turn on customer receipt emails.
6. Supabase -> Edge Functions -> Secrets: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and (recommended)
   `SITE_URL` to the production origin. Existing `RESEND_API_KEY` / `NOTIFY_EMAIL` are reused for alerts.
7. Going live later is a separate, deliberate step (section 10).

## 8. Test plan (test mode only)

Automated, no network, run from `supabase/tests-stripe`: `npm install && npm test`
(RLS and grants against an in-memory Postgres (PGlite), webhook signature and SDK surface, handler logic incl. mismatch,
duplicate event, duplicate payment, out-of-order subscription events). `npm run test:params` needs Stripe's OpenAPI
spec file `spec3.sdk.json` (not bundled) and checks Checkout parameter names against it.

Manual after deploy to a **staging** project (or production with the flag still off), with the Stripe test cards:
| Card | Expect |
|---|---|
| 4242 4242 4242 4242 | Success: request becomes Paid, feed entry, email to Austin |
| 4000 0025 0000 3155 | 3D Secure challenge, then success |
| 4000 0000 0000 9995 | Declined (insufficient funds): stays Awaiting payment |
| 4000 0000 0000 0341 | Subscription: first payment OK, later renewal fails (use test clock to advance) |
Use any future expiry, any CVC, any postal code. Also check: cancel at Checkout returns with "nothing was charged";
double-clicking Pay now opens one session; two browsers cannot see each other's requests; a non-admin cannot insert
a request (try from the console); resend a webhook event from the Stripe dashboard and confirm outcome `duplicate_event`;
send a request with a wrong signature (expect 400); cancel a plan in the portal and see "Cancelled" in both screens.
Stripe CLI (`stripe listen`, `stripe trigger`) can drive webhooks locally.

## 9. Rollout order

1. Merge the branch (flag still `enabled: false`; the live site behaves exactly as before).
2. Apply `001`, `002`, `003` in order (staging first if available). Check advisors for RLS warnings.
3. Do Stripe steps 1-5, set the Supabase secrets (step 6).
4. Deploy `stripe-webhook` with `verify_jwt=false`, then `create-checkout-session` and `create-portal-session` with `verify_jwt=true`.
5. Run the manual test plan in test mode (flag can be flipped on a preview deployment).
6. Set `enabled: true` in `shared/payments-config.js`, deploy.
7. Real money later: new live keys, new live webhook endpoint and secret, `STRIPE_ALLOW_LIVE=true`, repeat a small real test.

## 10. Rollback

- Fast, no data loss: set `enabled: false` and redeploy. UI disappears; pending requests stay in the database.
- Stop money flow: delete the Stripe webhook endpoint or unset `STRIPE_SECRET_KEY` (functions answer "payments not configured").
- Remove functions: delete the three Edge Functions.
- Remove data (destructive, loses history): run `supabase/migrations-stripe/rollback-payments.sql` by hand.
