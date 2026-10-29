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
