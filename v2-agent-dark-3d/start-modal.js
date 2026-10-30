/* Open Growth "Start" pop-up: a short step-by-step form that creates the customer's account.
   Steps: name, email + password, business, stage, biggest problem. Then it signs them in and
   sends them to their dashboard. Also has a log-in view for returning customers. */
(function () {
  'use strict';

  var cfg = window.OG_SUPABASE || {};
  var STAGES = [
    { label: 'Just starting out', range: 'Under $1k / mo', value: '$0 - $1,000' },
    { label: 'Getting traction', range: '$1k - $10k / mo', value: '$1,000 - $10,000' },
    { label: 'Growing', range: '$10k - $100k / mo', value: '$10,000 - $100,000' },
    { label: 'Established', range: '$100k - $1M / mo', value: '$100,000 - $1 million' },
    { label: 'Scaled', range: '$1M+ / mo', value: '$1 million+' }
  ];
  var TOTAL = 5;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var client = null;
  if (window.supabase && cfg.url && cfg.anonKey) {
    client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }

  var root, dialog, body, bars, state;
  function fresh() { return { step: 1, view: 'steps', d: { name: '', email: '', password: '', business: '', website: '', stage: '', problem: '' }, busy: false }; }
  state = fresh();
  var lastFocus = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- build ---------- */
  function build() {
    root = document.createElement('div');
    root.className = 'sm-overlay';
    root.hidden = true;
    root.setAttribute('data-lenis-prevent', '');
    var segs = '';
    for (var i = 0; i < TOTAL; i++) segs += '<span class="sm-seg"></span>';
    root.innerHTML =
      '<div class="sm-dialog" role="dialog" aria-modal="true" aria-labelledby="sm-title" tabindex="-1">' +
        '<div class="sm-head">' +
          '<svg class="sm-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="smGrad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8f7bff"/><stop offset="1" stop-color="#3ee0ff"/></linearGradient></defs>' +
          '<path d="M7 22 L13.5 15.5 L18 19 L25 10" fill="none" stroke="url(#smGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="10" r="2.4" fill="#3ee0ff"/></svg>' +
          '<span class="sm-brand">Your free dashboard</span>' +
          '<div class="sm-bars" aria-hidden="true">' + segs + '</div>' +
          '<button class="sm-close" type="button" data-action="close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="sm-body" id="sm-body" aria-live="polite"></div>' +
      '</div>';
    document.body.appendChild(root);
    dialog = root.querySelector('.sm-dialog');
    body = root.querySelector('#sm-body');
    bars = root.querySelectorAll('.sm-seg');

    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.field) { state.d[t.dataset.field] = t.value; t.removeAttribute('aria-invalid'); var er = root.querySelector('.sm-err'); if (er) er.textContent = ''; }
    });
  }

  /* ---------- rendering ---------- */
  function field(id, label, type, value, extra) {
    extra = extra || {};
    return '<div class="sm-field"><label for="' + id + '">' + label + '</label>' +
      '<input id="' + id + '" data-field="' + extra.field + '" type="' + type + '" value="' + esc(value) + '"' +
      (extra.auto ? ' autocomplete="' + extra.auto + '"' : '') + (extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') +
      (extra.mode ? ' inputmode="' + extra.mode + '"' : '') + (extra.first ? ' data-autofocus' : '') + ' /></div>';
  }
  var STEPS = {
    1: function (d) {
      return '<p class="sm-step">Step 1 of 5</p><h2 id="sm-title" class="sm-title">First, what\'s your name?</h2>' +
        '<p class="sm-sub">Takes about 40 seconds. We never share your details.</p>' +
        field('sm-name', 'Your name', 'text', d.name, { field: 'name', auto: 'name', ph: 'Jack', first: true }) +
        '<p class="sm-err" role="alert"></p>' +
        '<div class="sm-actions"><span class="sm-link-wrap">Already have an account? <button class="sm-link" type="button" data-action="login">Log in</button></span>' +
        '<button class="sm-btn" type="button" data-action="next">Continue <span aria-hidden="true">&rarr;</span></button></div>';
    },
    2: function (d) {
      return '<p class="sm-step">Step 2 of 5</p><h2 id="sm-title" class="sm-title">What\'s your email?</h2>' +
        '<p class="sm-sub">This is how you will log in to your dashboard.</p>' +
        field('sm-email', 'Email', 'email', d.email, { field: 'email', auto: 'email', ph: 'you@yourbusiness.ca', mode: 'email', first: true }) +
        field('sm-pass', 'Choose a password <span class="sm-opt">(8 characters or more)</span>', 'password', d.password, { field: 'password', auto: 'new-password' }) +
        '<p class="sm-err" role="alert"></p>' +
        '<div class="sm-actions"><button class="sm-back" type="button" data-action="back">&larr; Back</button>' +
        '<button class="sm-btn" type="button" data-action="next">Continue <span aria-hidden="true">&rarr;</span></button></div>';
    },
    3: function (d) {
      return '<p class="sm-step">Step 3 of 5</p><h2 id="sm-title" class="sm-title">Tell us about your business.</h2>' +
        '<p class="sm-sub">We scan your website for you as soon as you are in.</p>' +
        field('sm-biz', 'Business name', 'text', d.business, { field: 'business', auto: 'organization', ph: 'Smith Plumbing', first: true }) +
        field('sm-site', 'Website <span class="sm-opt">(leave blank if you don\'t have one)</span>', 'text', d.website, { field: 'website', auto: 'url', ph: 'yourbusiness.ca', mode: 'url' }) +
        '<p class="sm-err" role="alert"></p>' +
        '<div class="sm-actions"><button class="sm-back" type="button" data-action="back">&larr; Back</button>' +
        '<button class="sm-btn" type="button" data-action="next">Continue <span aria-hidden="true">&rarr;</span></button></div>';
    },
    4: function (d) {
      var opts = STAGES.map(function (s, i) {
        return '<label class="sm-opt-row"><input type="radio" name="sm-stage" value="' + esc(s.value) + '"' + (d.stage === s.value ? ' checked' : '') + (i === 0 ? ' data-autofocus' : '') + ' />' +
          '<span><b>' + esc(s.label) + '</b><i>' + esc(s.range) + '</i></span></label>';
      }).join('');
      return '<p class="sm-step">Step 4 of 5</p><h2 id="sm-title" class="sm-title">Roughly where\'s the business at?</h2>' +
        '<p class="sm-sub">Helps us tailor your plan to your stage. Honest answers only.</p>' +
        '<div class="sm-opts" role="radiogroup" aria-label="Business stage">' + opts + '</div>' +
        '<p class="sm-err" role="alert"></p>' +
        '<div class="sm-actions"><button class="sm-back" type="button" data-action="back">&larr; Back</button></div>';
    },
    5: function (d) {
      return '<p class="sm-step">Step 5 of 5</p><h2 id="sm-title" class="sm-title">What\'s the biggest thing slowing you down right now?</h2>' +
        '<p class="sm-sub">A sentence is fine. The more specific, the sharper your plan.</p>' +
        '<div class="sm-field"><label class="sr-only" for="sm-problem">Biggest problem</label>' +
        '<textarea id="sm-problem" data-field="problem" rows="4" maxlength="2000" placeholder="e.g. Lots of website visits, almost no calls. The phone is quiet." data-autofocus>' + esc(d.problem) + '</textarea></div>' +
        '<p class="sm-err" role="alert"></p>' +
        '<div class="sm-actions"><button class="sm-back" type="button" data-action="back">&larr; Back</button>' +
        '<button class="sm-btn" type="button" data-action="finish">Create my dashboard <span aria-hidden="true">&rarr;</span></button></div>' +
        '<p class="sm-lock-note">We will use this to build your plan and email you about your dashboard.</p>';
    }
  };
  var VIEWS = {
    login: function () {
      return '<h2 id="sm-title" class="sm-title">Welcome back</h2><p class="sm-sub">Log in to see your dashboard.</p>' +
        field('sm-li-email', 'Email', 'email', state.d.email, { field: 'email', auto: 'email', mode: 'email', first: true }) +
        field('sm-li-pass', 'Password', 'password', '', { field: 'loginPass', auto: 'current-password' }) +
        '<p class="sm-err" role="alert"></p>' +
        '<div class="sm-actions"><button class="sm-back" type="button" data-action="tosteps">&larr; Create an account instead</button>' +
        '<button class="sm-btn" type="button" data-action="dologin">Log in <span aria-hidden="true">&rarr;</span></button></div>' +
        '<p class="sm-lock-note"><a class="sm-link" href="../account/">Forgot your password?</a></p>';
    },
    working: function () {
      return '<div class="sm-center" data-autofocus tabindex="-1"><div class="sm-check" aria-hidden="true">&#10003;</div><h2 id="sm-title" class="sm-title">Spinning up your dashboard&hellip;</h2>' +
        '<p class="sm-sub">Creating your account and getting your website ready to scan. This takes a second.</p></div>';
    },
    confirm: function () {
      return '<div class="sm-center" data-autofocus tabindex="-1"><div class="sm-check" aria-hidden="true">&#9993;</div><h2 id="sm-title" class="sm-title">Check your email</h2>' +
        '<p class="sm-sub">We sent a confirmation link to <b>' + esc(state.d.email) + '</b>. Click it to finish setting up your dashboard.</p>' +
        '<p class="sm-lock-note">Nothing yet? Check spam, or <button class="sm-link" type="button" data-action="resend">send it again</button>.</p><p class="sm-err sm-ok" role="status"></p>' +
        '<div class="sm-actions center"><button class="sm-btn ghost" type="button" data-action="close">Close</button></div></div>';
    },
    exists: function () {
      return '<div class="sm-center" data-autofocus tabindex="-1"><h2 id="sm-title" class="sm-title">You already have an account</h2>' +
        '<p class="sm-sub">There is already an account for <b>' + esc(state.d.email) + '</b>. Log in to see your dashboard.</p>' +
        '<div class="sm-actions center"><button class="sm-btn" type="button" data-action="login">Log in <span aria-hidden="true">&rarr;</span></button></div></div>';
    }
  };

  function render() {
    var isSteps = state.view === 'steps';
    for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('on', isSteps ? i < state.step : (state.view !== 'login'));
    body.innerHTML = isSteps ? STEPS[state.step](state.d) : VIEWS[state.view]();
    if (!calm) { body.classList.remove('sm-in'); void body.offsetWidth; body.classList.add('sm-in'); }
    var f = body.querySelector('[data-autofocus]');
    if (f) window.setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }, 30);
  }

  /* ---------- behaviour ---------- */
  function err(msg, input) {
    var el = body.querySelector('.sm-err');
    if (el) el.textContent = msg || '';
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
  }
  function validate(step) {
    var d = state.d;
    if (step === 1) { if (d.name.trim().length < 2) { err('Please enter your name.', body.querySelector('#sm-name')); return false; } }
    if (step === 2) {
      if (!EMAIL.test(d.email.trim())) { err('Please enter a valid email.', body.querySelector('#sm-email')); return false; }
      if ((d.password || '').length < 8) { err('Use at least 8 characters for your password.', body.querySelector('#sm-pass')); return false; }
    }
    if (step === 3) { if (d.business.trim().length < 2) { err('Please enter your business name.', body.querySelector('#sm-biz')); return false; } }
    if (step === 4) { if (!d.stage) { err('Pick the one that fits best.'); return false; } }
    return true;
  }
  function go(step) { state.step = Math.max(1, Math.min(TOTAL, step)); state.view = 'steps'; render(); }
  function next() { if (!validate(state.step)) return; if (state.step < TOTAL) go(state.step + 1); }

  function friendly(e) {
    var m = (e && e.message) || '';
    if (/rate limit|too many|after \d+ seconds/i.test(m)) return 'Too many tries. Please wait a few minutes and try again.';
    if (/password/i.test(m)) return m;
    if (/invalid login/i.test(m)) return 'That email and password do not match.';
    if (/not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link.';
    return 'Something went wrong. Please try again.';
  }

  function celebrate() {
    if (calm) return;
    var colors = ['#ff6ec7', '#ffb86b', '#ffe66b', '#6bffb3', '#6bc7ff', '#a98bff'];
    var fire = function () {
      try {
        window.confetti({ particleCount: 150, spread: 90, startVelocity: 42, origin: { y: 0.6 }, colors: colors, zIndex: 100000 });
        window.setTimeout(function () {
          window.confetti({ particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: colors, zIndex: 100000 });
          window.confetti({ particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: colors, zIndex: 100000 });
        }, 220);
      } catch (e) { /* decorative */ }
    };
    if (typeof window.confetti === 'function') { fire(); return; }
    var s = document.createElement('script');
    s.src = '../shared/vendor/confetti.browser.min.js';
    s.onload = fire;
    document.head.appendChild(s);
  }

  function finish() {
    if (state.busy) return;
    var d = state.d;
    if (d.problem.trim().length < 3) { err('Tell us the biggest problem, even in a few words.', body.querySelector('#sm-problem')); return; }
    if (!client) { err('Sign-up is not available right now. Please try again shortly.'); return; }
    state.busy = true;
    state.view = 'working'; render();

    // Save the lead for follow-up (never blocks the sign-up)
    if (window.OGLeads) {
      window.OGLeads.submit({ name: d.name.trim(), email: d.email.trim(), revenue_range: d.stage, biggest_problem: d.problem.trim(), source: 'v2-popup', offer: 'calls-checklist' }).catch(function () {});
    }

    client.auth.signUp({
      email: d.email.trim(), password: d.password,
      options: {
        data: { full_name: d.name.trim(), business_name: d.business.trim(), website_url: d.website.trim(), revenue_range: d.stage, biggest_problem: d.problem.trim() },
        emailRedirectTo: window.location.origin + '/account/'
      }
    }).then(function (r) {
      state.busy = false;
      if (r.error) { state.view = 'steps'; state.step = /password/i.test(r.error.message || '') ? 2 : 5; render(); err(friendly(r.error)); return; }
      var user = r.data && r.data.user;
      if (user && user.identities && user.identities.length === 0) { state.view = 'exists'; render(); return; }
      if (r.data && r.data.session) {
        celebrate();
        window.setTimeout(function () { window.location.href = '../account/'; }, calm ? 600 : 2200);
        return;
      }
      state.view = 'confirm'; render();
    }).catch(function () {
      state.busy = false; state.view = 'steps'; state.step = 5; render(); err('Something went wrong. Please try again.');
    });
  }

  function doLogin() {
    var email = (state.d.email || '').trim(), pass = state.d.loginPass || '';
    if (!EMAIL.test(email)) { err('Please enter a valid email.', body.querySelector('#sm-li-email')); return; }
    if (!pass) { err('Please enter your password.', body.querySelector('#sm-li-pass')); return; }
    if (!client || state.busy) return;
    state.busy = true;
    var btn = body.querySelector('[data-action="dologin"]'); if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
    client.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      state.busy = false;
      if (r.error) { if (btn) { btn.disabled = false; btn.innerHTML = 'Log in <span aria-hidden="true">&rarr;</span>'; } err(friendly(r.error)); return; }
      window.location.href = '../account/';
    }).catch(function () { state.busy = false; err('Something went wrong. Please try again.'); });
  }

  function resend() {
    var out = body.querySelector('.sm-err');
    client.auth.resend({ type: 'signup', email: state.d.email.trim(), options: { emailRedirectTo: window.location.origin + '/account/' } }).then(function (r) {
      if (out) out.textContent = r.error ? friendly(r.error) : 'Sent. Check your inbox.';
    });
  }

  function onClick(e) {
    var stage = e.target.closest && e.target.closest('input[name="sm-stage"]');
    if (stage) { state.d.stage = stage.value; window.setTimeout(function () { go(5); }, calm ? 0 : 260); return; }
    var btn = e.target.closest && e.target.closest('[data-action]');
    if (!btn) return;
    var a = btn.dataset.action;
    if (a === 'close') close();
    else if (a === 'next') next();
    else if (a === 'back') go(state.step - 1);
    else if (a === 'finish') finish();
    else if (a === 'login') { state.view = 'login'; render(); }
    else if (a === 'tosteps') { go(1); }
    else if (a === 'dologin') doLogin();
    else if (a === 'resend') resend();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'radio') {
      e.preventDefault();
      if (state.view === 'login') doLogin();
      else if (state.view === 'steps') { if (state.step === TOTAL) finish(); else next(); }
      return;
    }
    if (e.key === 'Tab') {
      var f = Array.prototype.slice.call(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, a[href], [tabindex="0"]'))
        .filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function open(opts) {
    opts = opts || {};
    if (!root) build();
    lastFocus = document.activeElement;
    if (state.view === 'working') return;
    state = fresh();
    if (opts.name && opts.name.trim().length >= 2) { state.d.name = opts.name.trim(); state.step = 2; }
    if (opts.login) state.view = 'login';
    root.hidden = false;
    document.documentElement.classList.add('sm-lock');
    render();
    if (!calm) { dialog.classList.remove('sm-pop'); void dialog.offsetWidth; dialog.classList.add('sm-pop'); }
  }
  function close() {
    if (!root || state.busy) return;
    root.hidden = true;
    document.documentElement.classList.remove('sm-lock');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  // Every "Free checklist" style button now opens the pop-up
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('a[href="#audit"], [data-open-start]');
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var mm = document.getElementById('mobile-menu');
    if (mm && !mm.hidden) { var toggle = document.querySelector('.menu-toggle'); if (toggle) toggle.click(); }
    open({});
  }, true);

  window.OGStart = { open: open, close: close, client: client };
})();
