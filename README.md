# Open Growth websites

Four website design directions for **Open Growth**, a Calgary web design studio that builds websites for small businesses that need more calls and bookings.

Every design pitches the same offer: local SEO, 60-second lead follow-up, published prices and a free website audit. Only the look and feel changes, so the designs can be compared side by side.

## The designs

| Folder | Style |
|---|---|
| [`sitesmith/`](sitesmith/) | Bold and playful |
| [`v3-framer/`](v3-framer/) | Framer-style dark |
| [`v2-agent-dark-3d/`](v2-agent-dark-3d/) | Dark with 3D elements |
| [`v1-claude-editorial/`](v1-claude-editorial/) | Clean editorial |

The root [`index.html`](index.html) is a home page that links to each design. Shared images are in `assets/generated/`.

## View locally

There is no build step. The sites are plain HTML, CSS and JavaScript.

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

The folder deploys as a static site, for example on Vercel:

```bash
vercel deploy
```

## Lead capture (Supabase)

Each design's `#audit` form asks four things: name, email, revenue range (five options, `$0 - $1,000` up to `$1 million+`) and the biggest problem right now. Submissions go to a `leads` table in Supabase through `shared/lead-capture.js`.

Setup:

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste `supabase/leads.sql` and run it. This creates the table and locks it down: the public key can only insert rows, never read, edit or delete them.
3. Open **Project Settings > API** and copy the project URL and the `anon public` key into `shared/supabase-config.js`. Never use the `service_role` key in this repo.

The form is the gate for the free **Calgary Calls Checklist** (`checklist/index.html`, a tick-as-you-go page that can also be printed to PDF). Each design has a CTA band above the form, and the success message links to the checklist. Every lead is stored with `offer = 'calls-checklist'`. The checklist page itself is public but not indexed (`noindex`), so anyone with the link can open it.

Until step 3 is done, the forms show an error on submit instead of pretending to send.

The sites load the shared scripts from `../shared/`, so deploy the whole repo, not a single design folder.

Next step, the CRM: the `leads` table has a `crm_synced_at` column ready for a sync job.

## Branches

- `main`: the current designs
- `ux-best-practices`: UI/UX best-practice pass across all four designs
- `seo-keywords`: targets "web design Calgary" and Calgary pricing searches

## Contact

Open Growth, Calgary, Alberta.
