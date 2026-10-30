/* Switch for online payments (Stripe). Keep `enabled: true` until the payments migrations are applied
   and the Stripe functions are deployed (see docs/stripe-integration-plan.md, rollout steps).
   While false, the account and admin pages behave exactly as before and make no payment requests.
   Safe to commit: it holds no keys. */
window.OG_PAYMENTS = { enabled: true };
