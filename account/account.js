/* Open Growth account: sign up, log in, website scans, quotes.
   Everything is authenticated by Supabase Auth and protected by row level security. */
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
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function icons() { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* decorative */ } }

  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    $('#viewLoading').innerHTML = '<p class="muted">The account system is not available right now. Please try again shortly.</p>';
    return;
  }
  var sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  var redirectTo = window.location.origin + window.location.pathname;

  var state = { user: null, profile: null, scans: [], current: null, filter: 'all', loadedFor: null };

  /* ---------- views ---------- */
  var VIEWS = ['viewLoading', 'viewAuth', 'viewRecovery', 'viewDash'];
  function show(id) {
    VIEWS.forEach(function (v) { $('#' + v).hidden = v !== id; });
    $('#signOutBtn').hidden = id !== 'viewDash';
    window.scrollTo(0, 0);
    icons();
  }
  function say(el, text, kind) {
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
  }
  function fieldErr(id, msg) {
    var el = $('#' + id);
    if (el) el.textContent = msg || '';
    var input = el && el.parentElement && el.parentElement.querySelector('input,select,textarea');
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    var l = $('.btn-label', btn) || btn;
    if (on) { btn.dataset.label = l.textContent; l.textContent = label || 'Please wait...'; } else if (btn.dataset.label) { l.textContent = btn.dataset.label; }
  }
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- tabs ---------- */
  function setTab(which) {
    var signup = which === 'signup';
    $('#tabSignup').classList.toggle('is-active', signup);
    $('#tabLogin').classList.toggle('is-active', !signup);
    $('#tabSignup').setAttribute('aria-selected', String(signup));
    $('#tabLogin').setAttribute('aria-selected', String(!signup));
    $('#panelSignup').hidden = !signup;
    $('#panelLogin').hidden = signup;
  }
  $('#tabSignup').addEventListener('click', function () { setTab('signup'); });
  $('#tabLogin').addEventListener('click', function () { setTab('login'); });
  if (window.location.hash === '#login') setTab('login');
  $$('.pass-toggle').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = $('#' + b.dataset.toggle);
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      b.textContent = showing ? 'Show' : 'Hide';
      b.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });

  /* ---------- sign up ---------- */
  var pendingEmail = '';
  $('#signupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, status = $('#signupStatus');
    var name = f.full_name.value.trim(), biz = f.business_name.value.trim(), site = f.website_url.value.trim();
    var email = f.email.value.trim(), pass = f.password.value;
    var ok = true;
    fieldErr('su-name-err', name.length >= 2 ? '' : 'Please enter your name.'); ok = ok && name.length >= 2;
    fieldErr('su-biz-err', biz.length >= 2 ? '' : 'Please enter your business name.'); ok = ok && biz.length >= 2;
    fieldErr('su-email-err', EMAIL.test(email) ? '' : 'Please enter a valid email.'); ok = ok && EMAIL.test(email);
    fieldErr('su-pass-err', pass.length >= 8 ? '' : 'Use at least 8 characters.'); ok = ok && pass.length >= 8;
    if (!ok) { say(status, 'Please check the highlighted fields.', 'error'); return; }
    say(status, '');
    busy($('#signupBtn'), true, 'Creating account...');
    sb.auth.signUp({
      email: email, password: pass,
      options: { data: { full_name: name, business_name: biz, website_url: site }, emailRedirectTo: redirectTo }
    }).then(function (r) {
      busy($('#signupBtn'), false);
      if (r.error) { say(status, friendly(r.error), 'error'); return; }
      if (r.data && r.data.session) return; // confirmation is off: onAuthStateChange takes over
      pendingEmail = email;
      $('#confirmEmail').textContent = email;
      $('#signupForm').hidden = true;
      $('#confirmNotice').hidden = false;
      $('#confirmNotice').focus();
      icons();
    }).catch(function () { busy($('#signupBtn'), false); say(status, 'Something went wrong. Please try again.', 'error'); });
  });
  $('#resendBtn').addEventListener('click', function () {
    var s = $('#resendStatus');
    if (!pendingEmail) return;
    sb.auth.resend({ type: 'signup', email: pendingEmail, options: { emailRedirectTo: redirectTo } }).then(function (r) {
      say(s, r.error ? friendly(r.error) : 'Sent. Check your inbox.', r.error ? 'error' : 'ok');
    });
  });

  /* ---------- log in ---------- */
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, status = $('#loginStatus');
    var email = f.email.value.trim(), pass = f.password.value;
    fieldErr('li-email-err', EMAIL.test(email) ? '' : 'Please enter a valid email.');
    fieldErr('li-pass-err', pass ? '' : 'Please enter your password.');
    if (!EMAIL.test(email) || !pass) { say(status, 'Please check the highlighted fields.', 'error'); return; }
    say(status, '');
    busy($('#loginBtn'), true, 'Logging in...');
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      busy($('#loginBtn'), false);
      if (r.error) {
        if (/not confirmed/i.test(r.error.message || '')) { pendingEmail = email; }
        say(status, friendly(r.error), 'error');
      }
    }).catch(function () { busy($('#loginBtn'), false); say(status, 'Something went wrong. Please try again.', 'error'); });
  });
  $('#forgotBtn').addEventListener('click', function () {
    var email = $('#li-email').value.trim(), status = $('#loginStatus');
    if (!EMAIL.test(email)) { fieldErr('li-email-err', 'Enter your email above first.'); $('#li-email').focus(); return; }
    fieldErr('li-email-err', '');
    sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo }).then(function (r) {
      say(status, r.error ? friendly(r.error) : 'If that email has an account, a reset link is on its way.', r.error ? 'error' : 'ok');
    });
  });
  $('#recoveryForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = e.target.password.value, status = $('#recoveryStatus');
    if (pass.length < 8) { say(status, 'Use at least 8 characters.', 'error'); return; }
    sb.auth.updateUser({ password: pass }).then(function (r) {
      if (r.error) { say(status, friendly(r.error), 'error'); return; }
      say(status, 'Password updated.', 'ok');
      window.setTimeout(function () { enterDashboard(r.data.user); }, 700);
    });
  });
  $('#signOutBtn').addEventListener('click', function () { sb.auth.signOut(); });

  function friendly(err) {
    var m = (err && err.message) || '';
    if (/invalid login/i.test(m)) return 'That email and password do not match.';
    if (/not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link.';
    if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Try logging in.';
    if (/rate limit|too many|after \d+ seconds/i.test(m)) return 'Too many tries. Please wait a few minutes and try again.';
    if (/password/i.test(m)) return m;
    return 'Something went wrong. Please try again.';
  }

  /* ---------- session handling ---------- */
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') { show('viewRecovery'); return; }
    if (event === 'SIGNED_OUT') { state = { user: null, profile: null, scans: [], current: null, filter: 'all', loadedFor: null }; show('viewAuth'); return; }
    if (session && session.user) {
      if (state.loadedFor === session.user.id) return;
      // Defer so we never call Supabase inside its own auth callback
      window.setTimeout(function () { enterDashboard(session.user); }, 0);
    }
  });
  sb.auth.getSession().then(function (r) {
    if (!(r.data && r.data.session)) show('viewAuth');
  });

  /* ---------- dashboard ---------- */
  function enterDashboard(user) {
    state.user = user;
    state.loadedFor = user.id;
    show('viewDash');
    Promise.all([
      sb.from('profiles').select('full_name,business_name,website_url').eq('id', user.id).maybeSingle(),
      sb.from('site_scans').select('id,url,score,results,created_at').order('created_at', { ascending: false }).limit(20),
      sb.from('quote_requests').select('id,services,budget,timeline,status,created_at').order('created_at', { ascending: false }).limit(10)
    ]).then(function (all) {
      state.profile = (all[0].data) || {};
      state.scans = (all[1].data) || [];
      renderHeader();
      renderScans();
      renderQuotes((all[2].data) || []);
    });
  }
  function firstName() { var n = (state.profile && state.profile.full_name) || ''; return n.trim().split(/\s+/)[0] || ''; }
  function renderHeader() {
    $('#dashName').textContent = firstName() ? ', ' + firstName() : '';
    var site = (state.profile && state.profile.website_url) || '';
    if (site && !$('#scanUrl').value) $('#scanUrl').value = site;
    $('#dashSub').textContent = state.scans.length
      ? 'Here is where your website stands. Scan again after you make changes.'
      : 'Add your website below and we will score it.';
  }

  /* ---------- scanning ---------- */
  var stepTimer = null;
  function runSteps(on) {
    var list = $('#scanSteps'), items = $$('li', list), i = 0;
    window.clearInterval(stepTimer);
    items.forEach(function (li) { li.className = ''; });
    list.hidden = !on;
    if (!on) return;
    items[0].className = 'is-now';
    stepTimer = window.setInterval(function () {
      if (i < items.length - 1) { items[i].className = 'is-done'; i++; items[i].className = 'is-now'; }
    }, 7000);
  }
  $('#scanForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = $('#scanUrl').value.trim(), status = $('#scanStatus');
    if (!url) { say(status, 'Enter your website address.', 'error'); $('#scanUrl').focus(); return; }
    say(status, '');
    busy($('#scanBtn'), true, 'Scanning...');
    runSteps(true);
    sb.functions.invoke('analyze-site', { body: { url: url } }).then(function (r) {
      if (r.error) {
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().then(function (j) { throw new Error(j && j.error ? j.error : 'The scan failed.'); }, function () { throw new Error('The scan failed.'); });
        }
        throw new Error('The scan failed.');
      }
      return r.data;
    }).then(function (scan) {
      state.scans.unshift({ id: scan.id, url: scan.url, score: scan.score, results: scan.results, created_at: scan.created_at });
      state.scans = state.scans.slice(0, 20);
      if (!(state.profile && state.profile.website_url)) {
        sb.from('profiles').update({ website_url: url }).eq('id', state.user.id).then(function () {
          state.profile = state.profile || {}; state.profile.website_url = url;
        });
      }
      renderScans(0);
      renderHeader();
      say(status, 'Done. Your report is below.', 'ok');
      var top = $('#results'); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }).catch(function (err) {
      say(status, err.message || 'The scan failed.', 'error');
    }).then(function () { busy($('#scanBtn'), false); runSteps(false); });
  });

  /* ---------- rendering results ---------- */
  function band(score) { return score >= 80 ? 'good' : score >= 55 ? 'ok' : 'bad'; }
  function verdict(score) {
    return score >= 80 ? 'Strong. A few tweaks will make it great.' : score >= 55 ? 'Decent, with clear room to win more calls.' : 'Needs work. The fixes below will help most.';
  }
  function ring(score, size, stroke, label) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score == null ? 0 : score));
    var gid = 'g' + Math.random().toString(36).slice(2, 8);
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8f7bff"/><stop offset="1" stop-color="#3ee0ff"/></linearGradient></defs>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="' + stroke + '"/>' +
      '<circle class="ring-arc ' + band(v) + '" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="url(#' + gid + ')" stroke-width="' + stroke + '" stroke-linecap="round" ' +
      'stroke-dasharray="' + (c * v / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>' +
      '<span class="ring-num ' + band(v) + '">' + (score == null ? '–' : Math.round(v)) + (label ? '<small>' + esc(label) + '</small>' : '') + '</span>';
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function renderScans(index) {
    var has = state.scans.length > 0;
    $('#emptyState').hidden = has;
    $('#results').hidden = !has;
    $('#historyWrap').hidden = state.scans.length < 1;
    if (!has) return;
    state.current = state.scans[index || 0];
    renderScan(state.current);
    renderHistory();
  }
  var CAT = { seo: 'On-page SEO', technical: 'Technical', local: 'Local search', speed: 'Speed' };
  function renderScan(scan) {
    var r = scan.results || {};
    var score = scan.score != null ? scan.score : r.score;
    $('#mainRing').innerHTML = ring(score, 168, 12, 'out of 100');
    $('#mainRing').setAttribute('aria-label', 'Overall score ' + score + ' out of 100');
    $('#scoreVerdict').textContent = verdict(score);
    $('#scoreMeta').textContent = (r.finalUrl || scan.url || '') + '  ·  ' + fmtDate(scan.created_at);

    var cs = r.categoryScores || {};
    $('#cats').innerHTML = Object.keys(CAT).map(function (k) {
      var v = cs[k];
      return '<div class="cat"><div class="mini-ring">' + ring(v, 64, 6, '') + '</div><div><strong>' + esc(CAT[k]) + '</strong><span class="muted small">' +
        (v == null ? 'Not available' : band(v) === 'good' ? 'Looking good' : band(v) === 'ok' ? 'Could be better' : 'Needs attention') + '</span></div></div>';
    }).join('');

    var checks = (r.checks || []).slice();
    var rank = { fail: 2, warn: 1, pass: 0 };
    var first = checks.filter(function (c) { return c.status !== 'pass'; })
      .sort(function (a, b) { return (rank[b.status] * b.weight) - (rank[a.status] * a.weight); }).slice(0, 4);
    $('#firstList').innerHTML = first.length
      ? first.map(function (c) { return '<li><strong>' + esc(c.title) + '</strong><span>' + esc(c.fix) + '</span></li>'; }).join('')
      : '<li><strong>Nothing urgent.</strong><span>Every check passed. Keep your content fresh and ask for reviews.</span></li>';

    renderSpeed(r.speed);
    renderChecks();
  }
  function metric(label, value, hint, tone) {
    return '<div class="metric glass"><span class="metric-label">' + esc(label) + '</span><span class="metric-val ' + (tone || '') + '">' + esc(value == null ? '–' : value) + '</span>' +
      (hint ? '<span class="metric-hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function renderSpeed(speed) {
    var m = speed && speed.mobile, d = speed && speed.desktop;
    if (!m || m.error) {
      $('#speedWrap').innerHTML = '<div class="glass notice-inline">Google speed data was not available for this scan' +
        (m && m.error ? ' (' + esc(m.error) + ')' : '') + '. This usually clears up in a minute. Scan again to retry.</div>';
      return;
    }
    var html = metric('Mobile speed', m.performance, 'out of 100', band(m.performance)) +
      (d && !d.error ? metric('Desktop speed', d.performance, 'out of 100', band(d.performance)) : '') +
      metric('Largest content', m.lcp, 'mobile, under 2.5 s is good') +
      metric('Layout shift', m.cls, 'mobile, under 0.1 is good') +
      metric('Blocking time', m.tbt, 'mobile, under 200 ms is good') +
      metric('First paint', m.fcp, 'mobile') +
      metric('Google SEO score', m.seo, 'from Lighthouse', band(m.seo)) +
      metric('Accessibility', m.accessibility, 'from Lighthouse', band(m.accessibility));
    $('#speedWrap').innerHTML = html;
  }
  var ICON = { pass: 'check', warn: 'alert-triangle', fail: 'x' };
  var LABEL = { pass: 'Passed', warn: 'Improve', fail: 'Fix now' };
  function renderChecks() {
    var scan = state.current; if (!scan) return;
    var checks = ((scan.results || {}).checks || []).filter(function (c) { return state.filter === 'all' || c.status === state.filter; });
    var order = { fail: 0, warn: 1, pass: 2 };
    checks.sort(function (a, b) { return order[a.status] - order[b.status] || b.weight - a.weight; });
    $('#checks').innerHTML = checks.length ? checks.map(function (c) {
      return '<article class="check ' + esc(c.status) + '"><span class="check-ico" aria-hidden="true"><i data-lucide="' + ICON[c.status] + '"></i></span>' +
        '<div><div class="check-head"><strong>' + esc(c.title) + '</strong><span class="pill ' + esc(c.status) + '">' + LABEL[c.status] + '</span><span class="pill cat">' + esc(CAT[c.category] || c.category) + '</span></div>' +
        '<p class="muted">' + esc(c.detail) + '</p>' + (c.status !== 'pass' ? '<p class="fix"><b>How to fix:</b> ' + esc(c.fix) + '</p>' : '') + '</div></article>';
    }).join('') : '<p class="muted">Nothing in this group.</p>';
    icons();
  }
  $$('.chipbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.filter = b.dataset.filter;
      $$('.chipbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      renderChecks();
    });
  });

  function renderHistory() {
    var scans = state.scans.slice().reverse().slice(-12);
    var w = 560, h = 120, pad = 14;
    if (scans.length < 2) {
      $('#spark').innerHTML = '<p class="muted small">Run another scan later to see your score change over time.</p>';
    } else {
      var pts = scans.map(function (s, i) {
        var x = pad + (w - 2 * pad) * (i / (scans.length - 1));
        var y = h - pad - (h - 2 * pad) * ((s.score || 0) / 100);
        return [x, y];
      });
      var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      $('#spark').innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sparkG" x1="0" x2="1"><stop offset="0" stop-color="#8f7bff"/><stop offset="1" stop-color="#3ee0ff"/></linearGradient></defs>' +
        '<polyline points="' + line + '" fill="none" stroke="url(#sparkG)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
        pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="#06060b" stroke="#3ee0ff" stroke-width="2"/>'; }).join('') + '</svg>';
    }
    $('#scanList').innerHTML = state.scans.map(function (s, i) {
      return '<li><button type="button" class="scan-item ' + (state.current && s.id === state.current.id ? 'is-active' : '') + '" data-i="' + i + '">' +
        '<span class="scan-score ' + band(s.score || 0) + '">' + esc(s.score) + '</span><span class="scan-url">' + esc(s.url) + '</span><span class="muted small">' + esc(fmtDate(s.created_at)) + '</span></button></li>';
    }).join('');
    $$('.scan-item').forEach(function (b) {
      b.addEventListener('click', function () { renderScans(parseInt(b.dataset.i, 10)); window.scrollTo({ top: $('#results').offsetTop - 80, behavior: reduceMotion ? 'auto' : 'smooth' }); });
    });
  }

  /* ---------- quotes ---------- */
  function renderQuotes(list) {
    $('#quoteEmpty').hidden = list.length > 0;
    $('#quoteList').innerHTML = list.map(function (q) {
      return '<li><strong>' + esc((q.services || []).join(', ') || 'Quote request') + '</strong><span class="muted small">' +
        esc([q.budget, q.timeline].filter(Boolean).join(' · ')) + '</span><span class="small"><span class="pill ' + (q.status === 'new' ? 'warn' : 'pass') + '">' +
        esc(q.status === 'new' ? 'Received' : q.status) + '</span> ' + esc(fmtDate(q.created_at)) + '</span></li>';
    }).join('');
  }
  $('#quoteForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, status = $('#quoteStatus');
    var services = $$('input[name="services"]:checked', f).map(function (i) { return i.value; });
    if (!services.length) { fieldErr('q-services-err', 'Pick at least one.'); say(status, 'Choose what you need help with.', 'error'); return; }
    fieldErr('q-services-err', '');
    say(status, '');
    busy($('#quoteBtn'), true, 'Sending...');
    var row = { services: services, budget: f.budget.value || null, timeline: f.timeline.value || null, notes: f.notes.value.trim() || null };
    sb.from('quote_requests').insert(row).then(function (r) {
      busy($('#quoteBtn'), false);
      if (r.error) { say(status, 'We could not send that. Please try again.', 'error'); return; }
      f.reset();
      say(status, 'Request sent. Austin will reply within 1 business day.', 'ok');
      return sb.from('quote_requests').select('id,services,budget,timeline,status,created_at').order('created_at', { ascending: false }).limit(10).then(function (q) { renderQuotes(q.data || []); });
    }).catch(function () { busy($('#quoteBtn'), false); say(status, 'We could not send that. Please try again.', 'error'); });
  });

  icons();
})();
