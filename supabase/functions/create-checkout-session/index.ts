import Stripe from 'npm:stripe@23.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildSessionParams, buildPremiumParams } from './params.ts';

// Starts a Stripe-hosted Checkout for one payment request that staff created for the signed-in customer.
// The browser sends only the request id. The amount, currency, description and owner are read from the database here,
// so nothing the browser says can change what is charged. Card details are entered on Stripe's page, never on our site.
// Body { "plan": "premium" } starts the $30 CAD/month Premium subscription instead; the price is fixed in params.ts, never read from the browser.
// Deploy with verify_jwt = true (the default). Needs these Supabase secrets: STRIPE_SECRET_KEY (a test key, sk_test_... or rk_test_...).
// Optional: SITE_URL, STRIPE_AUTOMATIC_TAX=true (after setting up Stripe Tax), STRIPE_TAX_BEHAVIOR=exclusive|inclusive.
// STRIPE_ALLOW_LIVE=true is the single switch that would ever permit a live key; leave it unset.

const API_VERSION = '2026-10-28.endive';
const SITE = (Deno.env.get('SITE_URL') ?? 'https://open-growth-websites.vercel.app').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!apiKey) return json({ error: 'payments_not_configured' }, 503);
  if (!/^(sk|rk)_test_/.test(apiKey) && Deno.env.get('STRIPE_ALLOW_LIVE') !== 'true') return json({ error: 'payments_not_configured' }, 503);

  // Who is asking: the Supabase user behind the Authorization header
  const url0 = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url0, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'Please sign in again.' }, 401);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { return json({ error: 'bad request' }, 400); }
  const db = createClient(url0, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (body.plan !== undefined) {
    if (body.plan !== 'premium') return json({ error: 'bad request' }, 400);
    return premiumCheckout(db, user, apiKey);
  }

  const requestId = String(body.payment_request_id ?? '');
  if (!UUID.test(requestId)) return json({ error: 'bad request' }, 400);

  // Ownership is checked here against the signed-in user, in addition to the database policies
  const { data: pr } = await db.from('payment_requests')
    .select('id,user_id,description,kind,amount_cents,setup_fee_cents,currency,status,stripe_checkout_session_id')
    .eq('id', requestId).eq('user_id', user.id).maybeSingle();
  if (!pr) return json({ error: 'We could not find that payment.' }, 404);
  if (pr.status !== 'pending') return json({ error: 'This payment is already settled or was withdrawn.' }, 409);

  const stripe = new Stripe(apiKey, { apiVersion: API_VERSION as never, httpClient: Stripe.createFetchHttpClient() });
  try {
    // A second click, or a reload, reuses the checkout that is still open instead of making another one
    const old = pr.stripe_checkout_session_id ? await stripe.checkout.sessions.retrieve(pr.stripe_checkout_session_id).catch(() => null) : null;
    if (old) {
      if (old.status === 'complete') return json({ error: 'Your payment is being confirmed. Please check again in a minute.' }, 409);
      if (old.status === 'open' && old.url && old.expires_at > Math.floor(Date.now() / 1000) + 300) return json({ url: old.url });
    }

    const customerId = await ensureStripeCustomer(db, stripe, user.id, user.email ?? null);
    const params = buildSessionParams(pr, {
      customerId,
      site: SITE,
      automaticTax: Deno.env.get('STRIPE_AUTOMATIC_TAX') === 'true',
      taxBehavior: Deno.env.get('STRIPE_TAX_BEHAVIOR') === 'inclusive' ? 'inclusive' : 'exclusive',
    });
    // The idempotency key makes a double-click within ten minutes return the same session
    const session = await stripe.checkout.sessions.create(params as never, { idempotencyKey: `checkout-${pr.id}-${Math.floor(Date.now() / 600_000)}` });
    if (!session.url) throw new Error('no checkout url');
    await db.from('payment_requests').update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', pr.id).eq('status', 'pending');
    return json({ url: session.url });
  } catch (err) {
    // Log the error kind only: never the request, the key or card data
    console.error('create-checkout-session failed', err instanceof Error ? err.name : 'error', (err as { code?: string })?.code ?? '');
    return json({ error: 'We could not start the payment. Please try again in a moment.' }, 502);
  }
});

// One Stripe customer per user. The unique constraints make a race harmless: the loser re-reads the winner's row.
async function ensureStripeCustomer(db: ReturnType<typeof createClient>, stripe: Stripe, userId: string, email: string | null) {
  const existing = await db.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (existing.data?.stripe_customer_id) return existing.data.stripe_customer_id as string;

  const { data: p } = await db.from('profiles').select('full_name,business_name,email').eq('id', userId).maybeSingle();
  const customer = await stripe.customers.create(
    { email: email ?? p?.email ?? undefined, name: p?.business_name || p?.full_name || undefined, metadata: { user_id: userId } },
    { idempotencyKey: `customer-${userId}` },
  );
  await db.from('stripe_customers').upsert({ user_id: userId, stripe_customer_id: customer.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  const again = await db.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).single();
  return again.data!.stripe_customer_id as string;
}

// Premium: a subscription Checkout for the signed-in customer. Already Premium (or a live Premium subscription at Stripe)
// means no second subscription: we send them to the billing portal instead.
async function premiumCheckout(db: ReturnType<typeof createClient>, user: { id: string; email?: string | null }, apiKey: string) {
  const stripe = new Stripe(apiKey, { apiVersion: API_VERSION as never, httpClient: Stripe.createFetchHttpClient() });
  try {
    const { data: prof } = await db.from('profiles').select('plan').eq('id', user.id).maybeSingle();
    const customerId = await ensureStripeCustomer(db, stripe, user.id, user.email ?? null);

    // The webhook may not have run yet, so also ask Stripe whether a Premium subscription is already live
    let already = prof?.plan === 'premium';
    if (!already) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
      already = subs.data.some((s) => s.metadata?.plan === 'premium' && ['active', 'trialing', 'past_due', 'incomplete'].includes(s.status));
    }
    if (already) {
      const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${SITE}/account/`, ...(Deno.env.get('STRIPE_PORTAL_CONFIG') ? { configuration: Deno.env.get('STRIPE_PORTAL_CONFIG') } : {}) });
      return json({ url: portal.url, already_premium: true, message: 'You already have Premium. Manage your plan on the billing page.' });
    }

    const params = buildPremiumParams(user.id, {
      customerId, site: SITE,
      automaticTax: Deno.env.get('STRIPE_AUTOMATIC_TAX') === 'true',
      taxBehavior: Deno.env.get('STRIPE_TAX_BEHAVIOR') === 'inclusive' ? 'inclusive' : 'exclusive',
    });
    const session = await stripe.checkout.sessions.create(params as never, { idempotencyKey: `premium-${user.id}-${Math.floor(Date.now() / 600_000)}` });
    if (!session.url) throw new Error('no checkout url');
    return json({ url: session.url });
  } catch (err) {
    console.error('premium checkout failed', err instanceof Error ? err.name : 'error', (err as { code?: string })?.code ?? '');
    return json({ error: 'We could not start the upgrade. Please try again in a moment.' }, 502);
  }
}
