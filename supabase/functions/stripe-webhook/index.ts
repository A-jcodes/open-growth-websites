import Stripe from 'npm:stripe@23.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { processEvent, type PaymentRequest, type Repo } from './handlers.ts';

// Receives Stripe webhook events and records payments. This is the ONLY place that marks a payment as paid.
// Deploy with verify_jwt = false: Stripe cannot send a Supabase JWT, so the Stripe signature is the check instead.
// Needs these Supabase secrets: STRIPE_SECRET_KEY (a test key, sk_test_... or rk_test_...) and STRIPE_WEBHOOK_SECRET (whsec_...).
// Optional: RESEND_API_KEY + NOTIFY_EMAIL (already set for notify-team) for "payment received" alerts to the team,
// NOTIFY_FROM, SITE_URL. STRIPE_ALLOW_LIVE=true is the single switch that would ever permit live mode; leave it unset.
// Events handled: checkout.session.completed / async_payment_succeeded / async_payment_failed, invoice.paid,
// invoice.payment_failed, customer.subscription.created / updated / deleted. Subscriptions with metadata.plan = 'premium'
// set profiles.plan (see plan.ts). Everything else is acknowledged and ignored.

const API_VERSION = '2026-10-28.endive'; // pinned: the SDK and the shapes read in handlers.ts were written against this
const allowLive = Deno.env.get('STRIPE_ALLOW_LIVE') === 'true';
const SITE = Deno.env.get('SITE_URL') ?? 'https://open-growth-websites.vercel.app';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function makeRepo(db: ReturnType<typeof createClient>): Repo {
  const COLS = 'id,user_id,description,kind,amount_cents,setup_fee_cents,currency,status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_subscription_id';
  return {
    async getRequest(id) {
      const { data, error } = await db.from('payment_requests').select(COLS).eq('id', id).maybeSingle();
      if (error) throw error;
      return data as PaymentRequest | null;
    },
    async getRequestBySubscription(subId) {
      const { data, error } = await db.from('payment_requests').select(COLS).eq('stripe_subscription_id', subId).maybeSingle();
      if (error) throw error;
      return data as PaymentRequest | null;
    },
    async getStripeCustomerId(userId) {
      const { data, error } = await db.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data?.stripe_customer_id ?? null;
    },
    async updateRequest(id, patch) {
      const { error } = await db.from('payment_requests').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    async addActivity(userId, title, body) {
      const { error } = await db.from('activity_feed').insert({ user_id: userId, title, body });
      if (error) throw error;
    },
    async getProfilePlan(userId) {
      const { data, error } = await db.from('profiles').select('plan,plan_status').eq('id', userId).maybeSingle();
      if (error) throw error;
      return data as { plan: 'standard' | 'premium'; plan_status: string | null } | null;
    },
    async setPlan(userId, patch) {
      const { error } = await db.from('profiles').update(patch).eq('id', userId);
      if (error) throw error;
    },
    async claimEvent(id, type) {
      const { data, error } = await db.from('payment_events').upsert({ id, type }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
      if (error) throw error;
      if (data && data.length) return 'new'; // inserted just now
      const { data: row, error: e2 } = await db.from('payment_events').select('processed_at').eq('id', id).maybeSingle();
      if (e2) throw e2;
      return row?.processed_at ? 'done' : 'retry';
    },
    async finishEvent(id, outcome, requestId) {
      const { error } = await db.from('payment_events').update({ outcome, payment_request_id: requestId, processed_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
  };
}

// Emails the team through Resend (same secrets as notify-team). Never throws: an alert problem must not fail the webhook.
async function alertTeam(subject: string, lines: string[]) {
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY'), to = Deno.env.get('NOTIFY_EMAIL');
    if (!apiKey || !to) return;
    const link = `${SITE}/admin/`;
    const text = lines.join('\n') + `\n\nOpen your admin screen: ${link}`;
    const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5"><h2 style="margin:0 0 12px">${esc(subject)}</h2>` +
      lines.map((l) => `<p style="margin:4px 0">${esc(l)}</p>`).join('') + `<p style="margin-top:18px"><a href="${esc(link)}">Open your admin screen</a></p></div>`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('NOTIFY_FROM') ?? 'Open Growth <onboarding@resend.dev>', to: [to], subject, text, html }),
    });
  } catch { /* ignore */ }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('STRIPE_SECRET_KEY');
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!apiKey || !whSecret) return json({ error: 'payments_not_configured' }, 503);
  // Test mode only, unless STRIPE_ALLOW_LIVE=true was set on purpose.
  if (!/^(sk|rk)_test_/.test(apiKey) && !allowLive) return json({ error: 'live_key_refused' }, 503);

  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ error: 'missing signature' }, 400);

  const stripe = new Stripe(apiKey, { apiVersion: API_VERSION as never, httpClient: Stripe.createFetchHttpClient() });
  // The signature covers the exact bytes Stripe sent, so read the raw body as text and never re-serialise it.
  const raw = await req.text();
  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, whSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return json({ error: 'invalid signature' }, 400);
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const outcome = await processEvent(event, { repo: makeRepo(db), stripe: stripe as never, alert: alertTeam, allowLive });
    return json({ received: true, outcome });
  } catch (err) {
    // 500 makes Stripe retry later; the event stays unfinished in payment_events. Log the type only, never the payload.
    console.error('stripe-webhook failed', event.type, event.id, err instanceof Error ? err.name : 'error');
    return json({ error: 'processing failed' }, 500);
  }
});
