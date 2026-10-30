-- NOT a migration. Run by hand only if the payments feature must be removed completely.
-- Destroys the payment history held in these tables (Stripe keeps its own records).
drop trigger if exists payment_requests_notify_customer on public.payment_requests;
drop function if exists public.payment_request_notify_customer();
drop table if exists public.payment_events;
drop table if exists public.payment_requests;
drop table if exists public.stripe_customers;
drop function if exists public.payments_touch_updated_at();
