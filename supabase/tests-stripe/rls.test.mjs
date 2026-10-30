// Runs the three migrations on a throwaway in-memory Postgres (PGlite) with stubs for Supabase auth,
// then checks the row level security and grants. Nothing here touches the live project.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('../migrations-stripe/', import.meta.url);
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.admins (user_id uuid primary key, created_at timestamptz not null default now());
  create function public.is_admin() returns boolean language sql stable security definer set search_path = public
    as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;
  grant execute on function public.is_admin() to anon, authenticated;
  create table public.activity_feed (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, body text, created_at timestamptz not null default now());
  alter table public.activity_feed enable row level security;
  create policy "Own activity: read" on public.activity_feed for select to authenticated using (user_id = (select auth.uid()));
  grant select on public.activity_feed to authenticated;
`);
const staff = '00000000-0000-0000-0000-00000000000a', cust1 = '00000000-0000-0000-0000-0000000000c1', cust2 = '00000000-0000-0000-0000-0000000000c2';
await db.exec(`insert into auth.users values ('${staff}','s@x'),('${cust1}','c1@x'),('${cust2}','c2@x'); insert into public.admins (user_id) values ('${staff}');`);

for (const f of ['001_payments_tables.sql', '002_payments_policies.sql', '003_payment_request_activity.sql']) await db.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
// applying twice must be harmless (idempotent migrations)
for (const f of ['001_payments_tables.sql', '002_payments_policies.sql', '003_payment_request_activity.sql']) await db.exec(fs.readFileSync(new URL(f, dir), 'utf8'));

async function as(role, sub, sql, params) {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${sub || ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
}
const fails = async (p, label) => { let e; try { await p; } catch (x) { e = x; } assert.ok(e, 'expected failure: ' + label); return e; };

// staff can create a request; the customer gets an activity entry
await as('authenticated', staff, `insert into public.payment_requests (user_id, description, kind, amount_cents, setup_fee_cents) values ($1,'Website build','subscription',120000,150000)`, [cust1]);
await as('authenticated', staff, `insert into public.payment_requests (user_id, description, kind, amount_cents) values ($1,'Other customer job','one_time',390000)`, [cust2]);
const act = await db.query(`select title, body from public.activity_feed where user_id = $1`, [cust1]);
assert.equal(act.rows.length, 1); console.log('activity body:', act.rows[0].body);

// a customer cannot create a request, even for themselves
await fails(as('authenticated', cust1, `insert into public.payment_requests (user_id, description, kind, amount_cents) values ($1,'Free stuff','one_time',50)`, [cust1]), 'customer insert');
// staff cannot smuggle a status or stripe id on insert (no column privilege)
await fails(as('authenticated', staff, `insert into public.payment_requests (user_id, description, kind, amount_cents, status) values ($1,'Sneaky','one_time',5000,'paid')`, [cust1]), 'status on insert');
await fails(as('authenticated', staff, `insert into public.payment_requests (user_id, description, kind, amount_cents, stripe_subscription_id) values ($1,'Sneaky','one_time',5000,'sub_1')`, [cust1]), 'stripe id on insert');
// constraints
await fails(as('authenticated', staff, `insert into public.payment_requests (user_id, description, kind, amount_cents, setup_fee_cents) values ($1,'Bad setup','one_time',5000,100)`, [cust1]), 'setup fee on one_time');
await fails(as('authenticated', staff, `insert into public.payment_requests (user_id, description, kind, amount_cents) values ($1,'Too small','one_time',10)`, [cust1]), 'amount below 50 cents');

// a customer sees only their own rows
const mine = await as('authenticated', cust1, `select id, description, status from public.payment_requests`);
assert.equal(mine.rows.length, 1); assert.equal(mine.rows[0].description, 'Website build');
const none = await as('anon', '', `select 1 from public.payment_requests`).then(() => 'allowed', () => 'denied');
assert.equal(none, 'denied');
// staff sees all
assert.equal((await as('authenticated', staff, `select id from public.payment_requests`)).rows.length, 2);
// the Stripe ids are not readable from a browser, and select * is denied
await fails(as('authenticated', cust1, `select stripe_subscription_id from public.payment_requests`), 'stripe id read');
await fails(as('authenticated', cust1, `select * from public.payment_requests`), 'select *');
// customers cannot update their own rows, staff can only void a pending one
const upd = await as('authenticated', cust1, `update public.payment_requests set status='void' where user_id=$1 returning id`, [cust1]).then((r) => r.rows.length, () => 'denied');
assert.ok(upd === 0 || upd === 'denied', 'customer update must not change rows, got ' + upd);
await fails(as('authenticated', staff, `update public.payment_requests set status='paid' where user_id=$1`, [cust1]), 'staff mark paid');
await fails(as('authenticated', staff, `update public.payment_requests set amount_cents=50 where user_id=$1`, [cust1]), 'staff edit amount');
const voided = await as('authenticated', staff, `update public.payment_requests set status='void' where user_id=$1 returning id, updated_at`, [cust2]);
assert.equal(voided.rows.length, 1);
// once settled (service role), staff cannot void it any more
await db.exec(`update public.payment_requests set status='paid' where user_id='${cust1}'`);
const after = await as('authenticated', staff, `update public.payment_requests set status='void' where user_id=$1 returning id`, [cust1]);
assert.equal(after.rows.length, 0);

// stripe_customers and payment_events: invisible to browsers
await fails(as('authenticated', cust1, 'select * from public.stripe_customers'), 'stripe_customers customer read');
await fails(as('authenticated', staff, 'select * from public.stripe_customers'), 'stripe_customers staff read');
for (const t of ['stripe_customers', 'payment_events']) await fails(as('anon', '', `select * from public.${t}`), t + ' anon read');
await fails(as('authenticated', staff, `insert into public.payment_events (id, type) values ('evt_x','x')`), 'staff write event');
await db.exec(`insert into public.payment_events (id, type) values ('evt_1','invoice.paid')`);
assert.equal((await as('authenticated', staff, `select id from public.payment_events`)).rows.length, 1);
assert.equal((await as('authenticated', cust1, `select id from public.payment_events`).then((r) => r.rows.length, () => 0)), 0);
// event idempotency primitive
await db.exec(`insert into public.payment_events (id, type) values ('evt_1','invoice.paid') on conflict (id) do nothing`);
assert.equal((await db.query(`select count(*)::int c from public.payment_events`)).rows[0].c, 1);
// service role path (bypassrls) can write money state
await as('service_role', '', `update public.payment_requests set stripe_subscription_id='sub_1', status='active' where user_id=$1`, [cust1]);
// rollback script works
await db.exec(fs.readFileSync(new URL('rollback-payments.sql', dir), 'utf8'));
assert.equal((await db.query(`select to_regclass('public.payment_requests') r`)).rows[0].r, null);
console.log('RLS / grants / migration checks passed');
