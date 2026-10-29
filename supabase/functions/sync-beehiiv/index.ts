import { createClient } from 'npm:@supabase/supabase-js@2';

// Adds a saved lead to the beehiiv publication, then marks it synced.
// The caller only sends a lead id. The lead itself is read from the database here,
// so a forged request can never push arbitrary data to beehiiv.

const PUBLICATION_ID = Deno.env.get('BEEHIIV_PUBLICATION_ID') ?? 'pub_77dd3875-53de-4d70-bd4c-e13ff0b40451';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let leadId = '';
  try {
    const body = await req.json();
    leadId = String(body?.lead_id ?? '');
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!UUID.test(leadId)) return json({ error: 'bad lead_id' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (error || !lead) return json({ error: 'lead not found' }, 404);
  if (lead.crm_synced_at) return json({ status: 'already_synced' });

  const apiKey = Deno.env.get('BEEHIIV_API_KEY');
  if (!apiKey) {
    await supabase.from('leads').update({ crm_error: 'BEEHIIV_API_KEY secret is not set' }).eq('id', leadId);
    return json({ error: 'not configured' }, 500);
  }

  const firstName = String(lead.name).trim().split(/\s+/)[0];
  const res = await fetch(`https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: lead.email,
      reactivate_existing: false,
      send_welcome_email: false,
      utm_source: lead.source,
      utm_medium: 'website',
      utm_campaign: lead.offer,
      referring_site: lead.page_url ?? undefined,
      custom_fields: [{ name: 'first_name', value: firstName }],
    }),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    await supabase.from('leads').update({ crm_error: `beehiiv ${res.status}: ${text}` }).eq('id', leadId);
    return json({ error: 'beehiiv failed', status: res.status }, 502);
  }

  await supabase.from('leads').update({ crm_synced_at: new Date().toISOString(), crm_error: null }).eq('id', leadId);
  return json({ status: 'synced' });
});
