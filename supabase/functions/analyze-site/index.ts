import { createClient } from 'npm:@supabase/supabase-js@2';
import { parse } from 'npm:node-html-parser@6';
import { scanLimitFor } from './limits.ts';

// Scans a customer's website for on-page SEO, technical and local-SEO signals,
// adds Google PageSpeed results, scores it, and saves the scan for the signed-in user.
// Safety: needs a signed-in user, blocks private network addresses (SSRF),
// caps page size and time, and limits each user per hour: 10 on Standard, 30 on Premium (the plan is read from the
// database with the service role, never from the request).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_HTML = 1_500_000;
const MAX_REDIRECTS = 4;
const UA = 'OpenGrowthSiteCheck/1.0 (+https://open-growth-websites.vercel.app)';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/* ---------- SSRF guard ---------- */
function privateV4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
function privateV6(ip: string) {
  const l = ip.toLowerCase();
  return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || /^fe[89ab]/.test(l) || l.startsWith('::ffff:') || l.startsWith('64:ff9b');
}
async function assertPublic(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https addresses are allowed.');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('That port is not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) throw new Error('That address is not allowed.');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { if (privateV4(host)) throw new Error('That address is not allowed.'); return; }
  if (host.includes(':')) { if (privateV6(host)) throw new Error('That address is not allowed.'); return; }
  const v4 = await Deno.resolveDns(host, 'A').catch(() => [] as string[]);
  const v6 = await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]);
  if (v4.length + v6.length === 0) throw new Error('We could not find that website. Check the address.');
  if (v4.some(privateV4) || v6.some(privateV6)) throw new Error('That address is not allowed.');
}

async function readLimited(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { parts.push(value.slice(0, value.length - (total - max))); await reader.cancel(); break; }
    parts.push(value);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new TextDecoder().decode(all);
}

async function safeFetch(start: string, timeoutMs = 10000) {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      await res.body?.cancel();
      continue;
    }
    return { res, finalUrl: url };
  }
  throw new Error('That website redirects too many times.');
}

/* ---------- checks ---------- */
type Check = { id: string; category: string; title: string; status: 'pass' | 'warn' | 'fail'; detail: string; fix: string; weight: number };
const mk = (id: string, category: string, title: string, weight: number, status: Check['status'], detail: string, fix: string): Check =>
  ({ id, category, title, weight, status, detail, fix });

function textOf(html: string) {
  return html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}
function jsonLdTypes(html: string) {
  const types: string[] = [];
  let hasRating = false;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          const o = n as Record<string, unknown>;
          if (o['@type']) types.push(...[o['@type']].flat().map(String));
          if (o.aggregateRating) hasRating = true;
          Object.values(o).forEach(walk);
        }
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore broken JSON-LD */ }
  }
  return { types, hasRating };
}

function runChecks(html: string, finalUrl: URL, robotsOk: boolean, sitemapOk: boolean) {
  const root = parse(html);
  const metas = root.querySelectorAll('meta');
  const meta = (attr: 'name' | 'property', val: string) =>
    metas.find((m) => (m.getAttribute(attr) || '').toLowerCase() === val)?.getAttribute('content')?.trim() || '';
  const title = root.querySelector('title')?.text.trim() || '';
  const desc = meta('name', 'description');
  const h1s = root.querySelectorAll('h1');
  const h2s = root.querySelectorAll('h2');
  const imgs = root.querySelectorAll('img');
  const withAlt = imgs.filter((i) => (i.getAttribute('alt') || '').trim().length > 0).length;
  const links = root.querySelectorAll('a[href]');
  const internal = links.filter((a) => {
    const h = a.getAttribute('href') || '';
    if (!h || h.startsWith('#') || /^(mailto|tel|javascript):/i.test(h)) return false;
    try { return new URL(h, finalUrl).hostname === finalUrl.hostname; } catch { return false; }
  }).length;
  const text = textOf(html);
  const words = text ? text.split(' ').length : 0;
  const robotsMeta = meta('name', 'robots').toLowerCase();
  const canonical = root.querySelectorAll('link').some((l) => (l.getAttribute('rel') || '').toLowerCase() === 'canonical');
  const lang = root.querySelector('html')?.getAttribute('lang') || '';
  const viewport = meta('name', 'viewport');
  const ld = jsonLdTypes(html);
  const hasTel = links.some((a) => /^tel:/i.test(a.getAttribute('href') || ''));
  const postal = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i.test(text);
  const cityMention = /\b(calgary|airdrie|cochrane|chestermere|okotoks|alberta)\b/i.test(text);
  const hasMap = /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page|goo\.gl\/maps/i.test(html);
  const localBiz = ld.types.some((t) => /LocalBusiness|Store|Restaurant|Dentist|Physician|Plumber|Electrician|HVACBusiness|MedicalBusiness|ProfessionalService|AutoRepair|HomeAndConstructionBusiness|LegalService/i.test(t));
  const ogTitle = meta('property', 'og:title');
  const ogImage = meta('property', 'og:image');

  const c: Check[] = [];
  const len = title.length;
  c.push(mk('title', 'seo', 'Page title', 10, !len ? 'fail' : len >= 30 && len <= 65 ? 'pass' : 'warn',
    !len ? 'No page title found.' : `"${title.slice(0, 70)}" (${len} characters)`,
    'Write a title of 30 to 65 characters with your main service and your city, for example "Furnace Repair in Calgary | Your Business".'));
  const dl = desc.length;
  c.push(mk('description', 'seo', 'Meta description', 8, !dl ? 'fail' : dl >= 70 && dl <= 165 ? 'pass' : 'warn',
    !dl ? 'No meta description found.' : `${dl} characters`,
    'Add a meta description of 70 to 160 characters that says what you do, where, and why to call.'));
  c.push(mk('h1', 'seo', 'One main heading (H1)', 8, h1s.length === 1 ? 'pass' : h1s.length === 0 ? 'fail' : 'warn',
    h1s.length === 1 ? `"${h1s[0].text.trim().slice(0, 70)}"` : `${h1s.length} H1 headings found.`,
    'Use exactly one H1 that names your service and location.'));
  c.push(mk('subheadings', 'seo', 'Section headings (H2)', 4, h2s.length >= 2 ? 'pass' : h2s.length === 1 ? 'warn' : 'fail',
    `${h2s.length} H2 headings found.`, 'Break the page into sections with H2 headings so visitors and Google can scan it.'));
  const altRatio = imgs.length ? withAlt / imgs.length : 1;
  c.push(mk('alt', 'seo', 'Image descriptions (alt text)', 6, !imgs.length ? 'pass' : altRatio >= 0.9 ? 'pass' : altRatio >= 0.6 ? 'warn' : 'fail',
    imgs.length ? `${withAlt} of ${imgs.length} images have alt text.` : 'No images found.',
    'Add short, plain descriptions to every meaningful image.'));
  c.push(mk('words', 'seo', 'Amount of content', 6, words >= 300 ? 'pass' : words >= 150 ? 'warn' : 'fail',
    `About ${words} words on the page.`, 'Aim for at least 300 words that explain your services, prices, and the areas you serve.'));
  c.push(mk('links', 'seo', 'Internal links', 4, internal >= 3 ? 'pass' : internal >= 1 ? 'warn' : 'fail',
    `${internal} links to other pages on your site.`, 'Link to your service, pricing and contact pages from this page.'));
  c.push(mk('canonical', 'seo', 'Canonical link', 3, canonical ? 'pass' : 'warn',
    canonical ? 'Canonical link present.' : 'No canonical link found.', 'Add a canonical link so Google knows which address is the main one.'));

  c.push(mk('https', 'technical', 'Secure connection (HTTPS)', 10, finalUrl.protocol === 'https:' ? 'pass' : 'fail',
    finalUrl.protocol === 'https:' ? 'The site loads over HTTPS.' : 'The site loads over plain HTTP.', 'Turn on HTTPS. Most hosts offer a free certificate.'));
  c.push(mk('viewport', 'technical', 'Mobile friendly setup', 8, viewport ? 'pass' : 'fail',
    viewport ? 'Mobile viewport tag found.' : 'No mobile viewport tag.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'));
  c.push(mk('indexable', 'technical', 'Allowed in Google', 10, robotsMeta.includes('noindex') ? 'fail' : 'pass',
    robotsMeta.includes('noindex') ? 'The page tells Google not to list it (noindex).' : 'The page can be listed by Google.', 'Remove the noindex tag so the page can appear in search.'));
  c.push(mk('lang', 'technical', 'Language declared', 2, lang ? 'pass' : 'warn', lang ? `Language: ${lang}` : 'No language set on the page.', 'Add lang="en" to the html tag.'));
  c.push(mk('robots', 'technical', 'robots.txt file', 3, robotsOk ? 'pass' : 'warn', robotsOk ? 'robots.txt found.' : 'No robots.txt found.', 'Add a simple robots.txt that points to your sitemap.'));
  c.push(mk('sitemap', 'technical', 'Sitemap', 4, sitemapOk ? 'pass' : 'warn', sitemapOk ? 'sitemap.xml found.' : 'No sitemap.xml found.', 'Publish a sitemap.xml so Google finds all your pages.'));
  c.push(mk('social', 'technical', 'Link preview (Open Graph)', 3, ogTitle && ogImage ? 'pass' : ogTitle || ogImage ? 'warn' : 'fail',
    ogTitle && ogImage ? 'Title and image set for link previews.' : 'Link preview tags missing or incomplete.', 'Add og:title and og:image so shared links look good.'));

  c.push(mk('tel', 'local', 'Tap-to-call phone number', 10, hasTel ? 'pass' : 'fail',
    hasTel ? 'A tel: link was found.' : 'No tap-to-call link found.', 'Make your phone number a tel: link so mobile visitors can call in one tap.'));
  c.push(mk('city', 'local', 'Your town is mentioned', 8, (postal && cityMention) ? 'pass' : (postal || cityMention) ? 'warn' : 'fail',
    cityMention ? 'A local place name appears on the page.' : 'No local place name found.', 'Mention the towns you serve in your headings and text, and show your full address.'));
  c.push(mk('schema', 'local', 'Local business markup', 8, localBiz ? 'pass' : ld.types.length ? 'warn' : 'fail',
    localBiz ? 'LocalBusiness-style markup found.' : ld.types.length ? `Markup found (${ld.types.slice(0, 3).join(', ')}) but not a local business type.` : 'No structured data found.',
    'Add LocalBusiness structured data with your name, address, phone and hours.'));
  c.push(mk('map', 'local', 'Map or Google profile link', 5, hasMap ? 'pass' : 'warn',
    hasMap ? 'A Google Maps or profile link was found.' : 'No Google Maps or profile link found.', 'Embed your map or link to your Google Business Profile.'));
  c.push(mk('reviews', 'local', 'Review stars in search', 4, ld.hasRating ? 'pass' : 'warn',
    ld.hasRating ? 'Rating markup found.' : 'No rating markup found.', 'Add review markup so stars can show in Google results.'));

  return { checks: c, page: { title, description: desc, words, images: imgs.length, internalLinks: internal } };
}

/* ---------- PageSpeed ---------- */
async function pageSpeed(url: string, strategy: 'mobile' | 'desktop') {
  const key = Deno.env.get('PSI_API_KEY');
  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', strategy);
  for (const cat of ['performance', 'seo', 'accessibility', 'best-practices']) api.searchParams.append('category', cat);
  if (key) api.searchParams.set('key', key);
  const res = await fetch(api, { signal: AbortSignal.timeout(55000) });
  if (!res.ok) throw new Error(`PageSpeed ${res.status}`);
  const j = await res.json();
  const lh = j.lighthouseResult;
  const cat = (k: string) => Math.round((lh.categories?.[k]?.score ?? 0) * 100);
  const a = (k: string) => lh.audits?.[k];
  return {
    performance: cat('performance'), seo: cat('seo'), accessibility: cat('accessibility'), bestPractices: cat('best-practices'),
    fcp: a('first-contentful-paint')?.displayValue ?? null,
    lcp: a('largest-contentful-paint')?.displayValue ?? null,
    lcpMs: a('largest-contentful-paint')?.numericValue ?? null,
    cls: a('cumulative-layout-shift')?.displayValue ?? null,
    tbt: a('total-blocking-time')?.displayValue ?? null,
    speedIndex: a('speed-index')?.displayValue ?? null,
  };
}

const pct = (checks: Check[]) => {
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  return total ? Math.round((got / total) * 100) : 0;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url0 = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url0, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Please sign in.' }, 401);
  const user = userData.user;
  const admin = createClient(url0, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let input = '';
  try { input = String((await req.json())?.url ?? '').trim(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!input || input.length > 500) return json({ error: 'Enter your website address.' }, 400);
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;
  let target: URL;
  try { target = new URL(input); } catch { return json({ error: 'That does not look like a web address.' }, 400); }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('site_scans').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
  const { data: prof } = await admin.from('profiles').select('plan').eq('id', user.id).maybeSingle();
  const limit = scanLimitFor(prof?.plan); // any lookup problem falls back to the Standard limit
  if ((count ?? 0) >= limit) return json({ error: `You have reached the limit of ${limit} scans per hour. Try again later.` }, 429);

  try {
    const { res, finalUrl } = await safeFetch(target.toString());
    if (res.status >= 400) return json({ error: `The website answered with an error (${res.status}).` }, 422);
    if (!(res.headers.get('content-type') || '').toLowerCase().includes('html')) return json({ error: 'That address is not a web page.' }, 422);
    const html = await readLimited(res, MAX_HTML);

    const origin = finalUrl.origin;
    const probe = async (path: string) => {
      try { const r = await safeFetch(origin + path, 6000); await r.res.body?.cancel(); return r.res.status === 200; } catch { return false; }
    };
    const [robotsOk, sitemapOk, mobile, desktop] = await Promise.all([
      probe('/robots.txt'), probe('/sitemap.xml'),
      pageSpeed(finalUrl.toString(), 'mobile').catch((e) => ({ error: String(e.message || e) })),
      pageSpeed(finalUrl.toString(), 'desktop').catch((e) => ({ error: String(e.message || e) })),
    ]);

    const { checks, page } = runChecks(html, finalUrl, robotsOk, sitemapOk);
    const speedOk = mobile && !('error' in mobile);
    if (speedOk) {
      const perf = (mobile as { performance: number }).performance;
      checks.push(mk('speed', 'speed', 'Mobile speed score', 15, perf >= 90 ? 'pass' : perf >= 50 ? 'warn' : 'fail',
        `Google rates your mobile speed ${perf} out of 100.`, 'Compress images, remove unused scripts and use a fast host to raise your mobile speed.'));
    }
    const cats = ['seo', 'technical', 'local', 'speed'];
    const categoryScores: Record<string, number | null> = {};
    for (const k of cats) { const list = checks.filter((c) => c.category === k); categoryScores[k] = list.length ? pct(list) : null; }
    const score = pct(checks);

    const results = {
      url: target.toString(), finalUrl: finalUrl.toString(), fetchedAt: new Date().toISOString(),
      score, categoryScores, checks, page, speed: { mobile, desktop },
    };
    const { data: saved, error: saveErr } = await admin.from('site_scans')
      .insert({ user_id: user.id, url: finalUrl.toString(), score, results }).select('id, created_at').single();
    if (saveErr) return json({ error: 'Could not save the scan.' }, 500);
    return json({ id: saved.id, created_at: saved.created_at, url: finalUrl.toString(), score, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Scan failed.';
    const friendly = /timed out|abort/i.test(msg) ? 'That website took too long to respond.' : msg;
    return json({ error: friendly }, 422);
  }
});
