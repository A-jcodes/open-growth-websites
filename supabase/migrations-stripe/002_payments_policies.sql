-- Stripe payments, step 2 of 3: row level security and least-privilege grants.
-- Rule of thumb: the browser can READ its own payment requests and STAFF can create/void them.
-- Everything that records money (paid, active, Stripe ids) is written only by Edge Functions using the service role.

alter table public.stripe_customers enable row level security;
alter table public.payment_requests enable row level security;
alter table public.payment_events   enable row level security;

revoke all on public.stripe_customers from anon, authenticated;
revoke all on public.payment_requests from anon, authenticated;
revoke all on public.payment_events   from anon, authenticated;

-- The service role (Edge Functions) does the money writes. Supabase normally grants this already; stated for clarity.
grant select, insert, update, delete on public.stripe_customers, public.payment_requests, public.payment_events to service_role;

-- stripe_customers: browsers never need it (the portal function looks it up on the server). No grants, no policies.

-- payment_requests: column-level read, so Stripe ids and created_by never reach a browser.
-- (Because of this, the browser must list columns; select('*') on this table is denied by design.)
grant select (id, user_id, description, kind, amount_cents, setup_fee_cents, currency, status,
              paid_at, current_period_end, cancel_at_period_end, created_at, updated_at)
  on public.payment_requests to authenticated;
-- Staff create a request: they choose who, what and how much. Status, ids and created_by come from defaults.
grant insert (user_id, description, kind, amount_cents, setup_fee_cents) on public.payment_requests to authenticated;
-- Staff may only withdraw a request (status -> void), and only while it is unpaid.
grant update (status) on public.payment_requests to authenticated;

drop policy if exists "Own payments: read" on public.payment_requests;
create policy "Own payments: read" on public.payment_requests
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Staff: read payments" on public.payment_requests;
create policy "Staff: read payments" on public.payment_requests
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Staff: request payment" on public.payment_requests;
create policy "Staff: request payment" on public.payment_requests
  for insert to authenticated with check ((select public.is_admin()) and status = 'pending');

drop policy if exists "Staff: void unpaid request" on public.payment_requests;
create policy "Staff: void unpaid request" on public.payment_requests
  for update to authenticated
  using ((select public.is_admin()) and status = 'pending')
  with check ((select public.is_admin()) and status = 'void');

-- payment_events: staff may read the audit trail; nobody can write from a browser.
grant select (id, type, payment_request_id, outcome, received_at, processed_at) on public.payment_events to authenticated;
drop policy if exists "Staff: read payment events" on public.payment_events;
create policy "Staff: read payment events" on public.payment_events
  for select to authenticated using ((select public.is_admin()));
