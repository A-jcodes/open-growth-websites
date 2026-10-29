-- Open Growth lead capture table.
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run.

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  email            text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(email) <= 254),
  revenue_range    text not null check (revenue_range in (
                     '$0 - $1,000',
                     '$1,000 - $10,000',
                     '$10,000 - $100,000',
                     '$100,000 - $1 million',
                     '$1 million+'
                   )),
  biggest_problem  text not null check (char_length(btrim(biggest_problem)) between 3 and 2000),
  source           text not null default 'unknown' check (char_length(source) <= 60),
  offer            text not null default 'calls-checklist' check (char_length(offer) <= 60),
  page_url         text check (char_length(page_url) <= 500),
  crm_synced_at    timestamptz            -- set by the CRM sync later
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (lower(email));

-- Row level security: the public site key may ONLY insert. It cannot read, edit or delete.
alter table public.leads enable row level security;

drop policy if exists "Website can insert leads" on public.leads;
create policy "Website can insert leads"
  on public.leads
  for insert
  to anon
  with check (crm_synced_at is null);

revoke all on public.leads from anon, authenticated;
grant insert (name, email, revenue_range, biggest_problem, source, offer, page_url) on public.leads to anon;

-- ---- beehiiv sync (added later; also applied as migrations) ----
-- Each new lead triggers the sync-beehiiv Edge Function (supabase/functions/sync-beehiiv).
-- The function needs the secret BEEHIIV_API_KEY, set in Supabase > Edge Functions > Secrets.
alter table public.leads add column if not exists crm_error text;
create extension if not exists pg_net with schema extensions;
-- The notify_beehiiv_sync() trigger function and leads_sync_beehiiv trigger live in the
-- sync_leads_to_beehiiv migration in the Supabase project.
