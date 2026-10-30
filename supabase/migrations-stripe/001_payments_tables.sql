-- Stripe payments, step 1 of 3: tables. Additive only: no existing table is touched.
-- Apply order: 001, 002, 003. Rollback: rollback-payments.sql (drops only what these files create).
-- Nothing here stores card data or any Stripe key. Stripe ids are stored so the webhook can match events.

-- One Stripe customer per website user (created by the create-checkout-session function).
create table if not exists public.stripe_customers (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

-- A request from staff for a customer to pay: a one-time amount, or a monthly subscription with an optional setup fee.
-- Amounts are whole cents in CAD. The checkout function reads them from this row, never from the browser.
create table if not exists public.payment_requests (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users (id) on delete restrict, -- keep financial records
  description                text not null check (char_length(btrim(description)) between 3 and 200),
  kind                       text not null check (kind in ('one_time', 'subscription')),
  amount_cents               integer not null check (amount_cents between 50 and 10000000), -- one_time total, or the monthly amount
  setup_fee_cents            integer not null default 0 check (setup_fee_cents between 0 and 10000000),
  currency                   text not null default 'cad' check (currency = 'cad'),
  -- pending: waiting for payment. paid: one-time paid. active / past_due / canceled: follow the Stripe subscription.
  -- void: staff withdrew the request before it was paid.
  status                     text not null default 'pending' check (status in ('pending', 'paid', 'active', 'past_due', 'canceled', 'void')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_subscription_id     text,
  paid_at                    timestamptz,
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  created_by                 uuid default auth.uid() references auth.users (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint setup_fee_only_for_subscriptions check (kind = 'subscription' or setup_fee_cents = 0)
);
create index if not exists payment_requests_user_idx on public.payment_requests (user_id, created_at desc);
create unique index if not exists payment_requests_subscription_idx on public.payment_requests (stripe_subscription_id) where stripe_subscription_id is not null;

-- One row per Stripe webhook event we have seen. The event id is the primary key, which is what makes retries harmless.
-- No card, address or email data is stored here.
create table if not exists public.payment_events (
  id                 text primary key,           -- Stripe event id (evt_...)
  type               text not null,
  payment_request_id uuid references public.payment_requests (id) on delete set null,
  outcome            text,                       -- what we did, e.g. paid, already_processed, mismatch, ignored
  received_at        timestamptz not null default now(),
  processed_at       timestamptz                 -- null means seen but not finished: the Stripe retry will run it again
);

-- Keep updated_at honest when staff void a request from the browser.
create or replace function public.payments_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists payment_requests_touch on public.payment_requests;
create trigger payment_requests_touch before update on public.payment_requests
  for each row execute function public.payments_touch_updated_at();
