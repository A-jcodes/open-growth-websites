// Checks that the Checkout parameters we build only use fields (and enum values) that exist in Stripe's OpenAPI spec
// for the pinned API version. Get the spec with: curl -L https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.sdk.json -o spec3.sdk.json
// (it must be the 2026-10-28.endive version; the test fails if the spec has moved on, which is a prompt to re-check)
// Run: npm run test:params  (before it: npm install; node 22.18+ is needed to run the .ts files directly)
// Also checks that amounts, mode and ids come from the payment request row. Spec path is argv[2].
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildSessionParams } from '../functions/create-checkout-session/params.ts';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(spec.info.version, '2026-10-28.endive');
const root = spec.paths['/v1/checkout/sessions'].post.requestBody.content['application/x-www-form-urlencoded'].schema;

const deref = (s) => { while (s && s.$ref) s = s.$ref.replace('#/', '').split('/').reduce((o, k) => o[k], spec); return s; };
function walk(val, schema, path) {
  schema = deref(schema);
  if (schema && schema.anyOf) { // pick the first object-ish alternative that knows the keys
    const alts = schema.anyOf.map(deref);
    const obj = alts.find((a) => a.properties) || alts[0];
    return walk(val, obj, path);
  }
  if (val === null || typeof val !== 'object') {
    if (schema && schema.enum && !schema['x-stripeBypassValidation']) assert.ok(schema.enum.includes(val), `${path}: ${val} not in enum ${schema.enum}`);
    return;
  }
  if (Array.isArray(val)) { val.forEach((v, i) => walk(v, schema.items, `${path}[${i}]`)); return; }
  if (!schema.properties) { return; } // free-form (metadata)
  for (const [k, v] of Object.entries(val)) {
    assert.ok(k in schema.properties, `${path}.${k} is not a field in the Stripe spec`);
    walk(v, schema.properties[k], `${path}.${k}`);
  }
}

const base = { id: '22222222-2222-4222-8222-222222222222', user_id: '11111111-1111-4111-8111-111111111111', description: 'Launch website', currency: 'cad' };
const opts = { customerId: 'cus_1', site: 'https://example.test', automaticTax: false, taxBehavior: 'exclusive' };
for (const automaticTax of [false, true]) {
  const one = buildSessionParams({ ...base, kind: 'one_time', amount_cents: 390000, setup_fee_cents: 0 }, { ...opts, automaticTax });
  const sub = buildSessionParams({ ...base, kind: 'subscription', amount_cents: 120000, setup_fee_cents: 150000 }, { ...opts, automaticTax });
  const subNoFee = buildSessionParams({ ...base, kind: 'subscription', amount_cents: 20000, setup_fee_cents: 0 }, { ...opts, automaticTax });
  for (const p of [one, sub, subNoFee]) walk(p, root, 'params');
  assert.equal(one.mode, 'payment'); assert.equal(one.line_items.length, 1); assert.equal(one.line_items[0].price_data.unit_amount, 390000);
  assert.equal(sub.mode, 'subscription'); assert.equal(sub.line_items.length, 2);
  assert.deepEqual(sub.line_items[0].price_data.recurring, { interval: 'month' }); assert.equal(sub.line_items[0].price_data.unit_amount, 120000);
  assert.equal(sub.line_items[1].price_data.recurring, undefined); assert.equal(sub.line_items[1].price_data.unit_amount, 150000);
  assert.equal(subNoFee.line_items.length, 1);
  assert.equal(JSON.stringify(sub).includes('tax_behavior'), automaticTax);
  assert.equal(sub.client_reference_id, base.id); assert.equal(sub.subscription_data.metadata.payment_request_id, base.id);
  assert.equal(one.payment_intent_data.metadata.payment_request_id, base.id);
}
console.log('checkout parameter checks passed against spec', spec.info.version);
