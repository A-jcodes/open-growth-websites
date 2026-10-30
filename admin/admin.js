/* Open Growth admin: customers, messages, work steps, updates, scans, quotes and leads.
   Access is enforced by Supabase row level security (is_admin()), not by this page. */
(function () {
  'use strict';

  var cfg = window.OG_SUPABASE || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function fmt(iso) {
    try { return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function safeUrl(u) {
    if (!u) return '';
    var s = String(u).trim();
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { var x = new URL(s); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : ''; } catch (e) { return ''; }
  }

  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    $('#viewLoading').innerHTML = '<p class="muted">The admin area is not available right now.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  var S = { user: null, customers: [], msgs: [], quotes: [], leads: [], idx: {}, view: 'customers', selected: null, tab: 'messages', work: [], updates: [], scans: [], payments: [], payErr: false, unreadTotal: -1, timer: null };
  var VIEWS = ['viewLoading', 'viewLogin', 'viewDenied', 'viewAdmin'];
  function show(id) {
    VIEWS.forEach(function (v) { $('#' + v).hidden = v !== id; });
    $('#signOutBtn').hidden = id === 'viewLoading' || id === 'viewLogin';
  }
  function say(el, text, kind) {
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(function () { t.hidden = true; }, 5000);
  }

  /* ---------- sign in and access check ---------- */
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#li-email').value.trim(), pass = $('#li-pass').value, st = $('#loginStatus');
    if (!email || !pass) { say(st, 'Enter your email and password.', 'error'); return; }
    var btn = $('#loginBtn'); btn.disabled = true; say(st, '');
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      btn.disabled = false;
      if (r.error) say(st, /invalid login/i.test(r.error.message || '') ? 'That email and password do not match.' : 'Could not sign in. Please try again.', 'error');
    });
  });
  $('#signOutBtn').addEventListener('click', function () { sb.auth.signOut(); });

  function enter(user) {
    S.user = user;
    sb.rpc('is_admin').then(function (r) {
      if (r.error || r.data !== true) { show('viewDenied'); return; }
      $('#whoAmI').textContent = user.email || '';
      show('viewAdmin');
      refreshAll().then(function () { renderAll(); });
      window.clearInterval(S.timer);
      S.timer = window.setInterval(poll, 15000);
    });
  }
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT') { window.clearInterval(S.timer); S.user = null; show('viewLogin'); return; }
    if (session && session.user && (!S.user || S.user.id !== session.user.id)) { window.setTimeout(function () { enter(session.user); }, 0); }
  });
  sb.auth.getSession().then(function (r) { if (!(r.data && r.data.session)) show('viewLogin'); });

  /* ---------- data ---------- */
  // Profiles with the plan columns (migration 004). Before that migration is applied the extra columns do not exist and the
  // query errors, so fall back to the original column list: the screen then simply shows no Premium badges.
  var PROFILE_COLS = 'id,email,full_name,business_name,website_url,revenue_range,biggest_problem,created_at';
  var PLAN_COLS = ',plan,plan_status,plan_renews_at,plan_cancel_at_period_end';
  var planCols = true;
  function loadProfiles() {
    var q = function (cols) { return sb.from('profiles').select(cols).order('created_at', { ascending: false }).limit(500); };
    if (!planCols) return q(PROFILE_COLS);
    return q(PROFILE_COLS + PLAN_COLS).then(function (r) {
      if (r.error) { planCols = false; return q(PROFILE_COLS); }
      return r;
    });
  }
  function isPremium(c) { return !!c && c.plan === 'premium'; }
  function planChip(c) {
    if (!isPremium(c)) return '';
    var due = c.plan_status === 'past_due';
    return '<span class="plan-chip' + (due ? ' past_due' : '') + '" title="' + (due ? 'Premium, payment failed' : 'Premium customer: reply first') + '">&#9733; Premium' + (due ? ' (payment failed)' : '') + '</span>';
  }
  function refreshAll() {
    return Promise.all([
      loadProfiles(),
      sb.from('messages').select('id,user_id,sender,body,created_at,team_read_at').order('created_at', { ascending: false }).limit(1000),
      sb.from('quote_requests').select('id,user_id,services,budget,timeline,notes,status,created_at').order('created_at', { ascending: false }).limit(300),
      sb.from('leads').select('id,created_at,name,email,revenue_range,biggest_problem,source,offer,crm_synced_at,crm_error').order('created_at', { ascending: false }).limit(300)
    ]).then(function (a) {
      S.customers = a[0].data || []; S.msgs = a[1].data || []; S.quotes = a[2].data || []; S.leads = a[3].data || [];
      index();
    });
  }
  function index() {
    var idx = {}, unread = 0;
    S.customers.forEach(function (c) { idx[c.id] = { last: null, unread: 0 }; });
    S.msgs.forEach(function (m) { // newest first
      var e = idx[m.user_id] || (idx[m.user_id] = { last: null, unread: 0 });
      if (!e.last) e.last = m;
      if (m.sender === 'customer' && !m.team_read_at) { e.unread++; unread++; }
    });
    S.idx = idx;
    if (S.unreadTotal >= 0 && unread > S.unreadTotal) {
      var newest = S.msgs.filter(function (m) { return m.sender === 'customer' && !m.team_read_at; })[0];
      var c = newest && S.customers.filter(function (x) { return x.id === newest.user_id; })[0];
      toast('New message' + (c ? ' from ' + (c.full_name || c.business_name || 'a customer') : ''));
    }
    S.unreadTotal = unread;
    document.title = (unread ? '(' + unread + ') ' : '') + 'Admin | Open Growth';
  }
  function poll() {
    if (document.hidden || $('#viewAdmin').hidden) return;
    refreshAll().then(function () {
      renderNav(); renderList();
      if (S.view === 'quotes') renderQuotes(); if (S.view === 'leads') renderLeads();
      if (S.selected && S.tab === 'messages' && !isTyping()) { renderTab(); }
      if (S.selected) renderHeadCounts();
    });
  }
  function isTyping() { var a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#tabBody').contains(a) && a.value; }
  function loadDetail(id) {
    return Promise.all([
      sb.from('work_items').select('id,title,detail,status,due_date,sort_order').eq('user_id', id).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('activity_feed').select('id,title,body,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
      sb.from('site_scans').select('id,url,score,results,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(10)
    ]).then(function (a) { S.work = a[0].data || []; S.updates = a[1].data || []; S.scans = a[2].data || []; });
  }
  function cust(id) { return S.customers.filter(function (c) { return c.id === id; })[0]; }
  function nameOf(c) { return c ? (c.full_name || c.business_name || c.email || 'Customer') : 'Unknown'; }

  /* ---------- nav and lists ---------- */
  function renderAll() { renderNav(); setView(S.view); }
  function renderNav() {
    var newQuotes = S.quotes.filter(function (q) { return q.status === 'new'; }).length;
    $('#cntCustomers').textContent = S.unreadTotal > 0 ? S.unreadTotal : '';
    $('#cntQuotes').textContent = newQuotes || '';
    $('#cntLeads').textContent = S.leads.length || '';
    ['cntCustomers', 'cntQuotes', 'cntLeads'].forEach(function (id) { var el = $('#' + id); el.hidden = !el.textContent; });
  }
  function setView(v) {
    S.view = v;
    $$('.adm-nav-btn').forEach(function (b) { b.classList.toggle('is-active', b.dataset.view === v); });
    $('#paneCustomers').hidden = v !== 'customers';
    $('#paneQuotes').hidden = v !== 'quotes';
    $('#paneLeads').hidden = v !== 'leads';
    $('#sideList').hidden = v !== 'customers';
    if (v === 'customers') renderList();
    if (v === 'quotes') renderQuotes();
    if (v === 'leads') renderLeads();
  }
  $('#admNav').addEventListener('click', function (e) {
    var b = e.target.closest('.adm-nav-btn'); if (b) setView(b.dataset.view);
  });
  $('#search').addEventListener('input', renderList);

  function renderList() {
    var q = ($('#search').value || '').trim().toLowerCase();
    var rows = S.customers.filter(function (c) {
      return !q || [c.full_name, c.business_name, c.email].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var ea = S.idx[a.id] || {}, eb = S.idx[b.id] || {};
      if ((eb.unread > 0) !== (ea.unread > 0)) return eb.unread > 0 ? 1 : -1;
      // priority replies: among customers waiting on a reply, Premium comes first
      if (ea.unread > 0 && isPremium(a) !== isPremium(b)) return isPremium(a) ? -1 : 1;
      var ta = ea.last ? ea.last.created_at : a.created_at, tb = eb.last ? eb.last.created_at : b.created_at;
      return ta < tb ? 1 : -1;
    });
    $('#custList').innerHTML = rows.length ? rows.map(function (c) {
      var e = S.idx[c.id] || {}, last = e.last;
      return '<li><button type="button" class="cust-item ' + (S.selected === c.id ? 'is-active' : '') + '" data-id="' + esc(c.id) + '">' +
        '<span class="cust-top"><strong>' + esc(nameOf(c)) + '</strong>' + planChip(c) + (e.unread ? '<span class="count">' + e.unread + '</span>' : '') + '</span>' +
        '<span class="muted small">' + esc(c.business_name || c.email || '') + '</span>' +
        '<span class="cust-snip">' + (last ? esc((last.sender === 'team' ? 'You: ' : '') + last.body.slice(0, 70)) : 'No messages yet') + '</span></button></li>';
    }).join('') : '<li class="muted small" style="padding:12px">No customers yet.</li>';
  }
  $('#custList').addEventListener('click', function (e) {
    var b = e.target.closest('.cust-item'); if (!b) return;
    selectCustomer(b.dataset.id);
  });

  function selectCustomer(id) {
    S.selected = id; S.tab = 'messages';
    $('#noSelection').hidden = true; $('#custDetail').hidden = false;
    renderList(); renderHead();
    $$('#cdTabs .chipbtn').forEach(function (x) { x.classList.toggle('is-active', x.dataset.tab === 'messages'); });
    loadDetail(id).then(function () { return loadPayments(id); }).then(renderTab);
    renderTab();
  }
  function renderHead() {
    var c = cust(S.selected); if (!c) return;
    $('#cdName').textContent = nameOf(c);
    $('#cdBiz').textContent = c.business_name || '';
    $('#cdPlan').innerHTML = planChip(c);
    var site = safeUrl(c.website_url);
    var rows = [
      ['Email', c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '-'],
      ['Website', site ? '<a href="' + esc(site) + '" target="_blank" rel="noopener noreferrer">' + esc(c.website_url) + '</a>' : '-'],
      ['Stage', esc(c.revenue_range || '-')],
      ['Joined', esc(fmt(c.created_at))],
      ['Biggest problem', esc(c.biggest_problem || '-')]
    ];
    $('#cdFacts').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('');
    renderHeadCounts();
  }
  function renderHeadCounts() {
    var e = S.idx[S.selected] || {};
    var u = $('#cdUnread'); u.textContent = e.unread || ''; u.hidden = !e.unread;
  }
  $('#cdTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.chipbtn'); if (!b) return;
    S.tab = b.dataset.tab;
    $$('#cdTabs .chipbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
    renderTab();
  });

  /* ---------- customer tabs ---------- */
  function renderTab() {
    if (!S.selected) return;
    var t = S.tab, el = $('#tabBody');
    if (t === 'messages') el.innerHTML = tabMessages();
    else if (t === 'work') el.innerHTML = tabWork();
    else if (t === 'updates') el.innerHTML = tabUpdates();
    else if (t === 'scans') el.innerHTML = tabScans();
    else if (t === 'payments') el.innerHTML = tabPayments();
    else if (t === 'quotes') el.innerHTML = tabQuotes(S.quotes.filter(function (q) { return q.user_id === S.selected; }), false);
    if (t === 'messages') { var log = $('#chatLog', el); if (log) log.scrollTop = log.scrollHeight; markRead(); }
  }
  function tabMessages() {
    var list = S.msgs.filter(function (m) { return m.user_id === S.selected; }).slice().reverse();
    return '<div class="glass chat-card"><div class="chat-log" id="chatLog" role="log" aria-live="polite">' +
      (list.length ? list.map(function (m) {
        return '<div class="bubble ' + (m.sender === 'team' ? 'customer' : 'team') + '">' + esc(m.body) + '<time>' + (m.sender === 'team' ? 'You' : esc(nameOf(cust(S.selected)))) + ' &middot; ' + esc(fmt(m.created_at)) + '</time></div>';
      }).join('') : '<p class="chat-empty">No messages yet.</p>') + '</div>' +
      '<form class="chat-form" data-form="reply" novalidate><label class="sr-only" for="replyBody">Your reply</label><textarea id="replyBody" rows="2" maxlength="4000" placeholder="Write a reply... (Ctrl+Enter to send)"></textarea>' +
      '<button class="btn btn-primary" type="submit">Send reply</button></form><p class="form-status" id="replyStatus" role="status" aria-live="polite"></p></div>';
  }
  var STATUSES = [['planned', 'Planned'], ['in_progress', 'In progress'], ['done', 'Done']];
  function statusSelect(cur, attr) {
    return '<select ' + attr + '>' + STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === cur ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>';
  }
  function tabWork() {
    var items = S.work.map(function (w) {
      return '<form class="w-item glass" data-form="work-save" data-id="' + esc(w.id) + '" novalidate>' +
        '<div class="w-row"><input name="title" maxlength="160" value="' + esc(w.title) + '" aria-label="Step title" />' + statusSelect(w.status, 'name="status" aria-label="Status"') +
        '<input name="due_date" type="date" value="' + esc(w.due_date || '') + '" aria-label="Target date" /></div>' +
        '<textarea name="detail" rows="2" maxlength="1000" aria-label="Details">' + esc(w.detail || '') + '</textarea>' +
        '<div class="w-actions"><button class="btn btn-primary btn-sm" type="submit">Save</button><button class="btn btn-ghost btn-sm" type="button" data-action="work-del" data-id="' + esc(w.id) + '">Delete</button></div></form>';
    }).join('');
    return '<div class="w-list">' + (items || '<p class="muted">No steps yet.</p>') + '</div>' +
      '<h2 class="h3 sec-title">Add a step</h2><form class="w-item glass" data-form="work-add" novalidate>' +
      '<div class="w-row"><input name="title" maxlength="160" placeholder="e.g. Fix your Google Business Profile" aria-label="Step title" />' + statusSelect('planned', 'name="status" aria-label="Status"') +
      '<input name="due_date" type="date" aria-label="Target date" /></div><textarea name="detail" rows="2" maxlength="1000" placeholder="What we will do (optional)" aria-label="Details"></textarea>' +
      '<div class="w-actions"><button class="btn btn-primary btn-sm" type="submit">Add step</button></div></form><p class="form-status" id="workStatus" role="status" aria-live="polite"></p>';
  }
  function tabUpdates() {
    var items = S.updates.map(function (u) {
      return '<li class="glass u-item"><div><strong>' + esc(u.title) + '</strong><time class="muted small">' + esc(fmt(u.created_at)) + '</time>' + (u.body ? '<p class="muted">' + esc(u.body) + '</p>' : '') +
        '</div><button class="btn btn-ghost btn-sm" type="button" data-action="upd-del" data-id="' + esc(u.id) + '">Delete</button></li>';
    }).join('');
    return '<form class="w-item glass" data-form="upd-add" novalidate><div class="w-row"><input name="title" maxlength="160" placeholder="Update title, e.g. Your new page is live" aria-label="Update title" /></div>' +
      '<textarea name="body" rows="3" maxlength="2000" placeholder="A short note for the customer (optional)" aria-label="Update details"></textarea>' +
      '<div class="w-actions"><button class="btn btn-primary btn-sm" type="submit">Post update</button></div></form><p class="form-status" id="updStatus" role="status" aria-live="polite"></p>' +
      '<ul class="u-list">' + (items || '<li class="muted">No updates yet.</li>') + '</ul>';
  }
  function band(n) { return n >= 80 ? 'good' : n >= 55 ? 'ok' : 'bad'; }
  function tabScans() {
    if (!S.scans.length) return '<div class="glass adm-empty"><p class="muted">This customer has not scanned a website yet.</p></div>';
    var latest = S.scans[0], r = latest.results || {}, cs = r.categoryScores || {};
    var issues = (r.checks || []).filter(function (c) { return c.status !== 'pass'; }).sort(function (a, b) { return (b.status === 'fail') - (a.status === 'fail') || b.weight - a.weight; }).slice(0, 6);
    return '<div class="glass scan-sum"><div><p class="card-label">Latest scan</p><p><span class="scan-score ' + band(latest.score || 0) + ' big">' + esc(latest.score) + '</span> <span class="muted">' + esc(latest.url) + ' &middot; ' + esc(fmt(latest.created_at)) + '</span></p></div>' +
      '<div class="cat-line">' + ['seo', 'technical', 'local', 'speed'].map(function (k) { return '<span class="pill">' + esc(k) + ': ' + (cs[k] == null ? '-' : esc(cs[k])) + '</span>'; }).join('') + '</div>' +
      '<p class="card-label" style="margin-top:16px">Biggest gaps</p><ul class="gap-list">' + (issues.map(function (c) { return '<li><span class="pill ' + esc(c.status) + '">' + esc(c.status === 'fail' ? 'Fix now' : 'Improve') + '</span> <strong>' + esc(c.title) + '</strong><span class="muted small"> ' + esc(c.fix) + '</span></li>'; }).join('') || '<li class="muted">Nothing outstanding.</li>') + '</ul></div>' +
      '<h2 class="h3 sec-title">All scans</h2><ul class="scan-list">' + S.scans.map(function (s) { return '<li><div class="scan-item" style="cursor:default"><span class="scan-score ' + band(s.score || 0) + '">' + esc(s.score) + '</span><span class="scan-url">' + esc(s.url) + '</span><span class="muted small">' + esc(fmt(s.created_at)) + '</span></div></li>'; }).join('') + '</ul>';
  }
  /* ---------- payments (Stripe) ----------
     Off until shared/payments-config.js says enabled. Staff only choose who, what and how much; the customer pays on
     Stripe's page, and only the webhook can mark a request paid. Row level security enforces all of this, not this page. */
  var PAYMENTS_ON = !!(window.OG_PAYMENTS && window.OG_PAYMENTS.enabled === true);
  if (PAYMENTS_ON) $('#payTabBtn').hidden = false;
  var PAY_COLS = 'id,user_id,description,kind,amount_cents,setup_fee_cents,status,paid_at,current_period_end,created_at';
  function money(cents) { return '$' + (cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' CAD'; }
  function toCents(v) {
    var s = String(v == null ? '' : v).trim().replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  function loadPayments(uid) {
    if (!PAYMENTS_ON) return Promise.resolve();
    return sb.from('payment_requests').select(PAY_COLS).eq('user_id', uid).order('created_at', { ascending: false }).limit(50).then(function (r) {
      if (uid !== S.selected) return;
      S.payErr = !!r.error; S.payments = r.error ? [] : (r.data || []);
    }, function () { S.payErr = true; S.payments = []; });
  }
  var PAY_STATUS = { pending: ['warn', 'Awaiting payment'], paid: ['pass', 'Paid'], active: ['pass', 'Active plan'], past_due: ['fail', 'Payment problem'], canceled: ['', 'Cancelled'], void: ['', 'Withdrawn'] };
  function tabPayments() {
    if (!PAYMENTS_ON) return '<div class="glass adm-empty"><p class="muted">Online payments are not switched on yet.</p></div>';
    if (S.payErr) return '<div class="glass adm-empty"><p class="muted">Payments are not available yet. The payments database setup has not been applied.</p></div>';
    var rows = S.payments.map(function (p) {
      var st = PAY_STATUS[p.status] || ['', p.status];
      var amt = p.kind === 'subscription' ? money(p.amount_cents) + ' per month' + (p.setup_fee_cents > 0 ? ' + ' + money(p.setup_fee_cents) + ' setup' : '') : money(p.amount_cents) + ' one-time';
      return '<li class="glass pay-row"><div><strong>' + esc(p.description) + '</strong><p class="muted small">' + esc(amt) + ' &middot; ' + esc(fmt(p.created_at)) + '</p></div><div class="w-actions"><span class="pill ' + esc(st[0]) + '">' + esc(st[1]) + '</span>' +
        (p.status === 'pending' ? '<button class="btn btn-ghost btn-sm" type="button" data-action="pay-void" data-id="' + esc(p.id) + '">Withdraw</button>' : '') + '</div></li>';
    }).join('');
    return '<form class="w-item glass pay-form" data-form="pay-add" novalidate><h2 class="h3">Request a payment</h2>' +
      '<div class="w-row"><label>What is it for<input name="description" maxlength="200" placeholder="e.g. Launch website, 50% deposit" /></label>' +
      '<label>Type<select name="kind"><option value="one_time">One-time</option><option value="subscription">Monthly plan</option></select></label>' +
      '<label>Amount (CAD)<input name="amount" inputmode="decimal" placeholder="1500.00" /></label></div>' +
      '<div class="w-row"><label>One-time setup fee (monthly plans only, CAD)<input name="setup" inputmode="decimal" placeholder="0.00" /></label></div>' +
      '<p class="muted small pay-note">The customer sees this in their Payments section and pays through Stripe. Tax is handled in Stripe settings.</p>' +
      '<div class="w-actions"><button class="btn btn-primary btn-sm" type="submit">Send payment request</button></div></form><p class="form-status" id="payStatus" role="status" aria-live="polite"></p>' +
      '<ul class="u-list">' + (rows || '<li class="muted">No payment requests yet.</li>') + '</ul>';
  }
  var QSTAT = ['new', 'contacted', 'quoted', 'won', 'lost'];
  function qStatusSelect(cur, id) {
    return '<select data-action="q-status" data-id="' + esc(id) + '" aria-label="Quote status">' + QSTAT.map(function (s) { return '<option' + (s === cur ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>';
  }
  function tabQuotes(list, withWho) {
    if (!list.length) return '<div class="glass adm-empty"><p class="muted">No quote requests.</p></div>';
    return '<ul class="u-list">' + list.map(function (q) {
      var c = cust(q.user_id);
      return '<li class="glass u-item"><div>' + (withWho ? '<strong><a href="#" data-action="open-cust" data-id="' + esc(q.user_id) + '">' + esc(nameOf(c)) + '</a></strong> <span class="muted small">' + esc(c && c.business_name || '') + '</span><br>' : '') +
        '<strong>' + esc((q.services || []).join(', ') || 'Quote request') + '</strong><p class="muted small">' + esc([q.budget, q.timeline].filter(Boolean).join(' · ')) + ' &middot; ' + esc(fmt(q.created_at)) + '</p>' +
        (q.notes ? '<p class="muted">' + esc(q.notes) + '</p>' : '') + '</div>' + qStatusSelect(q.status, q.id) + '</li>';
    }).join('') + '</ul>';
  }
  function renderQuotes() { $('#quotesBody').innerHTML = '<h1 class="h3" style="margin-bottom:16px">Quote requests</h1>' + tabQuotes(S.quotes, true); }
  function renderLeads() {
    if (!S.leads.length) { $('#leadsBody').innerHTML = '<h1 class="h3" style="margin-bottom:16px">Leads</h1><div class="glass adm-empty"><p class="muted">No leads yet.</p></div>'; return; }
    $('#leadsBody').innerHTML = '<h1 class="h3" style="margin-bottom:16px">Leads</h1><div class="glass tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Name</th><th>Email</th><th>Stage</th><th>Problem</th><th>Source</th><th>Email list</th></tr></thead><tbody>' +
      S.leads.map(function (l) {
        return '<tr><td>' + esc(fmt(l.created_at)) + '</td><td>' + esc(l.name) + '</td><td><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a></td><td>' + esc(l.revenue_range) + '</td><td class="wrap-cell">' + esc(l.biggest_problem) + '</td><td>' + esc(l.source) + '</td><td>' +
          (l.crm_synced_at ? '<span class="pill pass">Added</span>' : l.crm_error ? '<span class="pill warn" title="' + esc(l.crm_error) + '">Pending</span>' : '<span class="pill">Pending</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- actions ---------- */
  function markRead() {
    var e = S.idx[S.selected]; if (!e || !e.unread) return;
    var now = new Date().toISOString();
    sb.from('messages').update({ team_read_at: now }).eq('user_id', S.selected).eq('sender', 'customer').is('team_read_at', null).then(function (r) {
      if (r.error) return;
      S.msgs.forEach(function (m) { if (m.user_id === S.selected && m.sender === 'customer' && !m.team_read_at) m.team_read_at = now; });
      index(); renderNav(); renderList(); renderHeadCounts();
    });
  }
  function reloadMsgs() {
    return sb.from('messages').select('id,user_id,sender,body,created_at,team_read_at').order('created_at', { ascending: false }).limit(1000).then(function (r) { if (r.data) { S.msgs = r.data; index(); renderNav(); renderList(); } });
  }
  function status(id, text, kind) { var el = $('#' + id); if (el) say(el, text, kind); }

  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-form]'); if (!f) return;
    e.preventDefault();
    var kind = f.dataset.form, uid = S.selected;
    if (kind === 'reply') {
      var ta = f.querySelector('textarea'), text = ta.value.trim();
      if (!text) { status('replyStatus', 'Write a reply first.', 'error'); return; }
      sb.from('messages').insert({ user_id: uid, sender: 'team', body: text }).then(function (r) {
        if (r.error) { status('replyStatus', 'Could not send. Please try again.', 'error'); return; }
        ta.value = ''; return reloadMsgs().then(renderTab);
      });
    } else if (kind === 'work-add' || kind === 'work-save') {
      var fd = new FormData(f), title = String(fd.get('title') || '').trim();
      if (!title) { status('workStatus', 'Give the step a title.', 'error'); return; }
      var row = { title: title, detail: String(fd.get('detail') || '').trim() || null, status: String(fd.get('status')), due_date: fd.get('due_date') || null };
      var p;
      if (kind === 'work-add') { row.user_id = uid; row.sort_order = (S.work.reduce(function (m, w) { return Math.max(m, w.sort_order || 0); }, 0)) + 1; p = sb.from('work_items').insert(row); }
      else { row.updated_at = new Date().toISOString(); p = sb.from('work_items').update(row).eq('id', f.dataset.id); }
      p.then(function (r) {
        if (r.error) { status('workStatus', 'Could not save. Please try again.', 'error'); return; }
        return loadDetail(uid).then(function () { renderTab(); status('workStatus', kind === 'work-add' ? 'Step added.' : 'Saved.', 'ok'); });
      });
    } else if (kind === 'pay-add') {
      var pf = new FormData(f), desc = String(pf.get('description') || '').trim(), pk = String(pf.get('kind')) === 'subscription' ? 'subscription' : 'one_time';
      var amt = toCents(pf.get('amount')), setup = String(pf.get('setup') || '').trim() ? toCents(pf.get('setup')) : 0;
      if (desc.length < 3) { status('payStatus', 'Describe what the payment is for.', 'error'); return; }
      if (!(amt >= 50 && amt <= 10000000)) { status('payStatus', 'Enter an amount between 0.50 and 100,000.00.', 'error'); return; }
      if (isNaN(setup) || setup < 0 || setup > 10000000 || (pk === 'one_time' && setup > 0)) { status('payStatus', pk === 'one_time' ? 'A setup fee only applies to monthly plans.' : 'Enter a valid setup fee.', 'error'); return; }
      if (!window.confirm('Send a request for ' + money(amt) + (pk === 'subscription' ? ' per month' : '') + (setup ? ' plus ' + money(setup) + ' setup' : '') + ' to this customer?')) return;
      var sbtn = f.querySelector('button[type=submit]'); sbtn.disabled = true;
      sb.from('payment_requests').insert({ user_id: uid, description: desc, kind: pk, amount_cents: amt, setup_fee_cents: setup }).then(function (r) {
        sbtn.disabled = false;
        if (r.error) { status('payStatus', 'Could not create the request. Payments may not be set up yet.', 'error'); return; }
        return loadPayments(uid).then(function () { renderTab(); status('payStatus', 'Request sent. The customer sees it on their dashboard.', 'ok'); });
      });
    } else if (kind === 'upd-add') {
      var u = new FormData(f), t = String(u.get('title') || '').trim();
      if (!t) { status('updStatus', 'Give the update a title.', 'error'); return; }
      sb.from('activity_feed').insert({ user_id: uid, title: t, body: String(u.get('body') || '').trim() || null }).then(function (r) {
        if (r.error) { status('updStatus', 'Could not post. Please try again.', 'error'); return; }
        return loadDetail(uid).then(function () { renderTab(); status('updStatus', 'Posted. The customer sees it on their dashboard.', 'ok'); });
      });
    }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-action]'); if (!b) return;
    var a = b.dataset.action, id = b.dataset.id;
    if (a === 'work-del') { if (!window.confirm('Delete this step?')) return; sb.from('work_items').delete().eq('id', id).then(function () { loadDetail(S.selected).then(renderTab); }); }
    else if (a === 'upd-del') { if (!window.confirm('Delete this update?')) return; sb.from('activity_feed').delete().eq('id', id).then(function () { loadDetail(S.selected).then(renderTab); }); }
    else if (a === 'pay-void') { if (!window.confirm('Withdraw this payment request? The customer will no longer be able to pay it.')) return; sb.from('payment_requests').update({ status: 'void' }).eq('id', id).eq('status', 'pending').then(function (r) { if (r.error) { toast('Could not withdraw it.'); return; } loadPayments(S.selected).then(renderTab); }); }
    else if (a === 'open-cust') { e.preventDefault(); setView('customers'); selectCustomer(id); }
  });
  document.addEventListener('change', function (e) {
    var s = e.target; if (!(s.dataset && s.dataset.action === 'q-status')) return;
    sb.from('quote_requests').update({ status: s.value }).eq('id', s.dataset.id).then(function (r) {
      if (r.error) { toast('Could not change the status.'); return; }
      S.quotes.forEach(function (q) { if (q.id === s.dataset.id) q.status = s.value; });
      renderNav(); toast('Status set to ' + s.value + '.');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'replyBody') { e.preventDefault(); e.target.form.requestSubmit(); }
  });
})();
