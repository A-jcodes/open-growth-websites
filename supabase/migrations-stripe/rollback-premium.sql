-- NOT a migration. Run by hand only to remove the Premium plan columns (loses who is Premium; Stripe keeps its records).
drop index if exists public.profiles_plan_idx;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles
  drop column if exists plan_cancel_at_period_end,
  drop column if exists plan_renews_at,
  drop column if exists plan_status,
  drop column if exists plan;
