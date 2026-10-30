-- Migration 4 of 10: customer accounts. Profiles, website scans and quote requests, all with row level security.
-- Applied to the live project on 2026-10-29.

-- Customer profile, one per Supabase Auth user
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text check (char_length(full_name) <= 120),
  business_name text check (char_length(business_name) <= 160),
  website_url   text check (char_length(website_url) <= 500),
  created_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, business_name, website_url) on public.profiles to authenticated;
drop policy if exists "Own profile: read" on public.profiles;
create policy "Own profile: read" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Own profile: update" on public.profiles;
create policy "Own profile: update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Create the profile automatically when someone signs up (replaced by later migrations)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, business_name, website_url)
  values (
    new.id,
    left(new.raw_user_meta_data ->> 'full_name', 120),
    left(new.raw_user_meta_data ->> 'business_name', 160),
    left(new.raw_user_meta_data ->> 'website_url', 500)
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new; -- never block a sign-up because of the profile row
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Website scans. Written only by the analyze-site function, read only by the owner.
create table if not exists public.site_scans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  url        text not null check (char_length(url) <= 500),
  score      integer check (score between 0 and 100),
  results    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists site_scans_user_created_idx on public.site_scans (user_id, created_at desc);
alter table public.site_scans enable row level security;
revoke all on public.site_scans from anon, authenticated;
grant select on public.site_scans to authenticated;
drop policy if exists "Own scans: read" on public.site_scans;
create policy "Own scans: read" on public.site_scans for select to authenticated using (user_id = (select auth.uid()));

-- Quote requests. The owner can add and read their own.
create table if not exists public.quote_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  services   text[] not null default '{}' check (cardinality(services) <= 10),
  budget     text check (budget in ('Under $1,500','$1,500 - $3,000','$3,000 - $6,000','$6,000+','Not sure yet')),
  timeline   text check (timeline in ('As soon as possible','Within a month','1 - 3 months','Just exploring')),
  notes      text check (char_length(notes) <= 2000),
  status     text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists quote_requests_user_idx on public.quote_requests (user_id, created_at desc);
alter table public.quote_requests enable row level security;
revoke all on public.quote_requests from anon, authenticated;
grant select on public.quote_requests to authenticated;
grant insert (services, budget, timeline, notes) on public.quote_requests to authenticated;
drop policy if exists "Own quotes: read" on public.quote_requests;
create policy "Own quotes: read" on public.quote_requests for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Own quotes: add" on public.quote_requests;
create policy "Own quotes: add" on public.quote_requests for insert to authenticated with check (user_id = (select auth.uid()) and status = 'new');
