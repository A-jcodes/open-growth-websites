# Open Growth website

Website, customer accounts and online payments for **Open Growth**, a Calgary studio that builds websites and local SEO for small businesses that need more calls and bookings.

- **Live site:** https://open-growth-websites.vercel.app (deploys automatically from `main`)
- **Main design:** [`v2-agent-dark-3d/`](v2-agent-dark-3d/) (dark, glass, violet and cyan). The account area, admin screen and payments use this style.
- **Backend:** one [Supabase](https://supabase.com) project (database, sign-in, Edge Functions). No build step: the site is plain HTML, CSS and JavaScript.

> **Status (30 Oct 2026):** everything below is live. Payments run in **Stripe sandbox mode only** (no real money). See [What still needs doing](#what-still-needs-doing).

## What it does

| For visitors | For customers (signed in) | For Open Growth staff |
|---|---|---|
| Four design directions of the marketing site | Account at `/account/`: sign up, log in, reset password | Admin screen at `/admin/` |
| Free **Calgary Calls Checklist** page (`/checklist/`) | Website **scanner**: score out of 100 for SEO, technical, local search and Google speed, with a ranked fix list and history | Customer list with unread counts, full message threads and replies |
| Step-by-step sign-up **pop-up** and a glowing start card on the v2 page | **Dashboard**: what Open Growth is doing for them (work steps, updates feed), two-way messages | Add, edit and finish a customer's work steps, post updates |
| Lead form (name, email, revenue range, biggest problem) in all four designs | **Quote requests** | Quotes and leads inboxes, scan results per customer |
| | **Standard** (free) and **Premium** ($30 CAD per month) plans through Stripe | **Request payment** from a customer, Premium badge and priority sorting |

Email alerts go to the team on every new message, quote request and sign-up (via Resend). New leads sync to a beehiiv mailing list once its key is set.

## Repository map

```
v1-claude-editorial/  v2-agent-dark-3d/  v3-framer/  sitesmith/   The four marketing designs
  v2-agent-dark-3d/start-modal.*      Step-by-step sign-up and log-in pop-up
account/                              Customer dashboard (sign-in, scans, plan, messages, quotes)
admin/                                Staff screen
checklist/                            The free checklist page
shared/                               Config and code shared by every page
  supabase-config.js                  Public Supabase URL and key (safe to publish)
  payments-config.js                  The payments on/off switch
  lead-capture.js                     Sends form leads to Supabase
  vendor/  fonts/                     Libraries, icons and fonts hosted on our own site
supabase/
  migrations/ + migrations-stripe/    Database setup, in order (see supabase/README.md)
  functions/                          Edge Functions (server code)
  tests-stripe/                       Automated tests for payments and security rules
  README.md  ADMIN-SETUP.md           Database and functions guide, and how to make someone staff
docs/                                 Architecture, changelog, Stripe and Premium plans
```

## Documentation

| Read this | For |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit together, the data model and the security model |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Everything built, in order, with dates |
| [`supabase/README.md`](supabase/README.md) | Migrations, Edge Functions, secrets and how to rebuild the backend |
| [`supabase/ADMIN-SETUP.md`](supabase/ADMIN-SETUP.md) | Making yourself staff and turning on email alerts |
| [`docs/stripe-integration-plan.md`](docs/stripe-integration-plan.md) | Stripe design, setup steps, test cards, rollout and rollback |
| [`docs/premium-plan.md`](docs/premium-plan.md) | How Standard and Premium work |

## Run it locally

No install needed to view the site. Serve the folder with any static server, for example:

```bash
npx serve .
```

Then open `/v2-agent-dark-3d/`, `/account/` or `/admin/`. The pages talk to the live Supabase project, so a test sign-in creates a real account there. Use test addresses and delete them after.

Automated tests for payments, security rules and webhook logic (no network or Stripe account needed):

```bash
cd supabase/tests-stripe
npm install
npm test
```

## Deploy

Pushing to `main` deploys to Vercel within seconds. Other branches get preview links. The Supabase side (database changes and Edge Functions) is **not** deployed by Git: apply migrations and deploy functions as described in [`supabase/README.md`](supabase/README.md).

## Payments (Stripe)

- **Switch:** `shared/payments-config.js` has `enabled: true|false`. While `false`, the plan card shows "Premium coming soon" and no payment request is made. It is currently `true`, against Stripe's **sandbox**: only Stripe's fake test cards work (for example `4242 4242 4242 4242`, any future date, any code). Real cards are refused.
- **Going live** means live keys, a live webhook, a live billing page and the `STRIPE_ALLOW_LIVE` setting, and a decision on GST. Follow [`docs/stripe-integration-plan.md`](docs/stripe-integration-plan.md).
- The Premium price is fixed on the server ($30.00 CAD per month). The browser never sends an amount.

## Security in short

- Visitors and customers use only a **public** key. Every table has **row level security**: customers see only their own rows, and only staff listed in `public.admins` can see everyone's.
- Nothing that changes a plan or marks a payment as paid can be written from a browser. Only the Stripe webhook (signature checked, repeat-safe) does that.
- The website scanner refuses internal and private network addresses, caps page size and time, and limits scans per hour (10 Standard, 30 Premium).
- **No secret is stored in this repository.** Keys live in Supabase Edge Function Secrets. See the list in [`supabase/README.md`](supabase/README.md).

## What still needs doing

| Item | Why it matters |
|---|---|
| beehiiv key (`BEEHIIV_API_KEY`) | Leads are saved in Supabase but are not added to the mailing list until it is set. beehiiv's plan also blocked custom fields, so only email and first name are sent. |
| Consent line on the forms | Canada's anti-spam law (CASL) needs clear consent before adding people to a mailing list. |
| Google speed key (`PSI_API_KEY`) | Without it, Google often refuses the speed test and scans show no speed results. |
| Supabase sign-in settings | Confirm the Site URL and redirect URL are saved, choose whether new accounts must confirm their email, and add a real email-sending service (the built-in one sends only a few messages an hour). |
| Live Stripe | Needed before taking real payments. Also decide on GST. |
| Other designs | Only the v2 design links to the account area and shows the pop-up. |
| Sample data on the page | Charts and dashboards marked "Sample data" are illustrations, not client results. Replace them with real results when you have them. |

## Troubleshooting

- **Stripe or the site opens slowly on one computer:** check DNS. If the router's DNS answers slowly, lookups for `checkout.stripe.com`, `vercel.app` and similar can take 6 to 7 seconds or fail, while a public DNS such as 1.1.1.1 answers in milliseconds. This is a network setting on that computer, not a site problem.
- **A form says "Sorry, something went wrong":** the Supabase project may be paused, or the secret it needs is missing. Check Edge Functions, Secrets in the Supabase dashboard.
- **Customers cannot see their plan change after paying:** check Stripe's Workbench, Webhooks for failed deliveries, and the `payment_events` table.
