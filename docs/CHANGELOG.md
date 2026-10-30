# Changelog

Newest first. Dates are 2026. "Live" means deployed to https://open-growth-websites.vercel.app.

## 30 Oct

### Self-hosted libraries, icons and fonts (live)
The account, admin and v2 pages used up to six outside hosts (Google Fonts, jsDelivr, unpkg, cdnjs, Unsplash). They now load from `shared/vendor`, `shared/fonts` and `v2-agent-dark-3d/assets`. The icon file holds only the 33 icons in use (8 KB instead of 356 KB). Library versions are unchanged. Fewer hosts means fewer lookups and connections, which helps on a slow network. The other three designs still use outside CDNs.

### Payments switched on, sandbox only (live)
`shared/payments-config.js` set to `enabled: true`. Stripe is still in sandbox, so only Stripe's test cards work. The Upgrade button and Manage billing button work for signed-in customers.

### Fix: a Premium upgrade was announced three times (live)
Stripe sends several events for one upgrade at the same instant. Each read the profile as Standard before any wrote, so each posted "Welcome to Premium" and emailed the team. The plan write is now a compare-and-set: only the event that actually changes the plan announces it. A test now reproduces the race (fails on the old logic, passes on the fix) and a second sandbox upgrade confirmed one announcement.

### Standard and Premium plans, and Stripe payments (live, sandbox)
- **Premium** costs **$30.00 CAD per month**, self-serve through Stripe-hosted checkout. Standard is free. The price is fixed in server code.
- Premium gives priority replies (Premium badge and priority sorting on the admin screen), a higher scan limit (30 per hour instead of 10) and full scan history (20 scans instead of 3).
- Dashboard: a coloured **Your plan** card with a Standard versus Premium comparison, status line (active, renews on, cancels on, payment failed) and Upgrade or Manage billing button.
- **Payment requests:** staff can request a one-time or monthly payment from a customer in the admin screen; the customer pays from their dashboard.
- Edge Functions `create-checkout-session`, `create-portal-session` and `stripe-webhook` deployed. Migrations 7 to 10 applied (payments tables, policies, activity entry, plan columns).
- Tested end to end in the sandbox with Stripe's test card: upgrade, plan change, billing page, cancel at period end. Test accounts were deleted afterwards.
- Built by a sub-agent on separate branches (`stripe-integration`, `premium-plan`) and reviewed before merging. Design and test notes: `stripe-integration-plan.md`, `premium-plan.md`.

### Email alerts verified
Resend key and alert address saved as Supabase secrets. A test message produced one alert email.

## 29 Oct

### Admin screen and alerts (live)
- `/admin/`: customers with unread counts, message threads and replies, work steps, updates, scans, quote and lead inboxes. Staff access is the `admins` table plus `is_admin()`.
- `notify-team` function: one email per new customer message, quote request or sign-up (Resend). Each row is claimed once so repeats cannot send twice.
- Migration 6 applied. Security rules were proven by simulating signed-in customers and staff in the database.

### Sign-up pop-up and dashboard (live)
- Five-step pop-up on the v2 page, opened from every "Free checklist" button, with a log-in view. It saves a lead and creates the account; confetti plays on the finish.
- Dashboard shows **what Open Growth is doing** (work steps with progress, updates feed) and a **two-way message** thread. New accounts get a welcome update and three starting steps. The website scan runs automatically on the first visit.
- Migration 5 applied (profile answers, updates, work steps, messages, realtime).

### Glowing start card (live, v2)
A wide card near the top of the page with a gradient edge, a "Free" badge, a one-question name form that opens the pop-up, and a trust row.

### Account area (live)
- `/account/`: sign-up, log-in, password reset, website **scanner** (about 20 checks across on-page SEO, technical and local search, plus Google PageSpeed), score history and quote requests.
- `analyze-site` function with private-address blocking, size and time caps, and a per-hour scan limit.
- Migration 4 applied (profiles, scans, quote requests).

### Visual and form polish (live)
- Revenue question shows every option clearly (rings and a highlighted choice; v3 changed from a dropdown to visible rows).
- A faint gradient outline on the sign-up card and a brighter one on the submit button, in all four designs.
- Confetti was tried on the lead form's success state and then removed from all four designs at the owner's request (it remains on the sign-up pop-up finish).

### Free Calgary Calls Checklist (live)
`/checklist/` page (ten checks, tick-as-you-go, printable) and a call-to-action band above the form in each design. Leads store which offer they came from.

### Supabase lead capture and beehiiv sync
- Four-question lead form (name, email, revenue range, biggest problem) in all four designs, saved to the `leads` table. The public key can only insert.
- `sync-beehiiv` function adds email and first name to the beehiiv publication and marks the lead synced. **Waiting on `BEEHIIV_API_KEY`.** beehiiv's plan blocked creating custom fields, so revenue and problem stay in Supabase only.
- Migrations 1 to 3 applied.

### Repository and hosting
Repository made public after a scan found no secrets in the history. Vercel linked to the GitHub repo, so every push to `main` deploys to production. README rewritten.

## Earlier

Four design directions (`sitesmith`, `v1-claude-editorial`, `v2-agent-dark-3d`, `v3-framer`), a home page linking to each, SEO and UX best-practice passes, and a Calgary-focused keyword pass.
