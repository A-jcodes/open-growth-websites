-- Premium plan, step 4: plan columns on profiles. Additive only; existing rows become 'standard'.
-- Apply after 001-003. Rollback: rollback-premium.sql.
-- These columns are written ONLY by the stripe-webhook Edge Function (service role). Browsers get read access
-- (a customer reads their own row through the existing "Own profile: read" policy, staff through "Staff: read profiles")
-- and NO write access: the existing profiles UPDATE grant is column-level (business_name, full_name, website_url only).

alter table public.profiles
  add column if not exists plan text not null default 'standard',
  add column if not exists plan_status text,
  add column if not exists plan_renews_at timestamptz,
  add column if not exists plan_cancel_at_period_end boolean not null default false;

do $$ begin
  alter table public.profiles add constraint profiles_plan_check check (plan in ('standard', 'premium'));
exception when duplicate_object then null; end $$;

-- Belt and braces: make sure no browser role can ever write these columns, whatever grants exist now or later.
revoke insert (plan, plan_status, plan_renews_at, plan_cancel_at_period_end) on public.profiles from anon, authenticated;
revoke update (plan, plan_status, plan_renews_at, plan_cancel_at_period_end) on public.profiles from anon, authenticated;
grant select (plan, plan_status, plan_renews_at, plan_cancel_at_period_end) on public.profiles to authenticated;
grant select, update on public.profiles to service_role;

-- Admin list and "unread first" sorting filter on plan
create index if not exists profiles_plan_idx on public.profiles (plan) where plan = 'premium';
