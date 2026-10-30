-- Stripe payments, step 3 of 3: tell the customer on their dashboard when staff request a payment.
-- Runs as the table owner so it works for staff regardless of activity_feed grants. It never blocks the insert.

create or replace function public.payment_request_notify_customer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  amt text := '$' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00') || ' CAD';
  fee text := '$' || to_char(new.setup_fee_cents / 100.0, 'FM999,999,990.00') || ' CAD';
begin
  insert into public.activity_feed (user_id, title, body)
  values (
    new.user_id,
    'Payment requested',
    new.description || ': ' || amt || case when new.kind = 'subscription' then ' per month' else '' end
      || case when new.setup_fee_cents > 0 then ' plus ' || fee || ' setup' else '' end
      || '. You can pay securely from the Payments section on your dashboard.'
  );
  return new;
exception when others then
  return new; -- an update feed problem must never block staff from creating the request
end;
$$;
revoke all on function public.payment_request_notify_customer() from public, anon, authenticated;

drop trigger if exists payment_requests_notify_customer on public.payment_requests;
create trigger payment_requests_notify_customer after insert on public.payment_requests
  for each row execute function public.payment_request_notify_customer();
