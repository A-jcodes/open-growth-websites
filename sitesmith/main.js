/* =========================================================
   Open Growth — v3 interactions
   Every library is optional: if a CDN fails, the page still works
   and all content stays visible.
   ========================================================= */
(function () {
  'use strict';

  var d = document;
  var w = window;
  var root = d.documentElement;

  var reduceMotion = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = w.matchMedia && w.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var gsap = w.gsap;
  var ScrollTrigger = w.ScrollTrigger;
  var hasGSAP = typeof gsap !== 'undefined' && gsap !== null;
  var hasST = hasGSAP && typeof ScrollTrigger !== 'undefined' && ScrollTrigger !== null;
  var lenis = null;

  if (hasST) {
    try { gsap.registerPlugin(ScrollTrigger); } catch (e) { hasST = false; }
  }

  function $(sel, ctx) { return (ctx || d).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || d).querySelectorAll(sel)); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-CA'); }
  function headerHeight() {
    var h = $('.site-header');
    return h ? h.getBoundingClientRect().height : 72;
  }
  function onMedia(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  /* ---------- 1. Icons (Lucide) ---------- */
  if (w.lucide && typeof w.lucide.createIcons === 'function') {
    try {
      w.lucide.createIcons({ icons: w.lucide.icons, attrs: { 'aria-hidden': 'true' } });
    } catch (e) { /* icons are decorative; ignore */ }
  }

  /* ---------- 2. Smooth scroll (Lenis) ---------- */
  if (typeof w.Lenis === 'function' && !reduceMotion) {
    try {
      lenis = new w.Lenis({ lerp: 0.11, smoothWheel: true });
      if (hasST) {
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
        gsap.ticker.lagSmoothing(0);
      } else {
        var lenisRaf = function (time) { lenis.raf(time); w.requestAnimationFrame(lenisRaf); };
        w.requestAnimationFrame(lenisRaf);
      }
    } catch (e) { lenis = null; }
  }

  /* ---------- 3. Mobile menu ---------- */
  var menuToggle = $('.menu-toggle');
  var menu = $('#mobile-menu');
  var mobileCta = $('.mobile-cta');

  var behindMenu = $$('main, footer, .mobile-cta, .motion-ctrl');
  function setBehindInert(on) {
    behindMenu.forEach(function (el) {
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }
  function openMenu() {
    if (!menu) return;
    menu.hidden = false;
    setBehindInert(true);
    menuToggle.setAttribute('aria-expanded', 'true');
    d.body.style.overflow = 'hidden';
    if (lenis) lenis.stop();
    if (mobileCta) mobileCta.classList.add('is-hidden');
    var first = $('a', menu);
    if (first) first.focus();
  }
  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    setBehindInert(false);
    menuToggle.setAttribute('aria-expanded', 'false');
    d.body.style.overflow = '';
    if (lenis) lenis.start();
    updateMobileCta();
  }
  if (menuToggle && menu) {
    menuToggle.addEventListener('click', function () {
      if (menu.hidden) openMenu(); else closeMenu();
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { closeMenu(); menuToggle.focus(); }
    });
    onMedia(w.matchMedia('(min-width: 1181px)'), function (e) { if (e.matches) closeMenu(); });
  }

  /* ---------- 4. In-page anchor links ---------- */
  $$('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('href').slice(1);
      if (!id) return;
      var target = d.getElementById(id);
      if (!target) return;
      e.preventDefault();
      closeMenu();
      if (lenis) {
        lenis.scrollTo(target, { offset: -(headerHeight() + 8), duration: 1.2 });
      } else {
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
      if (w.history && w.history.pushState) w.history.pushState(null, '', '#' + id);
      // Move focus for keyboard and screen-reader users
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (err) { /* old browsers */ }
    });
  });

  /* ---------- 4b. Scroll spy: mark the current section in the main nav ---------- */
  (function () {
    var links = $$('.nav a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in w)) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var current = null;
      links.forEach(function (a) {
        var id = a.getAttribute('href').slice(1);
        if (visible[id] && !current) current = id;
      });
      links.forEach(function (a) {
        if (a.getAttribute('href').slice(1) === current) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(byId).forEach(function (id) {
      var sec = d.getElementById(id);
      if (sec) io.observe(sec);
    });
  })();

  /* ---------- 4c. Pause animations (remembered per visitor) ---------- */
  (function () {
    var btn = $('.motion-toggle');
    if (!btn) return;
    function set(paused) {
      root.classList.toggle('motion-paused', paused);
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      try { w.localStorage.setItem('og-motion-paused', paused ? '1' : '0'); } catch (e) { /* storage blocked */ }
    }
    var saved = false;
    try { saved = w.localStorage.getItem('og-motion-paused') === '1'; } catch (e) { /* storage blocked */ }
    set(saved);
    btn.addEventListener('click', function () { set(btn.getAttribute('aria-pressed') !== 'true'); });
  })();

  /* ---------- 5. Mobile sticky CTA ---------- */
  var auditVisible = false;
  function updateMobileCta() {
    if (!mobileCta) return;
    var hide = auditVisible || (menu && !menu.hidden) || w.scrollY < 300;
    mobileCta.classList.toggle('is-hidden', hide);
  }
  if (mobileCta) {
    var auditSection = $('#audit');
    if (auditSection && 'IntersectionObserver' in w) {
      new IntersectionObserver(function (entries) {
        auditVisible = entries[0].isIntersecting;
        updateMobileCta();
      }, { threshold: 0.05 }).observe(auditSection);
    }
    w.addEventListener('scroll', updateMobileCta, { passive: true });
    updateMobileCta();
  }

  /* ---------- 6. Hero intro + scroll reveals (GSAP) ---------- */
  if (hasGSAP && !reduceMotion) {
    try {
      var intro = gsap.timeline({ defaults: { ease: 'power4.out' } });
      intro
        .from('.hero__title .line__inner', { yPercent: 115, rotate: 3, duration: 1.05, stagger: 0.09 })
        .from('.hero__eyebrow', { y: 16, opacity: 0, duration: 0.6 }, 0)
        .from('.hero__copy > *', { y: 28, opacity: 0, duration: 0.7, stagger: 0.08, clearProps: 'transform,opacity' }, 0.35)
        .from('.playground-wrap', { y: 40, opacity: 0, duration: 0.9, clearProps: 'transform,opacity' }, 0.45)
        .from('.spin-sticker', { scale: 0, rotate: -120, duration: 0.9, ease: 'back.out(2)' }, 0.9);
    } catch (e) { /* content is already visible */ }
  }

  /* Horizontal pinned services. Created before the other scroll triggers so
     everything further down the page measures its position after the pin. */
  if (hasST && !reduceMotion && typeof gsap.matchMedia === 'function') {
    try {
      var mm = gsap.matchMedia();
      mm.add('(min-width: 900px)', function () {
        var section = $('.services');
        var track = $('.services__track');
        if (!section || !track) return;
        section.classList.add('is-pinned');
        var distance = function () { return Math.max(0, track.scrollWidth - w.innerWidth); };
        gsap.to(track, {
          x: function () { return -distance(); },
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: function () { return 'top ' + Math.round(headerHeight()) + 'px'; },
            end: function () { return '+=' + distance(); },
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
            anticipatePin: 1
          }
        });
        return function () { section.classList.remove('is-pinned'); };
      });
    } catch (e) {
      var svcSection = $('.services');
      if (svcSection) svcSection.classList.remove('is-pinned');
    }
  }

  if (hasST && !reduceMotion) {
    var revealSel = [
      '.section-title', '.eyebrow:not(.hero__eyebrow)', '.split-head__aside',
      '.stat-card', '.dash', '.flow', '.ba', '.step', '.picker', '.plan', '.calc',
      '.founding .lead', '.deal__col', '.spots', '.case', '.table-wrap', '.areas .lead', '.town-tags',
      '.map-card', '.portrait', '.about__copy > p', '.about__facts', '.qa', '.audit__list li',
      '.audit__alt', '.form-card', '.footer__big', '.footer__word', '.services__hint'
    ].join(',');

    $$(revealSel).forEach(function (el) {
      // Small stagger between siblings that reveal together
      var sibs = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (c) {
        return c.matches && c.matches(revealSel);
      }) : [el];
      var idx = Math.max(0, sibs.indexOf(el));
      gsap.from(el, {
        y: 44,
        opacity: 0,
        duration: 0.85,
        delay: Math.min(idx, 6) * 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onStart: function () { el.style.transition = 'none'; },
        onComplete: function () {
          gsap.set(el, { clearProps: 'transform,opacity' });
          el.style.transition = '';
        }
      });
    });

    // Chart bars grow from the baseline
    var bars = $$('.bar');
    if (bars.length) {
      gsap.from(bars, {
        scaleY: 0, transformOrigin: '50% 100%', duration: 0.7, ease: 'back.out(1.6)', stagger: 0.05,
        scrollTrigger: { trigger: '.bars', start: 'top 85%', once: true },
        clearProps: 'transform'
      });
    }

    // Marquee strips lean with scroll
    $$('.marquee').forEach(function (m, i) {
      gsap.fromTo(m, { xPercent: i % 2 ? -2 : 2 }, {
        xPercent: i % 2 ? 2 : -2, ease: 'none',
        scrollTrigger: { trigger: m, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });
  }

  /* ---------- 7. Kinetic statement (words light up on scroll) ---------- */
  var statement = $('[data-kinetic]');
  if (statement && hasST && !reduceMotion) {
    var text = statement.textContent.replace(/\s+/g, ' ').trim();
    var frag = d.createDocumentFragment();
    text.split(' ').forEach(function (word, i, arr) {
      var span = d.createElement('span');
      span.className = 'kw';
      span.textContent = word;
      frag.appendChild(span);
      if (i < arr.length - 1) frag.appendChild(d.createTextNode(' '));
    });
    statement.textContent = '';
    statement.appendChild(frag);
    gsap.fromTo($$('.kw', statement), { opacity: 0.2 }, {
      opacity: 1, ease: 'power1.out', duration: 0.35, stagger: 0.035,
      scrollTrigger: { trigger: statement, start: 'top 75%', once: true }
    });
  }

  /* ---------- 8. Count-up numbers ---------- */
  if (hasST && !reduceMotion) {
    $$('[data-count]').forEach(function (el) {
      var end = parseInt(el.getAttribute('data-count'), 10);
      if (isNaN(end)) return;
      var counter = { v: 0 };
      gsap.to(counter, {
        v: end, duration: 1.4, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        onUpdate: function () { el.textContent = Math.round(counter.v); },
        onComplete: function () { el.textContent = end; }
      });
    });
  }

  /* ---------- 10. Physics playground (Matter.js) ---------- */
  function initPhysics() {
    var box = $('#playground');
    var M = w.Matter;
    if (!box || !M || reduceMotion) return;

    var Engine = M.Engine, Bodies = M.Bodies, Body = M.Body, Composite = M.Composite, Constraint = M.Constraint;
    var engine = Engine.create();
    if (engine.gravity) engine.gravity.y = 1;
    var world = engine.world;

    box.classList.add('is-physics');
    var shakeBtn = $('.playground__shake', box);
    if (shakeBtn) shakeBtn.hidden = false;

    var W = box.clientWidth;
    var H = box.clientHeight;
    var walls = [];
    var T = 200;

    function buildWalls() {
      if (walls.length) Composite.remove(world, walls);
      walls = [
        Bodies.rectangle(W / 2, H + T / 2, W + T * 2, T, { isStatic: true }),          // floor
        Bodies.rectangle(-T / 2, 0, T, H * 4, { isStatic: true }),                      // left
        Bodies.rectangle(W + T / 2, 0, T, H * 4, { isStatic: true }),                   // right
        Bodies.rectangle(W / 2, -H * 2 - T / 2, W + T * 2, T, { isStatic: true })      // ceiling, far above
      ];
      Composite.add(world, walls);
    }

    function makeBody(item, x, y, angle) {
      var r = Math.max(1, item.h / 2 - 1);
      return Bodies.rectangle(x, y, item.w, item.h, {
        chamfer: { radius: r },
        restitution: 0.45,
        friction: 0.08,
        frictionAir: 0.014,
        density: 0.0016,
        angle: angle || 0
      });
    }

    var items = $$('.pill', box).map(function (el) {
      var item = { el: el, w: el.offsetWidth, h: el.offsetHeight, body: null };
      var x = item.w / 2 + Math.random() * Math.max(1, W - item.w);
      var y = -Math.random() * H * 0.9 - item.h;
      item.body = makeBody(item, x, y, (Math.random() - 0.5) * 0.8);
      return item;
    });

    buildWalls();
    Composite.add(world, items.map(function (it) { return it.body; }));

    function sync() {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var p = it.body.position;
        it.el.style.transform = 'translate(' + (p.x - it.w / 2).toFixed(1) + 'px,' + (p.y - it.h / 2).toFixed(1) +
          'px) rotate(' + it.body.angle.toFixed(3) + 'rad)';
      }
    }
    sync();

    // Fixed-step loop with an accumulator (consistent speed on 60/120 Hz screens)
    var STEP = 1000 / 60;
    var running = false, last = 0, acc = 0, rafId = 0;
    function step() {
      var t = (w.performance && w.performance.now) ? w.performance.now() : Date.now();
      var dt = last ? Math.min(t - last, 100) : STEP;
      last = t;
      acc += dt;
      var n = 0;
      while (acc >= STEP && n < 4) { Engine.update(engine, STEP); acc -= STEP; n++; }
      if (n === 4) acc = 0;
      sync();
    }
    // Share GSAP's ticker when available (same clock as Lenis); otherwise use rAF.
    var useTicker = hasGSAP && gsap.ticker && typeof gsap.ticker.add === 'function';
    function loop() {
      if (!running) return;
      step();
      rafId = w.requestAnimationFrame(loop);
    }
    function start() {
      if (running) return;
      running = true; last = 0; acc = 0;
      if (useTicker) gsap.ticker.add(step);
      else rafId = w.requestAnimationFrame(loop);
    }
    function stop() {
      if (!running) return;
      running = false;
      if (useTicker) gsap.ticker.remove(step);
      else w.cancelAnimationFrame(rafId);
    }
    // Dragging (only when a pill is grabbed, so the page still scrolls on touch)
    var drag = null;
    function local(e) {
      var r = box.getBoundingClientRect();
      return { x: e.clientX - r.left - box.clientLeft, y: e.clientY - r.top - box.clientTop };
    }
    function findItem(el) {
      for (var i = 0; i < items.length; i++) if (items[i].el === el) return items[i];
      return null;
    }
    box.addEventListener('pointerdown', function (e) {
      var pillEl = e.target.closest ? e.target.closest('.pill') : null;
      if (!pillEl) return;
      var it = findItem(pillEl);
      if (!it) return;
      e.preventDefault();
      var p = local(e);
      var c = Constraint.create({
        pointA: { x: p.x, y: p.y },
        bodyB: it.body,
        pointB: { x: p.x - it.body.position.x, y: p.y - it.body.position.y },
        stiffness: 0.18,
        damping: 0.08,
        length: 0
      });
      Composite.add(world, c);
      drag = { c: c, it: it };
      it.el.classList.add('is-grabbed');
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      start();
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = local(e);
      drag.c.pointA.x = p.x;
      drag.c.pointA.y = p.y;
    });
    function endDrag() {
      if (!drag) return;
      Composite.remove(world, drag.c);
      drag.it.el.classList.remove('is-grabbed');
      drag = null;
    }
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
    box.addEventListener('lostpointercapture', endDrag);

    if (shakeBtn) {
      shakeBtn.addEventListener('click', function () {
        items.forEach(function (it) {
          Body.setVelocity(it.body, { x: (Math.random() - 0.5) * 24, y: -8 - Math.random() * 16 });
          Body.setAngularVelocity(it.body, (Math.random() - 0.5) * 0.4);
        });
        start();
      });
    }

    // Rebuild on resize
    var resizeTimer = 0;
    w.addEventListener('resize', function () {
      w.clearTimeout(resizeTimer);
      resizeTimer = w.setTimeout(function () {
        var nw = box.clientWidth, nh = box.clientHeight;
        if (nw === W && nh === H) return;
        W = nw; H = nh;
        endDrag();
        buildWalls();
        items.forEach(function (it) {
          var pos = it.body.position;
          var angle = it.body.angle;
          Composite.remove(world, it.body);
          it.w = it.el.offsetWidth;
          it.h = it.el.offsetHeight;
          var x = Math.min(Math.max(pos.x, it.w / 2), Math.max(it.w / 2, W - it.w / 2));
          var y = Math.min(pos.y, H - it.h);
          it.body = makeBody(it, x, y, angle);
          Composite.add(world, it.body);
        });
        start();
      }, 200);
    });

    // Only simulate while visible
    if ('IntersectionObserver' in w) {
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) start(); else stop();
      }, { threshold: 0 }).observe(box);
    } else {
      start();
    }
    d.addEventListener('visibilitychange', function () {
      if (d.hidden) stop(); else start();
    });
  }

  // Wait for web fonts so pill sizes are measured correctly (max 1.5 s)
  (function () {
    var ready = (d.fonts && d.fonts.ready) ? d.fonts.ready : Promise.resolve();
    var timeout = new Promise(function (resolve) { w.setTimeout(resolve, 1500); });
    Promise.race([ready, timeout]).then(function () {
      try { initPhysics(); } catch (e) {
        var pg = $('#playground');
        if (pg) pg.classList.remove('is-physics');
        $$('.pill').forEach(function (p) { p.style.transform = ''; });
      }
      if (hasST) ScrollTrigger.refresh();
    });
  })();

  /* ---------- 11. Lead automation simulation ---------- */
  (function () {
    var btn = $('#simulate-lead');
    var steps = $$('.flow__step');
    var clock = $('#flow-clock');
    if (!btn || !steps.length) return;
    var timers = [];
    var played = false;

    function run() {
      played = true;
      timers.forEach(w.clearTimeout);
      timers = [];
      steps.forEach(function (s) { s.classList.remove('is-active', 'is-done'); });
      btn.disabled = true;
      var gap = reduceMotion ? 300 : 950;
      steps.forEach(function (s, i) {
        timers.push(w.setTimeout(function () {
          if (i > 0) { steps[i - 1].classList.remove('is-active'); steps[i - 1].classList.add('is-done'); }
          s.classList.add('is-active');
          var t = $('.flow__t', s);
          if (clock && t) clock.textContent = t.textContent;
          if (i === steps.length - 1) {
            timers.push(w.setTimeout(function () {
              s.classList.remove('is-active');
              s.classList.add('is-done');
              btn.disabled = false;
            }, gap));
          }
        }, i * gap));
      });
    }
    btn.addEventListener('click', run);

    if (!reduceMotion && 'IntersectionObserver' in w) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !played) { run(); io.disconnect(); }
      }, { threshold: 0.6 });
      io.observe($('.flow'));
    }
  })();

  /* ---------- 12. Before / after slider ---------- */
  (function () {
    var ba = $('.ba');
    var range = $('#ba-range');
    if (!ba || !range) return;
    var touched = false;
    function setPos(v) {
      ba.style.setProperty('--pos', v + '%');
      range.setAttribute('aria-valuetext', Math.round(v) + '% showing the before version');
    }
    range.addEventListener('input', function () { touched = true; setPos(range.value); });
    setPos(range.value);

    // A little "wiggle" the first time it scrolls into view, to show it moves
    if (hasST && !reduceMotion) {
      var o = { v: 50 };
      gsap.timeline({ scrollTrigger: { trigger: ba, start: 'top 70%', once: true } })
        .to(o, { v: 22, duration: 0.8, ease: 'power2.inOut', onUpdate: function () { if (!touched) { setPos(o.v); range.value = o.v; } } })
        .to(o, { v: 74, duration: 1, ease: 'power2.inOut', onUpdate: function () { if (!touched) { setPos(o.v); range.value = o.v; } } })
        .to(o, { v: 50, duration: 0.7, ease: 'power2.out', onUpdate: function () { if (!touched) { setPos(o.v); range.value = o.v; } } });
    }
  })();

  /* ---------- 13. Pricing: plan picker + calculator ---------- */
  var planNames = { launch: 'Launch', grow: 'Grow', scale: 'Scale' };
  var calc = {
    months: $('#calc-months'),
    ads: $('#calc-ads'),
    care: $('#calc-care'),
    upfront: $('#calc-upfront'),
    monthly: $('#calc-monthly'),
    total: $('#calc-total'),
    monthsOut: $('#calc-months-out'),
    monthsLabel: $('#calc-months-label'),
    adsOut: $('#calc-ads-out'),
    shown: 0
  };

  function updateCalc() {
    if (!calc.months) return;
    var checked = $('input[name="calc-plan"]:checked');
    var plan = checked ? checked.value : 'grow';
    var m = parseInt(calc.months.value, 10) || 12;
    var ads = parseInt(calc.ads.value, 10) || 0;
    var upfront = 0, monthly = 0, monthlyText = '';

    if (plan === 'launch') {
      upfront = 3900;
      monthly = calc.care && calc.care.checked ? 200 : 0;
      monthlyText = monthly ? money(monthly) : '$0';
    } else if (plan === 'grow') {
      upfront = 1500;
      monthly = 1200;
      monthlyText = money(monthly);
    } else {
      upfront = 0;
      monthly = 2500 + ads;
      monthlyText = '$2,500 + ' + money(ads) + ' ads';
    }

    $$('.calc__row[data-show]').forEach(function (row) {
      row.hidden = row.getAttribute('data-show') !== plan;
    });

    calc.adsOut.textContent = money(ads);
    calc.monthsOut.textContent = m;
    calc.monthsLabel.textContent = m + (m === 1 ? ' month' : ' months');
    calc.upfront.textContent = money(upfront);
    calc.monthly.textContent = monthlyText;

    var total = upfront + monthly * m;
    var live = $('#calc-live');
    if (live) {
      w.clearTimeout(calc.liveTimer);
      calc.liveTimer = w.setTimeout(function () {
        live.textContent = planNames[plan] + ': ' + money(upfront) + ' up front, ' + monthlyText +
          ' a month. Total over ' + m + (m === 1 ? ' month' : ' months') + ': ' + money(total) + '.';
      }, 500);
    }
    if (hasGSAP && !reduceMotion && calc.shown !== total) {
      if (calc.tween) calc.tween.kill();
      var o = { v: calc.shown };
      calc.tween = gsap.to(o, {
        v: total, duration: 0.5, ease: 'power2.out',
        onUpdate: function () { calc.shown = o.v; calc.total.textContent = money(o.v); },
        onComplete: function () { calc.shown = total; calc.total.textContent = money(total); }
      });
    } else {
      calc.shown = total;
      calc.total.textContent = money(total);
    }
  }

  $$('input[name="calc-plan"]').forEach(function (r) { r.addEventListener('change', updateCalc); });
  [calc.months, calc.ads, calc.care].forEach(function (el) {
    if (el) el.addEventListener('input', updateCalc);
    if (el) el.addEventListener('change', updateCalc);
  });

  function updatePicker(fromUser) {
    var out = $('#picker-out');
    if (!out) return;
    var vals = $$('input[name="need"]:checked').map(function (i) { return i.value; });
    var has = function (v) { return vals.indexOf(v) > -1; };
    var plan = null;
    if (has('ads') || has('cities')) plan = 'scale';
    else if (has('maps') || has('leads')) plan = 'grow';
    else if (has('site')) plan = 'launch';

    out.textContent = plan ? planNames[plan] : 'start with the free audit';
    $$('.plan').forEach(function (p) {
      p.classList.toggle('is-recommended', p.getAttribute('data-plan') === plan);
    });
    if (plan && fromUser) {
      var radio = $('input[name="calc-plan"][value="' + plan + '"]');
      if (radio) { radio.checked = true; updateCalc(); }
    }
  }
  $$('input[name="need"]').forEach(function (c) {
    c.addEventListener('change', function () { updatePicker(true); });
  });
  updatePicker(false);
  updateCalc();

  /* ---------- 14. Founding spots ---------- */
  (function () {
    var spots = $('.spots');
    if (!spots) return;
    var open = parseInt(spots.getAttribute('data-open'), 10);
    if (isNaN(open)) return;
    open = Math.max(0, Math.min(5, open));
    $$('.spot', spots).forEach(function (s, i) { s.classList.toggle('is-taken', i < 5 - open); });
    var count = $('#spots-count');
    if (count) count.textContent = open + ' of 5';
  })();

  /* ---------- 15. Service-area map ---------- */
  (function () {
    var towns = $$('.town');
    function highlight(name) {
      $$('.map__town').forEach(function (g) {
        if (g.getAttribute('data-town') === name) g.classList.add('is-active');
        else g.classList.remove('is-active');
      });
    }
    towns.forEach(function (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        towns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        if (on) { btn.setAttribute('aria-pressed', 'true'); highlight(btn.getAttribute('data-town')); }
        else highlight(null);
      });
      btn.addEventListener('mouseenter', function () { highlight(btn.getAttribute('data-town')); });
      btn.addEventListener('mouseleave', function () {
        var pressed = $('.town[aria-pressed="true"]');
        highlight(pressed ? pressed.getAttribute('data-town') : null);
      });
    });
  })();

  /* ---------- 16. Audit form ---------- */
  (function () {
    var form = $('#audit-form');
    var success = $('#form-success');
    if (!form || !success) return;
    var status = $('.form-status', form);
    var submitBtn = $('button[type="submit"]', form);
    var submitHTML = submitBtn ? submitBtn.innerHTML : '';
    var submitted = false;

    var rules = {
      name: function (v) { return v.trim().length >= 2 ? '' : 'Please tell us your name.'; },
      email: function (v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Please enter a valid email, like you@yourbusiness.ca.';
      },
      problem: function (v) { return v.trim().length >= 3 ? '' : 'Tell us the biggest problem, even in a few words.'; }
    };

    function setError(input, msg) {
      var err = d.getElementById(input.id + '-err');
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      if (err) err.textContent = msg;
    }
    function checkField(name) {
      var input = form.elements[name];
      if (!input) return true;
      var msg = rules[name](input.value || '');
      setError(input, msg);
      return !msg;
    }
    function revenueValue() {
      var picked = $('input[name="revenue"]:checked', form);
      return picked ? picked.value : '';
    }
    function checkRevenue() {
      var ok = !!revenueValue();
      var fs = $('.field--chips', form);
      var err = $('#f-revenue-err');
      if (fs) fs.classList.toggle('is-invalid', !ok);
      if (err) err.textContent = ok ? '' : 'Pick the range that fits best.';
      return ok;
    }

    Object.keys(rules).forEach(function (name) {
      var input = form.elements[name];
      if (!input) return;
      input.addEventListener('blur', function () {
        if (submitted || input.value) checkField(name);
      });
      input.addEventListener('input', function () {
        if (input.getAttribute('aria-invalid') === 'true') checkField(name);
      });
      input.addEventListener('change', function () {
        if (submitted) checkField(name);
      });
    });
    $$('input[name="revenue"]', form).forEach(function (r) {
      r.addEventListener('change', function () { if (submitted) checkRevenue(); });
    });

    function showSuccess(name) {
      var nameEl = $('#success-name');
      if (nameEl) nameEl.textContent = name ? name.split(' ')[0] : 'thanks';
      form.hidden = true;
      success.hidden = false;
      success.focus();
      if (!reduceMotion) {
        var burst = function () {
          try {
            w.confetti({
              particleCount: 160, spread: 90, startVelocity: 42, origin: { y: 0.65 },
              colors: ['#2f4bff', '#ffd43b', '#ff7ac6', '#35d49a', '#ff6b2c']
            });
          } catch (e) { /* decorative */ }
        };
        if (typeof w.confetti === 'function') burst();
        else {
          var s = d.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
          s.onload = burst;
          d.head.appendChild(s);
        }
      }
      if (hasST) ScrollTrigger.refresh();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitted = true;
      if (status) status.textContent = '';

      var firstBad = null;
      Object.keys(rules).forEach(function (name) {
        if (!checkField(name) && !firstBad) firstBad = form.elements[name];
      });
      if (!checkRevenue() && !firstBad) firstBad = $('input[name="revenue"]', form);

      if (firstBad) {
        if (status) status.textContent = 'Please fix the highlighted fields above.';
        firstBad.focus();
        return;
      }

      var nameVal = form.elements.name.value.trim();

      // Honeypot filled in: quietly pretend it worked
      if (form.elements.company_url && form.elements.company_url.value) { showSuccess(nameVal); return; }

      var data = {
        name: nameVal,
        email: form.elements.email.value.trim(),
        revenue_range: revenueValue(),
        biggest_problem: form.elements.problem.value.trim(),
        source: 'sitesmith',
        offer: 'calls-checklist'
      };

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
      form.setAttribute('aria-busy', 'true');

      w.OGLeads.submit(data).then(function () {
        showSuccess(nameVal);
      }).catch(function () {
        if (status) status.textContent = 'Sorry, something went wrong. Please call (403) 555-0142 or email hello@opengrowth.ca.';
      }).then(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitHTML; }
        form.removeAttribute('aria-busy');
      });
    });

    var resetBtn = $('#form-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        form.reset();
        submitted = false;
        Object.keys(rules).forEach(function (n) { if (form.elements[n]) setError(form.elements[n], ''); });
        var fs = $('.field--chips', form);
        if (fs) fs.classList.remove('is-invalid');
        var gErr = $('#f-revenue-err');
        if (gErr) gErr.textContent = '';
        success.hidden = true;
        form.hidden = false;
        form.elements.name.focus();
        if (hasST) ScrollTrigger.refresh();
      });
    }
  })();

  /* ---------- 17. Cursor follower + magnetic buttons (desktop only) ---------- */
  if (finePointer && !reduceMotion) {
    var cursor = $('.cursor');
    var label = $('.cursor__label');
    if (cursor) {
      root.classList.add('has-cursor');
      var xTo = null, yTo = null;
      if (hasGSAP && typeof gsap.quickTo === 'function') {
        xTo = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3' });
        yTo = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3' });
      }
      w.addEventListener('pointermove', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        cursor.classList.add('is-visible');
        if (xTo) { xTo(e.clientX); yTo(e.clientY); }
        else cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
      }, { passive: true });
      root.addEventListener('mouseleave', function () { cursor.classList.remove('is-visible'); });
      d.addEventListener('pointerover', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var labelled = t.closest('[data-cursor]');
        var interactive = t.closest('a, button, label, summary, select, input, textarea, .bar');
        if (labelled) {
          cursor.classList.add('is-label');
          label.textContent = labelled.getAttribute('data-cursor');
        } else {
          cursor.classList.remove('is-label');
          label.textContent = '';
        }
        cursor.classList.toggle('is-hover', !!interactive && !labelled);
      });
    }

    if (hasGSAP) {
      $$('.magnetic').forEach(function (el) {
        el.style.transition = 'box-shadow .15s ease, background-color .15s ease';
        el.addEventListener('pointermove', function (e) {
          var r = el.getBoundingClientRect();
          var dx = e.clientX - (r.left + r.width / 2);
          var dy = e.clientY - (r.top + r.height / 2);
          gsap.to(el, { x: dx * 0.22, y: dy * 0.3, duration: 0.4, ease: 'power3.out' });
        });
        el.addEventListener('pointerleave', function () {
          gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' });
        });
      });
    }
  }

  /* ---------- 18. Final refresh once everything has loaded ---------- */
  w.addEventListener('load', function () {
    if (hasST) ScrollTrigger.refresh();
  });
})();
