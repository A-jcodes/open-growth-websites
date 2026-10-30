# Premium plan (Open Growth)

Branch `premium-plan`, built on the Stripe integration (`docs/stripe-integration-plan.md`). Nothing applied, deployed or pushed. Stripe test mode only.

## How it works

- Everyone is **Standard** (free). **Premium** is **$30 CAD per month**, self-serve.
- The customer clicks **Upgrade to Premium** in the "Your plan" card on `/account/`. The browser calls `create-checkout-session` with `{ "plan": "premium" }` (nothing else). The function builds a subscription Checkout Session with inline `price_data` (3000 cents, `cad`, monthly), customer = their Stripe customer, `client_reference_id` = user id, metadata `{plan:'premium', user_id}` on the session and the subscription. No Stripe product/price needs creating; the price lives only in `create-checkout-session/params.ts` (and is re-checked in `stripe-webhook/plan.ts`).
- If the customer is already Premium (profile says so, or Stripe already has a live Premium subscription), no second subscription is made: the function returns a Customer Portal URL with `already_premium: true`.
- The **webhook** is the only writer of the plan. For subscriptions with `metadata.plan = 'premium'` it re-reads the subscription from Stripe and sets `profiles.plan / plan_status / plan_renews_at / plan_cancel_at_period_end`:
  - `active`, `trialing` -> premium / `active`; `past_due` -> premium / `past_due` (dashboard warns)
  - `canceled`, `unpaid`, `incomplete_expired` -> standard / `canceled`; `incomplete`, `paused` -> unchanged
  - Safety checks: Stripe customer must match our `stripe_customers` row; the price must be exactly $30.00 CAD monthly; the checkout session must match too. A mismatch grants nothing and emails Austin.
  - Upgrade and downgrade each add an `activity_feed` entry for the customer and email Austin (existing Resend alert). Payment failure does the same.
  - Same idempotency as before (`payment_events` keyed by Stripe event id). Payment-request subscriptions keep their old path unchanged.
- The customer manages or cancels in the Stripe Customer Portal (**Manage billing**). Cancelling sets `plan_cancel_at_period_end`; Premium ends when Stripe reports the subscription canceled.

### What Premium delivers (all enforced)
1. **Priority replies**: `/admin/` shows a gold-violet Premium badge in the customer list and header (red ring if payment failed); among customers with unread messages, Premium sorts first.
2. **Scan limit**: `analyze-site` reads `profiles.plan` with the service role: 30 scans/hour Premium, 10 Standard (also 10 if the lookup fails or the column is missing). Nothing from the browser is trusted.
3. **Scan history**: the dashboard shows the latest 3 saved scans on Standard, all saved (max 20) on Premium. This is a display limit only; scans are still saved.

## Data (`supabase/migrations-stripe/004_premium_plan.sql`)
Adds to `public.profiles`: `plan` text not null default `'standard'` (check standard|premium), `plan_status` text, `plan_renews_at` timestamptz, `plan_cancel_at_period_end` boolean not null default false, plus a partial index. Additive and re-runnable.

Write protection (checked against the live project read-only): `authenticated` has table SELECT and column UPDATE only on `business_name, full_name, website_url`; policies are own-row read, own-row update, staff read. So customers cannot write the plan columns or read other customers' plan, staff can read all. The migration also explicitly revokes insert/update on the four columns from `anon, authenticated`. Only `service_role` (the webhook) writes them. `rls.test.mjs` replays these live grants and proves it.

Rollback: `supabase/migrations-stripe/rollback-premium.sql` (drops the columns; Stripe keeps billing records).

## What changed
- `supabase/migrations-stripe/004_premium_plan.sql`, `rollback-premium.sql`
- `functions/stripe-webhook/plan.ts` (new), `handlers.ts` (routes premium subscriptions/sessions), `index.ts` (profile repo methods)
- `functions/create-checkout-session/params.ts` (`buildPremiumParams`), `index.ts` (`plan: 'premium'` branch; payment_request flow untouched)
- `functions/analyze-site/limits.ts` (new), `index.ts` (plan-based limit)
- `account/` plan card, comparison, status, upgrade/manage buttons, history limit; `admin/` badge and sort
- Tests in `supabase/tests-stripe/` (`plan.test.mjs` new; `rls.test.mjs` extended)

## Feature flag
`shared/payments-config.js` `enabled: false`: the plan card still shows the comparison, the button is disabled ("Premium coming soon"), and the dashboard makes no request to any payment function or table (no plan lookup either; everyone shows as Standard, 3 scans in history). With `enabled: true` the buttons work. The confirmation line "You will be taken to Stripe's secure page. $30 CAD per month. Cancel any time." appears next to the upgrade button. Note: `admin/` always tries to read the plan columns and silently falls back to the old column list if migration 004 is not applied yet.

## Test with Stripe test cards (test mode, after deploy)
1. Flag on (preview), sign in as a test customer, click Upgrade, pay with `4242 4242 4242 4242` (any future expiry/CVC/postcode). Within seconds the card turns Premium, a "Welcome to Premium" entry appears, Austin gets an email.
2. `4000 0025 0000 3155` (3D Secure) should also succeed; `4000 0000 0000 9995` should decline and leave Standard.
3. Click Upgrade again as Premium: you land in the portal, no second subscription.
4. `4000 0000 0000 0341` then advance a test clock: renewal fails, status becomes "Payment failed" but plan stays Premium.
5. Portal: cancel -> "cancels on <date>"; delete the subscription in Stripe -> back to Standard, "Premium plan ended" entry, email.
6. As a Premium customer run 11+ scans in an hour (allowed up to 30); as Standard the 11th is refused.
7. In `/admin/`, check badge and that a Premium customer's unread thread sorts above a Standard one.
Resend a webhook event from the Stripe dashboard: outcome `duplicate_event`.

## Rollout order
1. Merge the branch (flag still false: live behaviour unchanged).
2. Apply `004_premium_plan.sql` (001-003 must already be applied).
3. Deploy `stripe-webhook` (verify_jwt false), `create-checkout-session` (verify_jwt true), `analyze-site` (verify_jwt true as today). The webhook endpoint needs no new events (`customer.subscription.*`, `checkout.session.*`, `invoice.*` already subscribed). The Customer Portal must allow cancelling subscriptions.
4. Test with the card list above, then set `enabled: true` and deploy the site.

## Rollback
Set `enabled: false` and redeploy (UI back to "coming soon"; existing Premium customers keep working server-side). To drop the feature: redeploy the previous functions, then run `rollback-premium.sql`. `analyze-site` and the admin screen tolerate missing columns.

## Known limits / decisions
- Plan is not tied to a stored subscription id; a stale cancel event for an old Premium subscription could downgrade a newer one. The checkout path prevents a second live subscription, so this is unlikely.
- Premium history limit is display-only; Premium "up to 20" matches the existing dashboard query.
- Tax: same Stripe Tax switches as the payment flow (`STRIPE_AUTOMATIC_TAX`); default none.
- No free trial, no annual option, no proration logic (single price).
