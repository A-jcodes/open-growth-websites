import { createClient } from 'npm:@supabase/supabase-js@2';

// Emails the Open Growth team when a customer sends a message, requests a quote or signs up.
// The caller only sends a kind and a row id. The details are read from the database here, and each
// row is claimed once (team_notified_at), so a forged or repeated call cannot cause repeat emails.
// Needs these Supabase secrets: RESEND_API_KEY and NOTIFY_EMAIL. Optional: NOTIFY_FROM, SITE_URL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = Deno.env.get('SITE_URL') ?? 'https://open-growth-websites.vercel.app';
const TABLE: Record<string, string> = { message: 'messages', quote: 'quote_requests', signup: 'profiles' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let kind = '', id = '';
  try { const b = await req.json(); kind = String(b?.kind ?? ''); id = String(b?.id ?? ''); } catch { return json({ error: 'bad json' }, 400); }
  const table = TABLE[kind];
  if (!table || !UUID.test(id)) return json({ error: 'bad request' }, 400);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('NOTIFY_EMAIL');
  if (!apiKey || !to) return json({ status: 'alerts_not_configured' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Claim the row: only a fresh, not-yet-notified row can send an email
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: claimed } = await db.from(table).update({ team_notified_at: new Date().toISOString() })
    .eq('id', id).is('team_notified_at', null).gte('created_at', since).select('*').maybeSingle();
  if (!claimed) return json({ status: 'skipped' });

  const uid = kind === 'signup' ? claimed.id : claimed.user_id;
  const { data: p } = await db.from('profiles').select('full_name,business_name,email,website_url,revenue_range,biggest_problem').eq('id', uid).maybeSingle();
  const who = `${p?.full_name || 'A customer'}${p?.business_name ? ' (' + p.business_name + ')' : ''}`;

  let subject = '', lines: string[] = [];
  if (kind === 'message') {
    subject = `New message from ${who}`;
    lines = [`${who} wrote:`, '', String(claimed.body).slice(0, 1500)];
  } else if (kind === 'quote') {
    subject = `New quote request from ${who}`;
    lines = [`${who} asked for a quote.`, `Services: ${(claimed.services || []).join(', ') || 'not set'}`, `Budget: ${claimed.budget || 'not set'}`, `Timeline: ${claimed.timeline || 'not set'}`, claimed.notes ? `Notes: ${claimed.notes}` : ''];
  } else {
    subject = `New sign-up: ${who}`;
    lines = [`${who} just created an account.`, `Email: ${p?.email || ''}`, `Website: ${p?.website_url || 'none given'}`, `Stage: ${p?.revenue_range || 'not set'}`, `Biggest problem: ${p?.biggest_problem || 'not set'}`];
  }
  const link = `${SITE}/admin/`;
  const text = lines.filter((l) => l !== '').join('\n') + `\n\nOpen your admin screen: ${link}`;
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5"><h2 style="margin:0 0 12px">${esc(subject)}</h2>` +
    lines.map((l) => `<p style="margin:4px 0">${esc(l)}</p>`).join('') + `<p style="margin-top:18px"><a href="${esc(link)}">Open your admin screen</a></p></div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('NOTIFY_FROM') ?? 'Open Growth <onboarding@resend.dev>', to: [to], subject, text, html }),
  });
  if (!res.ok) {
    await db.from(table).update({ team_notified_at: null }).eq('id', id); // let a later retry send it
    return json({ error: 'email failed', status: res.status }, 502);
  }
  return json({ status: 'sent' });
});
