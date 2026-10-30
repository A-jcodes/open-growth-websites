-- Migration 2 of 10: send each new lead to the sync-beehiiv Edge Function.
-- Applied to the live project on 2026-10-29. Before running this on a NEW project, replace the two placeholders below:
--   YOUR-PROJECT-REF   your Supabase project reference (the part before .supabase.co)
--   YOUR_ANON_KEY      the project's public "anon" key (Project Settings > API). It is public by design.

alter table public.leads add column if not exists crm_error text;

create extension if not exists pg_net;

create or replace function public.notify_beehiiv_sync()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/sync-beehiiv',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := jsonb_build_object('lead_id', new.id)
  );
  return new;
exception when others then
  -- Never block a lead from saving because the sync call failed.
  return new;
end;
$$;

revoke execute on function public.notify_beehiiv_sync() from public, anon, authenticated;

drop trigger if exists leads_sync_beehiiv on public.leads;
create trigger leads_sync_beehiiv
  after insert on public.leads
  for each row execute function public.notify_beehiiv_sync();
