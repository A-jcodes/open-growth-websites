// Premium plan tests: checkout params, scan limits, and webhook plan transitions with an in-memory database and a fake Stripe.
import { processEvent } from '../functions/stripe-webhook/handlers.ts';
import { mapPlan } from '../functions/stripe-webhook/plan.ts';
import { buildPremiumParams, PREMIUM_PLAN } from '../functions/create-checkout-session/params.ts';
import { scanLimitFor } from '../functions/analyze-site/limits.ts';
import assert from 'node:assert/strict';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

// ---- checkout params: the price is fixed on the server ----
{
  const p = buildPremiumParams(U, { customerId: 'cus_1', site: 'https://example.test', automaticTax: false, taxBehavior: 'exclusive' });
  assert.equal(p.mode, 'subscription'); assert.equal(p.customer, 'cus_1'); assert.equal(p.client_reference_id, U);
  assert.deepEqual(p.metadata, { plan: 'premium', user_id: U });
  assert.deepEqual(p.subscription_data.metadata, { plan: 'premium', user_id: U });
  assert.equal(p.line_items.length, 1);
  const pd = p.line_items[0].price_data;
  assert.equal(pd.unit_amount, 3000); assert.equal(pd.currency, 'cad'); assert.deepEqual(pd.recurring, { interval: 'month' });
  assert.equal(pd.tax_behavior, undefined); assert.equal(p.automatic_tax, undefined);
  assert.equal(p.success_url, 'https://example.test/account/?plan=success'); assert.equal(p.cancel_url, 'https://example.test/account/?plan=cancelled');
  assert.equal(p.line_items[0].price, undefined, 'no Stripe price id is required');
  assert.deepEqual({ a: PREMIUM_PLAN.amountCents, c: PREMIUM_PLAN.currency, i: PREMIUM_PLAN.interval }, { a: 3000, c: 'cad', i: 'month' });
  const t = buildPremiumParams(U, { customerId: 'cus_1', site: 'https://example.test', automaticTax: true, taxBehavior: 'inclusive' });
  assert.equal(t.line_items[0].price_data.tax_behavior, 'inclusive'); assert.deepEqual(t.automatic_tax, { enabled: true });
}
// ---- scan limits come from the plan ----
assert.equal(scanLimitFor('premium'), 30); assert.equal(scanLimitFor('standard'), 10);
assert.equal(scanLimitFor(undefined), 10); assert.equal(scanLimitFor(null), 10); assert.equal(scanLimitFor('PREMIUM'), 10);
// ---- status mapping ----
assert.deepEqual(mapPlan('active'), { plan: 'premium', plan_status: 'active' });
assert.deepEqual(mapPlan('trialing'), { plan: 'premium', plan_status: 'active' });
assert.deepEqual(mapPlan('past_due'), { plan: 'premium', plan_status: 'past_due' });
for (const s of ['canceled', 'unpaid', 'incomplete_expired']) assert.deepEqual(mapPlan(s), { plan: 'standard', plan_status: 'canceled' });
assert.equal(mapPlan('incomplete'), null); assert.equal(mapPlan('paused'), null);

// ---- webhook transitions ----
function world() {
  const w = { profile: { plan: 'standard', plan_status: null, plan_renews_at: null, plan_cancel_at_period_end: false }, events: {}, activity: [], alerts: [], subs: {}, customer: 'cus_1' };
  w.repo = {
    getRequest: async () => null, getRequestBySubscription: async () => null, updateRequest: async () => {},
    getStripeCustomerId: async () => w.customer,
    getProfilePlan: async (id) => (id === U ? { plan: w.profile.plan, plan_status: w.profile.plan_status } : null),
    setPlan: async (id, patch, expected) => {
      assert.equal(id, U);
      if (w.profile.plan !== expected.plan || (w.profile.plan_status ?? null) !== (expected.plan_status ?? null)) return false; // someone else changed it first
      Object.assign(w.profile, patch);
      return true;
    },
    addActivity: async (u, t) => { w.activity.push(t); },
    claimEvent: async (id, type) => { const e = w.events[id]; if (!e) { w.events[id] = { type }; return 'new'; } return e.done ? 'done' : 'retry'; },
    finishEvent: async (id, outcome) => { w.events[id].done = true; w.events[id].outcome = outcome; },
  };
  w.deps = { repo: w.repo, allowLive: false, alert: async (s) => { w.alerts.push(s); }, stripe: { subscriptions: { retrieve: async (id) => { if (!w.subs[id]) throw new Error('no sub'); return w.subs[id]; } } } };
  return w;
}
const ev = (id, type, object, extra = {}) => ({ id, type, livemode: false, data: { object }, ...extra });
const sub = (status, extra = {}) => ({ id: 'sub_p', status, customer: 'cus_1', metadata: { plan: 'premium', user_id: U }, items: { data: [{ current_period_end: 1893456000, price: { unit_amount: 3000, currency: 'cad' } }] }, ...extra });
const session = (over = {}) => ({ id: 'cs_p', mode: 'subscription', client_reference_id: U, metadata: { plan: 'premium', user_id: U }, currency: 'cad', amount_subtotal: 3000, payment_status: 'paid', customer: 'cus_1', subscription: 'sub_p', ...over });
const inv = (id, type) => ev(id, type, { id: 'in_1', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_p' } } });

// upgrade, repeat delivery, renewal, failure, recovery, cancel at period end, end
{
  const w = world(); w.subs.sub_p = sub('active');
  assert.equal(await processEvent(ev('evt_1', 'checkout.session.completed', session()), w.deps), 'premium_started');
  assert.equal(w.profile.plan, 'premium'); assert.equal(w.profile.plan_status, 'active'); assert.equal(w.profile.plan_renews_at, '2030-01-01T00:00:00.000Z');
  assert.deepEqual(w.activity, ['Welcome to Premium']); assert.deepEqual(w.alerts, ['Customer upgraded to Premium']);
  // idempotency: the same event id again does nothing; a different event for the same state adds no second welcome/alert
  assert.equal(await processEvent(ev('evt_1', 'checkout.session.completed', session()), w.deps), 'duplicate_event');
  assert.equal(await processEvent(ev('evt_2', 'customer.subscription.created', { id: 'sub_p' }), w.deps), 'premium_active');
  assert.equal(await processEvent(ev('evt_3', 'checkout.session.async_payment_succeeded', session()), w.deps), 'premium_active');
  assert.equal(w.activity.length, 1); assert.equal(w.alerts.length, 1);
  // payment fails: still Premium, flagged past_due, customer and Austin told once
  w.subs.sub_p = sub('past_due');
  assert.equal(await processEvent(inv('evt_4', 'invoice.payment_failed'), w.deps), 'premium_past_due');
  assert.equal(w.profile.plan, 'premium'); assert.equal(w.profile.plan_status, 'past_due'); assert.equal(w.activity.at(-1), 'Premium payment problem');
  assert.equal(await processEvent(ev('evt_5', 'customer.subscription.updated', { id: 'sub_p' }), w.deps), 'premium_active');
  assert.equal(w.activity.filter((t) => t === 'Premium payment problem').length, 1);
  // recovers
  w.subs.sub_p = sub('active');
  await processEvent(inv('evt_6', 'invoice.paid'), w.deps);
  assert.equal(w.profile.plan_status, 'active'); assert.equal(w.profile.plan, 'premium');
  // cancel at period end: still Premium, flag set
  w.subs.sub_p = sub('active', { cancel_at_period_end: true });
  await processEvent(ev('evt_7', 'customer.subscription.updated', { id: 'sub_p' }), w.deps);
  assert.equal(w.profile.plan, 'premium'); assert.equal(w.profile.plan_cancel_at_period_end, true);
  // subscription ends: back to standard, entry and alert; a stale "active" event cannot re-grant because Stripe is re-read
  w.subs.sub_p = sub('canceled');
  assert.equal(await processEvent(ev('evt_8', 'customer.subscription.deleted', { id: 'sub_p' }), w.deps), 'premium_ended');
  assert.equal(w.profile.plan, 'standard'); assert.equal(w.profile.plan_status, 'canceled'); assert.equal(w.profile.plan_cancel_at_period_end, false); assert.equal(w.profile.plan_renews_at, null);
  assert.equal(w.activity.at(-1), 'Premium plan ended'); assert.equal(w.alerts.at(-1), 'Customer left Premium');
  assert.equal(await processEvent(ev('evt_9', 'customer.subscription.updated', { id: 'sub_p' }), w.deps), 'standard_unchanged');
  assert.equal(w.profile.plan, 'standard');
}
// unpaid / incomplete_expired also downgrade; incomplete changes nothing
for (const [st, want] of [['unpaid', 'standard'], ['incomplete_expired', 'standard'], ['incomplete', 'standard']]) {
  const w = world(); w.profile.plan = 'premium'; w.profile.plan_status = 'active'; w.subs.sub_p = sub(st);
  await processEvent(ev('evt_x', 'customer.subscription.updated', { id: 'sub_p' }), w.deps);
  assert.equal(w.profile.plan, st === 'incomplete' ? 'premium' : want, st);
}
// tampered or foreign objects never grant Premium
{
  const w = world(); w.subs.sub_p = sub('active');
  for (const [i, over] of [{ amount_subtotal: 100 }, { currency: 'usd' }, { mode: 'payment' }, { client_reference_id: OTHER }].entries()) {
    const out = await processEvent(ev('evt_t' + i, 'checkout.session.completed', session(over)), w.deps);
    assert.ok(['mismatch', 'ignored_not_ours'].includes(out), out);
  }
  assert.equal(w.profile.plan, 'standard');
  // subscription priced wrong
  w.subs.sub_p = sub('active', { items: { data: [{ current_period_end: 1893456000, price: { unit_amount: 100, currency: 'cad' } }] } });
  assert.equal(await processEvent(ev('evt_t5', 'customer.subscription.updated', { id: 'sub_p' }), w.deps), 'mismatch');
  // wrong Stripe customer
  w.subs.sub_p = sub('active', { customer: 'cus_evil' });
  assert.equal(await processEvent(ev('evt_t6', 'customer.subscription.updated', { id: 'sub_p' }), w.deps), 'mismatch');
  // not marked premium: ignored (payment-request subscriptions use the old path)
  w.subs.sub_p = sub('active', { metadata: { payment_request_id: 'x' } });
  assert.equal(w.profile.plan, 'standard');
  // live-mode event refused
  w.subs.sub_p = sub('active');
  assert.equal(await processEvent(ev('evt_t7', 'customer.subscription.updated', { id: 'sub_p' }, { livemode: true }), w.deps), 'ignored_live_event');
  assert.equal(w.profile.plan, 'standard');
}
// a failure mid-way leaves the event unfinished so Stripe retries it, then it succeeds exactly once
{
  const w = world(); w.subs.sub_p = sub('active'); const real = w.repo.setPlan; let boom = true;
  w.repo.setPlan = async (...a) => { if (boom) { boom = false; throw new Error('db down'); } return real(...a); };
  await assert.rejects(processEvent(ev('evt_r', 'checkout.session.completed', session()), w.deps));
  assert.equal(w.events.evt_r.done, undefined);
  assert.equal(await processEvent(ev('evt_r', 'checkout.session.completed', session()), w.deps), 'premium_started');
  assert.equal(w.activity.length, 1);
}
console.log('premium plan tests passed');

// ---- three events for the same upgrade arriving at the same instant must announce it exactly once ----
{
  const w = world(); w.subs.sub_p = sub('active');
  // Real database calls take time. Return the value read BEFORE a short pause, so all three events see "standard"
  // before any of them has written, which is exactly what happened in production.
  const realGet = w.repo.getProfilePlan;
  w.repo.getProfilePlan = async (id) => { const v = await realGet(id); await new Promise((r) => setTimeout(r, 15)); return v; };
  const outcomes = await Promise.all([
    processEvent(ev('evt_r1', 'checkout.session.completed', session()), w.deps),
    processEvent(ev('evt_r2', 'customer.subscription.created', { id: 'sub_p' }), w.deps),
    processEvent(ev('evt_r3', 'invoice.paid', { id: 'in_1', billing_reason: 'subscription_create', parent: { subscription_details: { subscription: 'sub_p' } } }), w.deps),
  ]);
  assert.equal(w.profile.plan, 'premium'); assert.equal(w.profile.plan_status, 'active');
  assert.equal(outcomes.filter((o) => o === 'premium_started').length, 1, 'only one event announces the upgrade: ' + outcomes.join(','));
  assert.equal(w.activity.filter((t) => t === 'Welcome to Premium').length, 1, 'one welcome message');
  assert.equal(w.alerts.filter((a) => a === 'Customer upgraded to Premium').length, 1, 'one team alert');
}
console.log('simultaneous events announce once');
