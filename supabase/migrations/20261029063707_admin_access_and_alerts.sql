-- Migration 6 of 10: staff access (the admins table and is_admin()), the permissions the admin screen needs,
-- and the email alerts for new messages, quote requests and sign-ups.
-- Applied to the live project on 2026-10-29. Before running this on a NEW project, replace the two placeholders in
-- notify_team() below: YOUR-PROJECT-REF and YOUR_ANON_KEY (the public anon key, Project Settings > API).
-- To make someone staff, see supabase/ADMIN-SETUP.md.

-- Who counts as Open Growth staff. Rows are added only by the project owner in the database.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Small additions the admin screen needs
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists team_notified_at timestamptz;
alter table public.messages add column if not exists team_read_at timestamptz;
alter table public.messages add column if not exists team_notified_at timestamptz;
alter table public.quote_requests add column if not exists team_notified_at timestamptz;

-- Store the email on the profile when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rr text := new.raw_user_meta_data ->> 'revenue_range';
begin
  insert into public.profiles (id, email, full_name, business_name, website_url, revenue_range, biggest_problem)
  values (
    new.id, new.email,
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
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Staff permissions. Every one of these policies requires is_admin(), so customers are unaffected.
grant select on public.leads to authenticated;
drop policy if exists "Staff: read leads" on public.leads;
create policy "Staff: read leads" on public.leads for select to authenticated using ((select public.is_admin()));

drop policy if exists "Staff: read profiles" on public.profiles;
create policy "Staff: read profiles" on public.profiles for select to authenticated using ((select public.is_admin()));

drop policy if exists "Staff: read scans" on public.site_scans;
create policy "Staff: read scans" on public.site_scans for select to authenticated using ((select public.is_admin()));

grant update (status) on public.quote_requests to authenticated;
drop policy if exists "Staff: read quotes" on public.quote_requests;
create policy "Staff: read quotes" on public.quote_requests for select to authenticated using ((select public.is_admin()));
drop policy if exists "Staff: update quotes" on public.quote_requests;
create policy "Staff: update quotes" on public.quote_requests for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant insert (user_id, title, detail, status, due_date, sort_order), update (title, detail, status, due_date, sort_order, updated_at), delete on public.work_items to authenticated;
drop policy if exists "Staff: read work" on public.work_items;
create policy "Staff: read work" on public.work_items for select to authenticated using ((select public.is_admin()));
drop policy if exists "Staff: add work" on public.work_items;
create policy "Staff: add work" on public.work_items for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Staff: change work" on public.work_items;
create policy "Staff: change work" on public.work_items for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Staff: remove work" on public.work_items;
create policy "Staff: remove work" on public.work_items for delete to authenticated using ((select public.is_admin()));

grant insert (user_id, title, body), delete on public.activity_feed to authenticated;
drop policy if exists "Staff: read updates" on public.activity_feed;
create policy "Staff: read updates" on public.activity_feed for select to authenticated using ((select public.is_admin()));
drop policy if exists "Staff: post updates" on public.activity_feed;
create policy "Staff: post updates" on public.activity_feed for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Staff: remove updates" on public.activity_feed;
create policy "Staff: remove updates" on public.activity_feed for delete to authenticated using ((select public.is_admin()));

grant insert (user_id, sender, body), update (team_read_at) on public.messages to authenticated;
drop policy if exists "Staff: read messages" on public.messages;
create policy "Staff: read messages" on public.messages for select to authenticated using ((select public.is_admin()));
drop policy if exists "Staff: reply" on public.messages;
create policy "Staff: reply" on public.messages for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Staff: mark read" on public.messages;
create policy "Staff: mark read" on public.messages for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Alert the team by email: new customer message, new quote request, new sign-up
create or replace function public.notify_team()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-team',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := jsonb_build_object('kind', TG_ARGV[0], 'id', new.id)
  );
  return new;
exception when others then
  return new; -- an alert problem must never block a customer action
end;
$$;
revoke execute on function public.notify_team() from public, anon, authenticated;

drop trigger if exists messages_notify_team on public.messages;
create trigger messages_notify_team after insert on public.messages
  for each row when (new.sender = 'customer') execute function public.notify_team('message');
drop trigger if exists quotes_notify_team on public.quote_requests;
create trigger quotes_notify_team after insert on public.quote_requests
  for each row execute function public.notify_team('quote');
drop trigger if exists profiles_notify_team on public.profiles;
create trigger profiles_notify_team after insert on public.profiles
  for each row execute function public.notify_team('signup');
