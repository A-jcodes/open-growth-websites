import Stripe from 'npm:stripe@23.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Opens the Stripe Customer Portal so a customer can update their card, see invoices or cancel their plan.
// The browser sends nothing: the customer is the signed-in user, looked up in our database.
// Deploy with verify_jwt = true (the default). Needs the Supabase secret STRIPE_SECRET_KEY (a test key, sk_test_... or rk_test_...).
// Optional: STRIPE_PORTAL_CONFIG (a bpc_... id; otherwise the default portal configuration saved in the Stripe dashboard is used), SITE_URL.
// Before this works, save the portal settings once in Stripe (Settings, Billing, Customer portal) while in test mode.

const API_VERSION = '2026-10-28.endive';
const SITE = (Deno.env.get('SITE_URL') ?? 'https://open-growth-websites.vercel.app').replace(/\/+$/, '');
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

  const url0 = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url0, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'Please sign in again.' }, 401);

  // Only a customer who has paid (or started a plan) has a Stripe customer, and only their own id is ever used
  const db = createClient(url0, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: row } = await db.from('stripe_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  if (!row) return json({ error: 'There is no billing to manage yet.' }, 404);

  const stripe = new Stripe(apiKey, { apiVersion: API_VERSION as never, httpClient: Stripe.createFetchHttpClient() });
  try {
    const configuration = Deno.env.get('STRIPE_PORTAL_CONFIG');
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${SITE}/account/`,
      ...(configuration ? { configuration } : {}),
    });
    return json({ url: session.url });
  } catch (err) {
    console.error('create-portal-session failed', err instanceof Error ? err.name : 'error', (err as { code?: string })?.code ?? '');
    return json({ error: 'We could not open billing right now. Please try again in a moment.' }, 502);
  }
});
