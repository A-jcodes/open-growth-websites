// Checks the Stripe SDK calls used by the Edge Functions, using the Deno/worker build of the pinned SDK version.
// Uses a made-up signing secret and a fake key shape; nothing is sent to Stripe.
import Stripe from 'stripe';
import assert from 'node:assert/strict';

const fakeKey = ['sk', 'test', 'x'.repeat(24)].join('_');
const stripe = new Stripe(fakeKey, { apiVersion: '2026-10-28.endive', httpClient: Stripe.createFetchHttpClient() });
const secret = 'whsec_' + 'a'.repeat(32);
const payload = JSON.stringify({ id: 'evt_test_1', object: 'event', type: 'invoice.paid', livemode: false, data: { object: { id: 'in_1' } } });
const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
const provider = Stripe.createSubtleCryptoProvider();

const ev = await stripe.webhooks.constructEventAsync(payload, header, secret, undefined, provider);
assert.equal(ev.id, 'evt_test_1');
await assert.rejects(stripe.webhooks.constructEventAsync(payload + ' ', header, secret, undefined, provider), 'tampered body must fail');
await assert.rejects(stripe.webhooks.constructEventAsync(payload, header, 'whsec_' + 'b'.repeat(32), undefined, provider), 'wrong secret must fail');
const old = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 3600 });
await assert.rejects(stripe.webhooks.constructEventAsync(payload, old, secret, undefined, provider), 'old timestamp must fail (replay)');
assert.equal(typeof stripe.billingPortal.sessions.create, 'function');
assert.equal(typeof stripe.checkout.sessions.create, 'function');
assert.equal(typeof stripe.checkout.sessions.retrieve, 'function');
assert.equal(typeof stripe.customers.create, 'function');
assert.equal(typeof stripe.subscriptions.retrieve, 'function');
console.log('signature verification and SDK surface checks passed');
