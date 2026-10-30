// Unit tests for the webhook logic with an in-memory database and a fake Stripe. Run: node handlers.test.mjs
import { processEvent, handleEvent, invoiceSubscriptionId, periodEnd, mapSubscriptionStatus, expectedSubtotal } from '../functions/stripe-webhook/handlers.ts';
import assert from 'node:assert/strict';

const U = '11111111-1111-4111-8111-111111111111';
const R1 = '22222222-2222-4222-8222-222222222222', R2 = '33333333-3333-4333-8333-333333333333';

function world() {
  const w = {
    reqs: {
      [R1]: { id: R1, user_id: U, description: 'Launch website', kind: 'one_time', amount_cents: 390000, setup_fee_cents: 0, currency: 'cad', status: 'pending', stripe_checkout_session_id: null, stripe_payment_intent_id: null, stripe_subscription_id: null },
      [R2]: { id: R2, user_id: U, description: 'Grow plan', kind: 'subscription', amount_cents: 120000, setup_fee_cents: 150000, currency: 'cad', status: 'pending', stripe_checkout_session_id: null, stripe_payment_intent_id: null, stripe_subscription_id: null },
    },
    events: {}, activity: [], alerts: [], subs: {}, customer: 'cus_1',
  };
  w.repo = {
    getRequest: async (id) => w.reqs[id] ? { ...w.reqs[id] } : null,
    getRequestBySubscription: async (s) => { const r = Object.values(w.reqs).find((x) => x.stripe_subscription_id === s); return r ? { ...r } : null; },
    getStripeCustomerId: async () => w.customer,
    updateRequest: async (id, patch) => { Object.assign(w.reqs[id], patch); },
    addActivity: async (u, t, b) => { w.activity.push(t); },
    claimEvent: async (id, type) => { const e = w.events[id]; if (!e) { w.events[id] = { type }; return 'new'; } return e.done ? 'done' : 'retry'; },
    finishEvent: async (id, outcome) => { w.events[id].done = true; w.events[id].outcome = outcome; },
  };
  w.deps = { repo: w.repo, allowLive: false, alert: async (s) => { w.alerts.push(s); }, stripe: { subscriptions: { retrieve: async (id) => { if (!w.subs[id]) throw new Error('no sub'); return w.subs[id]; } } } };
  return w;
}
const ev = (id, type, object, extra = {}) => ({ id, type, livemode: false, data: { object }, ...extra });
const paidSession = (rid, over = {}) => ({ id: 'cs_1', client_reference_id: rid, mode: 'payment', currency: 'cad', amount_subtotal: 390000, amount_total: 409500, payment_status: 'paid', customer: 'cus_1', payment_intent: 'pi_1', subscription: null, ...over });

// one-time payment: paid once; repeat delivery of the same event does nothing; a re-sent session is "already processed"
{
  const w = world();
  assert.equal(await processEvent(ev('evt_1', 'checkout.session.completed', paidSession(R1)), w.deps), 'paid');
  assert.equal(w.reqs[R1].status, 'paid'); assert.equal(w.reqs[R1].stripe_payment_intent_id, 'pi_1');
  assert.deepEqual(w.activity, ['Payment received, thank you']); assert.equal(w.alerts.length, 1);
  assert.equal(await processEvent(ev('evt_1', 'checkout.session.completed', paidSession(R1)), w.deps), 'duplicate_event');
  assert.equal(await processEvent(ev('evt_2', 'checkout.session.async_payment_succeeded', paidSession(R1)), w.deps), 'already_processed');
  assert.equal(w.activity.length, 1, 'no second activity entry'); assert.equal(w.alerts.length, 1, 'no second alert');
  // a second, different payment for the same request is flagged, not recorded
  assert.equal(await processEvent(ev('evt_3', 'checkout.session.completed', paidSession(R1, { id: 'cs_2', payment_intent: 'pi_2' })), w.deps), 'duplicate_payment');
  assert.equal(w.reqs[R1].stripe_payment_intent_id, 'pi_1'); assert.match(w.alerts.at(-1), /Duplicate/);
}
// tampered / mismatching sessions are never marked paid
{
  const w = world();
  for (const [i, over] of [{ amount_subtotal: 100 }, { currency: 'usd' }, { customer: 'cus_other' }, { mode: 'subscription' }, { customer: null }].entries()) {
    assert.equal(await processEvent(ev('evt_m' + i, 'checkout.session.completed', paidSession(R1, over)), w.deps), 'mismatch');
  }
  assert.equal(w.reqs[R1].status, 'pending'); assert.equal(w.activity.length, 0);
}
// unknown / foreign sessions and unpaid async sessions
{
  const w = world();
  assert.equal(await processEvent(ev('evt_a', 'checkout.session.completed', paidSession('not-a-uuid')), w.deps), 'ignored_not_ours');
  assert.equal(await processEvent(ev('evt_b', 'checkout.session.completed', paidSession('44444444-4444-4444-8444-444444444444')), w.deps), 'unknown_request');
  assert.equal(await processEvent(ev('evt_c', 'checkout.session.completed', paidSession(R1, { payment_status: 'unpaid' })), w.deps), 'awaiting_payment');
  assert.equal(w.reqs[R1].status, 'pending');
  assert.equal(await processEvent(ev('evt_d', 'checkout.session.async_payment_failed', paidSession(R1)), w.deps), 'async_payment_failed');
  assert.equal(w.reqs[R1].status, 'pending');
}
// live events are refused unless explicitly allowed
{
  const w = world();
  const live = ev('evt_l', 'checkout.session.completed', paidSession(R1), { livemode: true });
  assert.equal(await processEvent(live, w.deps), 'ignored_live_event'); assert.equal(w.reqs[R1].status, 'pending');
}
// a failed attempt leaves the event unfinished so Stripe's retry runs it again
{
  const w = world(); const real = w.repo.updateRequest; let boom = true;
  w.repo.updateRequest = async (...a) => { if (boom) { boom = false; throw new Error('db down'); } return real(...a); };
  await assert.rejects(processEvent(ev('evt_r', 'checkout.session.completed', paidSession(R1)), w.deps));
  assert.equal(w.events['evt_r'].done, undefined);
  assert.equal(await processEvent(ev('evt_r', 'checkout.session.completed', paidSession(R1)), w.deps), 'paid');
}
// subscription lifecycle, including events arriving out of order (new-API shapes)
{
  const w = world();
  const sub = (status, extra = {}) => ({ id: 'sub_1', status, metadata: { payment_request_id: R2 }, items: { data: [{ current_period_end: 1893456000 }] }, ...extra });
  const inv = (type, reason) => ev('evt_i' + Math.random(), type, { id: 'in_1', billing_reason: reason, parent: { subscription_details: { subscription: 'sub_1' } } });
  const session = { id: 'cs_s', client_reference_id: R2, mode: 'subscription', currency: 'cad', amount_subtotal: 270000, payment_status: 'paid', customer: 'cus_1', payment_intent: null, subscription: 'sub_1' };
  // events before checkout completes are skipped
  w.subs.sub_1 = sub('active');
  assert.equal(await processEvent(inv('invoice.paid', 'subscription_create'), w.deps), 'ignored_not_linked');
  assert.equal(await processEvent(ev('evt_s0', 'customer.subscription.updated', { id: 'sub_1' }), w.deps), 'ignored_not_linked');
  assert.equal(w.reqs[R2].status, 'pending');
  assert.equal(await processEvent(ev('evt_s1', 'checkout.session.completed', session), w.deps), 'paid');
  assert.equal(w.reqs[R2].status, 'active'); assert.equal(w.reqs[R2].stripe_subscription_id, 'sub_1'); assert.equal(w.reqs[R2].current_period_end, '2030-01-01T00:00:00.000Z');
  assert.equal(await processEvent(ev('evt_s1b', 'checkout.session.completed', session), w.deps), 'already_processed');
  // renewal
  assert.equal(await processEvent(inv('invoice.paid', 'subscription_cycle'), w.deps), 'subscription_active');
  assert.equal(w.activity.at(-1), 'Monthly payment received');
  // payment fails
  w.subs.sub_1 = sub('past_due');
  assert.equal(await processEvent(inv('invoice.payment_failed', 'subscription_cycle'), w.deps), 'subscription_past_due');
  assert.equal(w.reqs[R2].status, 'past_due'); assert.equal(w.activity.at(-1), 'Payment problem');
  const n = w.activity.length;
  assert.equal(await processEvent(ev('evt_s2', 'customer.subscription.updated', { id: 'sub_1' }), w.deps), 'subscription_past_due');
  assert.equal(w.activity.length, n, 'no repeat notice when nothing changed');
  // card updated, recovers; a stale "past_due" event delivered afterwards cannot move it back, because Stripe is re-read
  w.subs.sub_1 = sub('active');
  await processEvent(inv('invoice.paid', 'subscription_cycle'), w.deps);
  assert.equal(w.reqs[R2].status, 'active'); assert.equal(w.activity.at(-1), 'Payment received, thank you');
  await processEvent(inv('invoice.payment_failed', 'subscription_cycle'), w.deps);
  assert.equal(w.reqs[R2].status, 'active');
  // customer cancels at period end, then the subscription ends
  w.subs.sub_1 = sub('active', { cancel_at_period_end: true });
  await processEvent(ev('evt_s3', 'customer.subscription.updated', { id: 'sub_1' }), w.deps);
  assert.equal(w.reqs[R2].cancel_at_period_end, true);
  w.subs.sub_1 = sub('canceled');
  await processEvent(ev('evt_s4', 'customer.subscription.deleted', { id: 'sub_1' }), w.deps);
  assert.equal(w.reqs[R2].status, 'canceled'); assert.equal(w.activity.at(-1), 'Subscription ended');
  // a subscription whose metadata points at another request is ignored
  w.subs.sub_1 = sub('active', { metadata: { payment_request_id: R1 } });
  assert.equal(await processEvent(ev('evt_s5', 'customer.subscription.updated', { id: 'sub_1' }), w.deps), 'ignored_metadata_mismatch');
}
// helpers and unknown events
assert.equal(invoiceSubscriptionId({ subscription: 'sub_a' }), 'sub_a');
assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_b' } } } }), 'sub_b');
assert.equal(invoiceSubscriptionId({}), null);
assert.equal(periodEnd({ current_period_end: 1893456000 }), '2030-01-01T00:00:00.000Z');
assert.equal(mapSubscriptionStatus('incomplete'), null); assert.equal(mapSubscriptionStatus('trialing'), 'active'); assert.equal(mapSubscriptionStatus('unpaid'), 'past_due');
assert.equal(expectedSubtotal({ kind: 'subscription', amount_cents: 1, setup_fee_cents: 2 }), 3);
assert.equal((await handleEvent(ev('evt_z', 'charge.refunded', {}), world().deps)).outcome, 'ignored');
console.log('webhook handler tests passed');
