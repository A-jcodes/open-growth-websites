-- Migration 5 of 10: what the sign-up pop-up stores, plus the dashboard's team updates, work steps and messages.
-- Applied to the live project on 2026-10-29.

-- What the customer told us in the sign-up pop-up
alter table public.profiles add column if not exists revenue_range text
  check (revenue_range in ('$0 - $1,000','$1,000 - $10,000','$10,000 - $100,000','$100,000 - $1 million','$1 million+'));
alter table public.profiles add column if not exists biggest_problem text check (char_length(biggest_problem) <= 2000);
grant select on public.profiles to authenticated;

-- Updates from Open Growth: written by the team, read-only for the customer
create table if not exists public.activity_feed (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) <= 160),
  body       text check (char_length(body) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists activity_feed_user_idx on public.activity_feed (user_id, created_at desc);
alter table public.activity_feed enable row level security;
revoke all on public.activity_feed from anon, authenticated;
grant select on public.activity_feed to authenticated;
drop policy if exists "Own activity: read" on public.activity_feed;
create policy "Own activity: read" on public.activity_feed for select to authenticated using (user_id = (select auth.uid()));

-- Work Open Growth is doing for the customer: written by the team, read-only for the customer
create table if not exists public.work_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) <= 160),
  detail     text check (char_length(detail) <= 1000),
  status     text not null default 'planned' check (status in ('planned','in_progress','done')),
  due_date   date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_items_user_idx on public.work_items (user_id, sort_order, created_at);
alter table public.work_items enable row level security;
revoke all on public.work_items from anon, authenticated;
grant select on public.work_items to authenticated;
drop policy if exists "Own work: read" on public.work_items;
create policy "Own work: read" on public.work_items for select to authenticated using (user_id = (select auth.uid()));

-- Two-way messages between the customer and Open Growth
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender     text not null default 'customer' check (sender in ('customer','team')),
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_user_idx on public.messages (user_id, created_at);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant insert (body) on public.messages to authenticated;
drop policy if exists "Own messages: read" on public.messages;
create policy "Own messages: read" on public.messages for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Own messages: send" on public.messages;
create policy "Own messages: send" on public.messages for insert to authenticated with check (user_id = (select auth.uid()) and sender = 'customer');

-- Live updates: new team replies and work updates appear without a refresh
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.activity_feed; exception when others then null; end;
  begin alter publication supabase_realtime add table public.work_items; exception when others then null; end;
end $$;

-- Sign-up stores the pop-up answers and seeds a welcome update and first work items (replaced by migration 6)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rr text := new.raw_user_meta_data ->> 'revenue_range';
begin
  insert into public.profiles (id, full_name, business_name, website_url, revenue_range, biggest_problem)
  values (
    new.id,
    left(new.raw_user_meta_data ->> 'full_name', 120),
    left(new.raw_user_meta_data ->> 'business_name', 160),
    left(new.raw_user_meta_data ->> 'website_url', 500),
    case when rr in ('$0 - $1,000','$1,000 - $10,000','$10,000 - $100,000','$100,000 - $1 million','$1 million+') then rr else null end,
    left(new.raw_user_meta_data ->> 'biggest_problem', 2000)
  )
  on conflict (id) do nothing;

  insert into public.activity_feed (user_id, title, body) values
    (new.id, 'Welcome to Open Growth', 'Your account is ready. Austin will read your answers and reply within 1 business day.');
  insert into public.work_items (user_id, title, detail, status, sort_order) values
    (new.id, 'Review your website and your answers', 'We read your answers and check your site for what is costing you calls.', 'in_progress', 1),
    (new.id, 'Send your tailored plan and quote', 'A short plan with the fixes that matter most, and a clear price.', 'planned', 2),
    (new.id, 'Kick-off', 'We agree the plan with you and start work.', 'planned', 3);
  return new;
exception when others then
  return new; -- never block a sign-up because of these extra rows
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
