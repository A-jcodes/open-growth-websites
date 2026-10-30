# Admin screen and email alerts: setup

The admin screen lives at `/admin/`. Access is decided by Supabase, not by the page: only users listed in the
`public.admins` table can read other customers' data or write updates and replies.

## 1. Make yourself an admin (once)

1. Create your own account on the website (the sign-up pop-up) and confirm your email.
2. In Supabase, open **SQL Editor** and run this, with your own email:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'YOUR-EMAIL-HERE'
on conflict do nothing;
```

3. Open `/admin/` and sign in with the same email and password.

Never add anyone you do not trust. To remove access: `delete from public.admins where user_id = '...';`

## 2. Turn on email alerts (optional but recommended)

The `notify-team` function emails you when a customer sends a message, requests a quote or signs up.

1. Create a free account at resend.com and make an API key.
2. In Supabase, go to **Edge Functions, Secrets** and add:
   - `RESEND_API_KEY` : the key from Resend
   - `NOTIFY_EMAIL` : the email address that should receive the alerts
   - `NOTIFY_FROM` (optional) : for example `Open Growth <hello@yourdomain.ca>` once your domain is verified in Resend.
     Until then, alerts are sent from Resend's test address, which only delivers to the email you signed up to Resend with.
3. Nothing else to do. Each alert is sent once.

Until the secrets are set, the admin screen still shows an unread count and a pop-up when you are logged in.

The same two secrets also power the **payment alerts**: the Stripe webhook emails you when a payment arrives, a customer upgrades to or leaves Premium, a monthly payment fails, or a payment does not match your records.

## 3. Day-to-day use

- **Messages:** open a customer, read their thread (it marks their messages read), reply with Ctrl+Enter.
- **Work and updates:** the Work and Updates tabs control what the customer sees on their dashboard.
- **Quotes and leads:** the Quotes and Leads buttons on the left list everyone. Set a quote's status (new, contacted, quoted, won, lost).
- **Payments:** with payments switched on (`shared/payments-config.js`), each customer has a **Payments** tab to request a one-time or monthly payment. Premium customers show a badge and sort first among unread. See [`../docs/stripe-integration-plan.md`](../docs/stripe-integration-plan.md).
- **Staff list:** add or remove staff only in the database, as in step 1. Customers cannot make themselves staff.

See [`README.md`](README.md) for the migrations, functions and the full list of secrets.
