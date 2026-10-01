/* =========================================================
   Open Growth | v2 "dark, premium, data/tech"
   Every library is optional: each feature checks for its global
   and the page stays fully readable if a CDN fails.
   Libraries: three.js, GSAP + ScrollTrigger, Lenis, Chart.js, Lucide
   ========================================================= */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hasGSAP = typeof window.gsap !== 'undefined';
  var hasST = hasGSAP && typeof window.ScrollTrigger !== 'undefined';
  var lenis = null;

  if (hasST) window.gsap.registerPlugin(window.ScrollTrigger);

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function safe(fn, name) {
    try { fn(); } catch (err) {
      if (window.console && console.warn) console.warn('[Open Growth] ' + name + ' skipped:', err);
    }
  }

  /* ---------------- Icons (Lucide) ---------------- */
  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons(window.lucide.icons ? { icons: window.lucide.icons } : undefined);
    }
  }

  /* ---------------- Smooth scrolling (Lenis) ---------------- */
  function initLenis() {
    if (prefersReduced || typeof window.Lenis === 'undefined') return;
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
    if (hasGSAP) {
      if (hasST) lenis.on('scroll', window.ScrollTrigger.update);
      window.gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      window.gsap.ticker.lagSmoothing(0);
    } else {
      var raf = function (t) { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }

  function headerOffset() {
    var header = $('.site-header');
    return header ? header.offsetHeight + 8 : 80;
  }

  function scrollToTarget(target, isTop) {
    if (lenis) {
      lenis.scrollTo(isTop ? 0 : target, { offset: isTop ? 0 : -headerOffset(), duration: 1.3 });
    } else {
      var y = isTop ? 0 : target.getBoundingClientRect().top + window.pageYOffset - headerOffset();
      window.scrollTo({ top: y, behavior: prefersReduced ? 'auto' : 'smooth' });
    }
  }

  /* ---------------- Mobile menu ---------------- */
  var menuToggle = $('.menu-toggle');
  var mobileMenu = $('#mobile-menu');
  var siteHeader = $('.site-header');

  function onMenuKey(e) {
    if (e.key === 'Escape') {
      closeMenu();
      if (menuToggle) menuToggle.focus();
    }
  }
  function openMenu() {
    if (!mobileMenu || !menuToggle) return;
    mobileMenu.hidden = false;
    menuToggle.setAttribute('aria-expanded', 'true');
    var label = menuToggle.querySelector('.sr-only');
    if (label) label.textContent = 'Close menu';
    if (siteHeader) siteHeader.classList.add('menu-open');
    if (lenis) lenis.stop();
    doc.addEventListener('keydown', onMenuKey);
  }
  function closeMenu() {
    if (!mobileMenu || !menuToggle || mobileMenu.hidden) return;
    mobileMenu.hidden = true;
    menuToggle.setAttribute('aria-expanded', 'false');
    var label = menuToggle.querySelector('.sr-only');
    if (label) label.textContent = 'Open menu';
    if (siteHeader) siteHeader.classList.remove('menu-open');
    if (lenis) lenis.start();
    doc.removeEventListener('keydown', onMenuKey);
  }
  function initMenu() {
    if (!menuToggle || !mobileMenu) return;
    menuToggle.addEventListener('click', function () {
      if (mobileMenu.hidden) openMenu(); else closeMenu();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1080) closeMenu();
    });
  }

  /* ---------------- In-page anchors ---------------- */
  function initAnchors() {
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var hash = a.getAttribute('href');
        if (!hash || hash.length < 2) return;
        var target = doc.getElementById(hash.slice(1));
        if (!target) return;
        e.preventDefault();
        closeMenu();
        var isTop = hash === '#top';
        scrollToTarget(target, isTop);
        if (window.history && history.replaceState) history.replaceState(null, '', hash);
        // Move keyboard focus to the new section without jumping
        if (!isTop) {
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          try { target.focus({ preventScroll: true }); } catch (err) { /* older browsers */ }
        }
      });
    });
  }

  /* ---------------- Header state, progress bar, sticky CTA ---------------- */
  function initScrollUI() {
    var bar = $('.scroll-progress span');
    var mcta = $('.mobile-cta');
    var hero = $('.hero');
    var audit = $('#audit');
    var auditVisible = false;
    var ticking = false;

    function update() {
      ticking = false;
      var y = window.pageYOffset || root.scrollTop;
      var max = root.scrollHeight - window.innerHeight;
      if (siteHeader) siteHeader.classList.toggle('is-scrolled', y > 20);
      if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max, 0, 1) : 0) + ')';
      if (mcta) {
        var threshold = hero ? hero.offsetHeight * 0.6 : 400;
        mcta.classList.toggle('is-visible', y > threshold && !auditVisible);
      }
    }
    function requestUpdate() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }

    if ('IntersectionObserver' in window && audit) {
      new IntersectionObserver(function (entries) {
        auditVisible = entries[0].isIntersecting;
        requestUpdate();
      }, { threshold: 0.05 }).observe(audit);
    }
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    update();
  }

  /* ---------------- Active nav link ---------------- */
  function initActiveNav() {
    if (!('IntersectionObserver' in window)) return;
    var links = $$('.main-nav a[href^="#"]');
    var map = {};
    links.forEach(function (l) { map[l.getAttribute('href').slice(1)] = l; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var link = map[en.target.id];
        if (!link) return;
        if (en.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('is-current'); });
          link.classList.add('is-current');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) {
      var sec = doc.getElementById(id);
      if (sec) io.observe(sec);
    });
  }

  /* ---------------- Hero: WebGL "growth terrain" (three.js) ---------------- */
  var VERT = [
    'uniform float uTime;',
    'uniform vec2 uMouse;',
    'uniform float uMouseStrength;',
    'uniform float uPixel;',
    'uniform float uBoost;',
    'attribute float aRand;',
    'varying float vH;',
    'varying float vA;',
    'varying float vB;',
    'void main() {',
    '  vec3 p = position;',
    '  float g = smoothstep(-13.0, 13.0, p.x);',
    '  float wave = sin(p.x * 0.42 + uTime * 0.55) * 0.32',
    '             + sin(p.z * 0.75 + uTime * 0.38 + p.x * 0.18) * 0.26',
    '             + sin((p.x + p.z) * 1.3 + uTime * 0.9) * 0.06;',
    '  float d = distance(p.xz, uMouse);',
    '  float ripple = exp(-d * d * 0.22) * uMouseStrength;',
    '  p.y = wave + g * g * 3.0 - 1.7 + ripple * (0.9 + 0.25 * sin(uTime * 3.0 - d * 2.2));',
    '  vH = clamp((p.y + 1.9) / 3.6, 0.0, 1.0);',
    '  vB = uBoost * (0.55 + 0.45 * sin(p.x * 1.6 - uTime * 2.4));',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float size = (1.3 + aRand * 1.5 + ripple * 2.2 + uBoost * 2.4) * uPixel;',
    '  gl_PointSize = size * (7.5 / max(-mv.z, 0.5));',
    '  vA = smoothstep(22.0, 5.0, -mv.z);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform vec3 uColorA;',
    'uniform vec3 uColorB;',
    'varying float vH;',
    'varying float vA;',
    'varying float vB;',
    'void main() {',
    '  vec2 c = gl_PointCoord - vec2(0.5);',
    '  float r = length(c);',
    '  if (r > 0.5) discard;',
    '  float a = smoothstep(0.5, 0.05, r);',
    '  vec3 col = mix(uColorA, uColorB, vH);',
    '  col = mix(col, vec3(0.78, 0.97, 1.0), vB * 0.6);',
    '  float alpha = a * vA * (0.28 + 0.6 * vH) + a * vB * 0.9;',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  function initHero3D() {
    var canvas = doc.getElementById('hero-canvas');
    var THREE = window.THREE;
    if (!canvas || !THREE) return;
    var hero = canvas.parentElement;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      return; // WebGL unavailable: CSS gradient fallback stays visible
    }
    var small = window.innerWidth < 760;
    var dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    var lookAt = new THREE.Vector3(0, 0.1, 0);
    var baseY = 2.5;
    var baseZ = 8.5;

    var common = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uMouseStrength: { value: 0 },
      uPixel: { value: dpr },
      uColorA: { value: new THREE.Color('#6b4dff') },
      uColorB: { value: new THREE.Color('#3ee0ff') }
    };
    function makeMaterial(boost) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uTime: common.uTime,
          uMouse: common.uMouse,
          uMouseStrength: common.uMouseStrength,
          uPixel: common.uPixel,
          uColorA: common.uColorA,
          uColorB: common.uColorB,
          uBoost: { value: boost }
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
    }

    // Terrain grid of points
    var COLS = small ? 100 : 180;
    var ROWS = small ? 48 : 80;
    var W = 26;
    var D = 13;
    var count = COLS * ROWS;
    var pos = new Float32Array(count * 3);
    var rnd = new Float32Array(count);
    var k = 0;
    for (var j = 0; j < ROWS; j++) {
      for (var i = 0; i < COLS; i++) {
        pos[k * 3] = (i / (COLS - 1) - 0.5) * W + (Math.random() - 0.5) * 0.06;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = (j / (ROWS - 1) - 0.5) * D;
        rnd[k] = Math.random();
        k++;
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    var terrain = new THREE.Points(geo, makeMaterial(0));

    // Glowing "growth line" riding the ridge at z = 0
    var LINE_N = small ? 360 : 700;
    var lpos = new Float32Array(LINE_N * 3);
    var lrnd = new Float32Array(LINE_N);
    for (var n = 0; n < LINE_N; n++) {
      lpos[n * 3] = (n / (LINE_N - 1) - 0.5) * W;
      lpos[n * 3 + 1] = 0;
      lpos[n * 3 + 2] = 0;
      lrnd[n] = 0.3 + Math.random() * 0.3;
    }
    var lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
    lgeo.setAttribute('aRand', new THREE.BufferAttribute(lrnd, 1));
    var ridge = new THREE.Points(lgeo, makeMaterial(1));

    var group = new THREE.Group();
    group.add(terrain);
    group.add(ridge);
    group.rotation.y = -0.18;
    scene.add(group);

    // Pointer interaction: project the mouse onto the ground plane
    var raycaster = new THREE.Raycaster();
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var hit = new THREE.Vector3();
    var ndc = new THREE.Vector2(0, 0);
    var mouseTarget = new THREE.Vector2(3, 0);
    var strengthTarget = 0;

    function resize() {
      var w = hero.clientWidth || window.innerWidth;
      var h = hero.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      baseY = w < 760 ? 3.0 : 2.5;
      baseZ = w < 760 ? 10.5 : 8.5;
      camera.position.set(0, baseY, baseZ);
      camera.lookAt(lookAt);
      camera.updateProjectionMatrix();
    }

    function onPointer(e) {
      var rect = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        group.worldToLocal(hit);
        mouseTarget.set(hit.x, hit.z);
        strengthTarget = 1;
      }
    }

    var time = 2.0;
    var last = 0;
    var running = false;
    var rafId = 0;
    var inView = true;

    function render() {
      common.uTime.value = time;
      renderer.render(scene, camera);
    }
    function frame(now) {
      rafId = requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt;
      common.uMouse.value.lerp(mouseTarget, 0.08);
      common.uMouseStrength.value += (strengthTarget - common.uMouseStrength.value) * 0.05;
      camera.position.x += (ndc.x * 0.7 - camera.position.x) * 0.03;
      camera.position.y += (baseY + ndc.y * 0.3 - camera.position.y) * 0.03;
      camera.lookAt(lookAt);
      render();
    }
    function start() {
      if (running || prefersReduced) return;
      running = true;
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    resize();
    render();
    canvas.classList.add('is-ready');

    window.addEventListener('resize', function () {
      resize();
      if (!running) render();
    });

    if (prefersReduced) return; // one static frame only

    hero.addEventListener('pointermove', onPointer, { passive: true });
    hero.addEventListener('pointerleave', function () { strengthTarget = 0; ndc.set(0, 0); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView && !doc.hidden) start(); else stop();
      }).observe(hero);
    }
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) stop(); else if (inView) start();
    });
    start();
  }

  /* ---------------- Hero intro: split words + fade ---------------- */
  function splitWords(el) {
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        var parts = node.textContent.split(/(\s+)/);
        var frag = doc.createDocumentFragment();
        parts.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
          var outer = doc.createElement('span');
          outer.className = 'w';
          var inner = doc.createElement('span');
          inner.className = 'w-i';
          inner.textContent = part;
          outer.appendChild(inner);
          frag.appendChild(outer);
        });
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1) {
        splitWords(node);
      }
    });
    return $$('.w-i', el);
  }

  function initHeroIntro() {
    var title = $('[data-split]');
    if (!title || !hasGSAP || prefersReduced) return;
    var gsap = window.gsap;
    var plain = title.textContent.replace(/\s+/g, ' ').trim();
    var words = splitWords(title);
    title.setAttribute('aria-label', plain);
    $$('.w', title).forEach(function (w) { w.setAttribute('aria-hidden', 'true'); });
    title.classList.add('is-split');

    var tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.from(words, { yPercent: 115, rotate: 5, duration: 1.3, stagger: 0.05 }, 0.15)
      .from('[data-hero-fade]', { y: 24, opacity: 0, duration: 1.1, stagger: 0.08, clearProps: 'transform,opacity' }, 0.45)
      .from('.float-card', { y: 50, opacity: 0, scale: 0.94, duration: 1.3, stagger: 0.14 }, 0.7);

    // Gentle float after the intro settles
    $$('.float-card').forEach(function (card, i) {
      gsap.to(card, { y: i % 2 ? 10 : -12, duration: 3 + i * 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 2.4 });
    });
  }

  /* ---------------- Hero parallax on pointer ---------------- */
  function initHeroParallax() {
    if (!hasGSAP || prefersReduced || !finePointer) return;
    var hero = $('.hero');
    var cards = $$('.float-card');
    if (!hero || !cards.length || typeof window.gsap.quickTo !== 'function') return;
    var movers = cards.map(function (c) {
      return { depth: parseFloat(c.getAttribute('data-float')) || 1, x: window.gsap.quickTo(c, 'x', { duration: 1, ease: 'power3.out' }) };
    });
    hero.addEventListener('pointermove', function (e) {
      var nx = e.clientX / window.innerWidth - 0.5;
      movers.forEach(function (m) { m.x(nx * -16 * m.depth); });
    }, { passive: true });
  }

  /* ---------------- Lead timer ticker in hero card ---------------- */
  function initLeadTimer() {
    var el = $('.lead-timer');
    if (!el || prefersReduced) return;
    var s = 0;
    var hold = 0;
    setInterval(function () {
      if (s < 42) {
        s++;
      } else if (hold < 45) {
        hold++;
        return;
      } else {
        s = 0;
        hold = 0;
      }
      el.textContent = '0:' + (s < 10 ? '0' + s : String(s));
    }, 70);
  }

  /* ---------------- Scroll reveals (GSAP from: nothing is hidden by CSS) ---------------- */
  function initReveals() {
    if (!hasST || prefersReduced) return;
    var gsap = window.gsap;

    $$('[data-reveal]').forEach(function (el) {
      gsap.from(el, {
        y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', clearProps: 'transform,opacity',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true }
      });
    });

    $$('[data-stagger]').forEach(function (group) {
      var items = Array.prototype.slice.call(group.children);
      if (!items.length) return;
      // CSS hover transitions on transform would fight the tween, so pause them while it runs
      items.forEach(function (it) { it.classList.add('no-trans'); });
      gsap.from(items, {
        y: 60, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08, clearProps: 'transform,opacity',
        scrollTrigger: { trigger: group, start: 'top 86%', once: true },
        onComplete: function () { items.forEach(function (it) { it.classList.remove('no-trans'); }); }
      });
    });

    // Steps connector draws as you scroll
    var line = $('.steps-line span');
    if (line) {
      gsap.fromTo(line, { scaleX: 0 }, {
        scaleX: 1, ease: 'none',
        scrollTrigger: { trigger: '.steps', start: 'top 75%', end: 'bottom 55%', scrub: true }
      });
    }

    // Hero canvas drifts and dims as you leave the hero
    var canvas = $('#hero-canvas');
    if (canvas) {
      gsap.to(canvas, {
        yPercent: 18, opacity: 0.25, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
      });
    }

    // Marquee skews slightly with scroll speed
    var track = $('.marquee-track');
    if (track) {
      var skewTo = gsap.quickTo ? gsap.quickTo(track, 'skewX', { duration: 0.5, ease: 'power3.out' }) : null;
      if (skewTo) {
        window.ScrollTrigger.create({
          trigger: '.marquee', start: 'top bottom', end: 'bottom top',
          onUpdate: function (self) { skewTo(clamp(self.getVelocity() / -300, -8, 8)); },
          onLeave: function () { skewTo(0); },
          onLeaveBack: function () { skewTo(0); }
        });
      }
    }

    // Recalculate positions once fonts and images have loaded
    window.addEventListener('load', function () { window.ScrollTrigger.refresh(); });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { window.ScrollTrigger.refresh(); });
  }

  /* ---------------- Number counters ---------------- */
  function animateCount(el) {
    var to = parseFloat(el.getAttribute('data-count'));
    if (isNaN(to)) return;
    var dur = 1500;
    var t0 = performance.now();
    function step(now) {
      var t = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - t, 4);
      el.textContent = Math.round(to * e).toLocaleString('en-CA');
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function initCounters() {
    var els = $$('[data-count]');
    if (!els.length || prefersReduced || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        animateCount(en.target);
      });
    }, { threshold: 0.6 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- Scroll-driven sample dashboard (Chart.js) ---------------- */
  var SAMPLE = {
    labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
    calls: [14, 15, 13, 17, 19, 22, 24, 27, 29, 33, 36, 41],
    leads: [6, 7, 6, 8, 9, 11, 12, 14, 15, 17, 19, 22]
  };

  function drawFallbackChart(canvas) {
    var box = canvas.parentElement;
    var w = box.clientWidth;
    var h = box.clientHeight;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    var pad = 12;
    var max = 45;
    function line(data, color) {
      ctx.beginPath();
      data.forEach(function (v, i) {
        var x = pad + i * (w - pad * 2) / (data.length - 1);
        var y = h - pad - (v / max) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    line(SAMPLE.calls, '#3ee0ff');
    line(SAMPLE.leads, '#8f7bff');
  }

  function initDashboard() {
    var canvas = doc.getElementById('growth-chart');
    if (!canvas) return;
    var weekEl = $('.week-num');
    var kpis = $$('[data-kpi]');
    var state = { idx: 11 };
    var chart = null;
    var ChartLib = window.Chart;

    if (ChartLib) {
      var ctx = canvas.getContext('2d');
      var h = canvas.parentElement.clientHeight || 240;
      var gA = ctx.createLinearGradient(0, 0, 0, h);
      gA.addColorStop(0, 'rgba(62,224,255,0.32)');
      gA.addColorStop(1, 'rgba(62,224,255,0)');
      var gB = ctx.createLinearGradient(0, 0, 0, h);
      gB.addColorStop(0, 'rgba(143,123,255,0.30)');
      gB.addColorStop(1, 'rgba(143,123,255,0)');
      var pointR = function (c) { return c.dataIndex === state.idx ? 5 : 0; };

      ChartLib.defaults.font.family = 'Manrope, "Segoe UI", system-ui, sans-serif';
      ChartLib.defaults.color = '#a6a4c0';

      chart = new ChartLib(ctx, {
        type: 'line',
        data: {
          labels: SAMPLE.labels,
          datasets: [
            {
              label: 'Calls', data: SAMPLE.calls.slice(), borderColor: '#3ee0ff', backgroundColor: gA,
              fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: pointR, pointHoverRadius: 6,
              pointBackgroundColor: '#3ee0ff', pointBorderColor: '#06060b', pointBorderWidth: 2
            },
            {
              label: 'Form leads', data: SAMPLE.leads.slice(), borderColor: '#8f7bff', backgroundColor: gB,
              fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: pointR, pointHoverRadius: 6,
              pointBackgroundColor: '#8f7bff', pointBorderColor: '#06060b', pointBorderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: prefersReduced ? false : { duration: 450, easing: 'easeOutQuart' },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(12,12,22,0.95)',
              borderColor: 'rgba(255,255,255,0.14)',
              borderWidth: 1,
              padding: 10,
              titleColor: '#eeedf7',
              bodyColor: '#a6a4c0',
              callbacks: {
                title: function (items) { return 'Week ' + (items[0].dataIndex + 1) + ' (sample data)'; }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: '#85839f', font: { size: 11 }, maxRotation: 0, autoSkip: true }
            },
            y: {
              beginAtZero: true,
              suggestedMax: 45,
              grid: { color: 'rgba(255,255,255,0.06)' },
              border: { display: false },
              ticks: { color: '#85839f', font: { size: 11 }, stepSize: 10 }
            }
          }
        }
      });
    } else {
      drawFallbackChart(canvas);
    }

    function setProgress(p) {
      p = clamp(p, 0, 1);
      var idx = Math.round(p * 11);
      kpis.forEach(function (el) {
        var series = el.getAttribute('data-series');
        if (series && SAMPLE[series]) {
          el.textContent = SAMPLE[series][idx];
        } else {
          var to = parseFloat(el.getAttribute('data-kpi'));
          var from = parseFloat(el.getAttribute('data-kpi-from'));
          el.textContent = Math.round(from + (to - from) * p);
        }
      });
      if (idx === state.idx) return;
      state.idx = idx;
      if (weekEl) weekEl.textContent = idx + 1;
      if (chart) {
        chart.data.datasets[0].data = SAMPLE.calls.map(function (v, i) { return i <= idx ? v : null; });
        chart.data.datasets[1].data = SAMPLE.leads.map(function (v, i) { return i <= idx ? v : null; });
        chart.update();
      }
    }

    if (!hasST || prefersReduced) return; // everything stays at its final (week 12) state

    var gsap = window.gsap;
    state.idx = -1;
    setProgress(0);
    var proxy = { p: 0 };

    function bind(triggerEl, opts) {
      proxy.p = 0;
      var tween = gsap.to(proxy, {
        p: 1,
        ease: 'none',
        scrollTrigger: Object.assign({ trigger: triggerEl, scrub: 0.6 }, opts),
        onUpdate: function () { setProgress(proxy.p); }
      });
      return function () { if (tween.scrollTrigger) tween.scrollTrigger.kill(); tween.kill(); };
    }

    var pinQuery = '(min-width: 961px) and (min-height: 760px)';
    if (typeof gsap.matchMedia === 'function') {
      var mm = gsap.matchMedia();
      mm.add(pinQuery, function () {
        return bind('.dash-pin', { start: 'top top', end: '+=110%', pin: true, anticipatePin: 1 });
      });
      mm.add('not all and ' + pinQuery, function () {
        return bind('.dashboard', { start: 'top 85%', end: 'bottom 45%' });
      });
    } else {
      bind('.dashboard', { start: 'top 85%', end: 'bottom 45%' });
    }
  }

  /* ---------------- Pointer effects: spotlight, magnetic, cursor ---------------- */
  function initSpotlight() {
    if (!finePointer) return;
    $$('.spot').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }, { passive: true });
    });
  }

  function initMagnetic() {
    if (!finePointer || prefersReduced) return;
    $$('.magnetic').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = clamp((e.clientX - (r.left + r.width / 2)) * 0.2, -10, 10);
        var y = clamp((e.clientY - (r.top + r.height / 2)) * 0.3, -7, 7);
        el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }

  function initCursor() {
    var ring = $('.cursor-ring');
    if (!ring || !finePointer || prefersReduced) return;
    var x = -100, y = -100, tx = -100, ty = -100;
    var active = false;
    window.addEventListener('pointermove', function (e) {
      tx = e.clientX;
      ty = e.clientY;
      if (!active) {
        active = true;
        x = tx; y = ty;
        ring.classList.add('is-active');
      }
    }, { passive: true });
    root.addEventListener('mouseleave', function () {
      active = false;
      ring.classList.remove('is-active');
    });
    doc.addEventListener('pointerover', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('a, button, summary, label, input, select, textarea') : null;
      ring.classList.toggle('is-hover', !!t);
    });
    (function loop() {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      ring.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      requestAnimationFrame(loop);
    })();
  }

  /* ---------------- Audit form ---------------- */
  function initForm() {
    var form = doc.getElementById('audit-form');
    if (!form) return;
    var success = doc.getElementById('form-success');
    var status = doc.getElementById('form-status');
    var btn = form.querySelector('.submit-btn');
    var btnLabel = btn ? btn.querySelector('.btn-label') : null;
    var btnText = btnLabel ? btnLabel.textContent : '';
    var resetBtn = doc.getElementById('form-reset');
    var successMsg = success ? success.querySelector('.success-msg') : null;

    // Rules in the same order as the fields appear on the page
    var rules = {
      name: function (v) {
        return v.trim().length >= 2 ? '' : 'Please enter your name.';
      },
      business: function (v) {
        return v.trim().length >= 2 ? '' : 'Please enter your business name.';
      },
      website: function (v) {
        v = v.trim();
        if (!v) return '';
        return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(v) ? '' : 'Please enter a web address like yourbusiness.ca, or leave it blank.';
      },
      email: function (v) {
        v = v.trim();
        if (!v) return 'Please enter your email so we can send your report.';
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : "That email doesn't look right. Please check it.";
      },
      phone: function (v) {
        v = v.trim();
        if (!v) return '';
        var digits = v.replace(/\D/g, '');
        return (digits.length === 10 || (digits.length === 11 && digits.charAt(0) === '1')) ? '' : 'Please enter a 10-digit phone number, or leave it blank.';
      },
      city: function (v) {
        return v ? '' : 'Please choose where your business is.';
      }
    };
    var names = Object.keys(rules);

    function field(name) { return form.elements.namedItem(name); }

    function validateField(name) {
      var f = field(name);
      if (!f) return true;
      var msg = rules[name](f.value || '');
      var err = doc.getElementById('err-' + name);
      if (err) err.textContent = msg;
      if (msg) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
      return !msg;
    }

    names.forEach(function (name) {
      var f = field(name);
      if (!f) return;
      f.addEventListener('blur', function () {
        if ((f.value && f.value.trim()) || f.getAttribute('aria-invalid') === 'true') validateField(name);
      });
      f.addEventListener(f.tagName === 'SELECT' ? 'change' : 'input', function () {
        if (f.getAttribute('aria-invalid') === 'true') validateField(name);
      });
    });

    function showSuccess(name) {
      var first = (name || '').trim().split(/\s+/)[0];
      if (successMsg) {
        successMsg.textContent = (first ? 'Thanks, ' + first + '. ' : 'Thanks. ') +
          'Austin will reply within 1 business day, and your written audit will arrive within 3 business days.';
      }
      form.hidden = true;
      if (success) {
        success.hidden = false;
        try { success.focus({ preventScroll: true }); } catch (err) { success.focus(); }
        var card = success.parentElement;
        if (card && card.getBoundingClientRect().top < 0) scrollToTarget(card, false);
      }
      if (hasST) window.ScrollTrigger.refresh();
    }

    function setLoading(on) {
      if (!btn) return;
      btn.classList.toggle('is-loading', on);
      if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
      btn.disabled = on;
      if (btnLabel) btnLabel.textContent = on ? 'Sending...' : btnText;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (status) status.textContent = '';

      var firstInvalid = null;
      names.forEach(function (name) {
        if (!validateField(name) && !firstInvalid) firstInvalid = field(name);
      });
      if (firstInvalid) {
        if (status) status.textContent = 'Please check the highlighted fields.';
        firstInvalid.focus();
        return;
      }

      // Honeypot filled: quietly pretend it worked and send nothing
      var hp = field('company_url');
      if (hp && hp.value) { showSuccess(''); return; }

      var data = new FormData(form);
      var payload = {
        name: String(data.get('name') || '').trim(),
        business: String(data.get('business') || '').trim(),
        website: String(data.get('website') || '').trim(),
        email: String(data.get('email') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        city: String(data.get('city') || ''),
        goals: data.getAll('goals'),
        message: String(data.get('message') || '').trim(),
        foundingClientInterest: data.get('founding') === 'yes',
        source: 'opengrowth.ca free audit form',
        submittedAt: new Date().toISOString()
      };

      setLoading(true);

      /* ------------------------------------------------------------------
         TODO(n8n): send the request to your n8n Webhook node.
         1. In n8n, add a "Webhook" trigger node (HTTP Method: POST) and copy its Production URL.
         2. Replace the simulated request below with:

         fetch('https://YOUR-N8N-DOMAIN/webhook/open-growth-audit', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(payload)
         }).then(function (res) {
           if (!res.ok) throw new Error('Request failed: ' + res.status);
         })

         3. Enable CORS for your site's domain on the webhook (Webhook node > Options > Allowed Origins).
         ------------------------------------------------------------------ */
      var request = new Promise(function (resolve) { setTimeout(resolve, 900); }); // simulated request, no backend yet

      request.then(function () {
        setLoading(false);
        showSuccess(payload.name);
      }).catch(function () {
        setLoading(false);
        if (status) status.textContent = 'Sorry, something went wrong. Please call (403) 555-0142 or email hello@opengrowth.ca.';
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        form.reset();
        names.forEach(function (name) {
          var f = field(name);
          if (f) f.removeAttribute('aria-invalid');
          var err = doc.getElementById('err-' + name);
          if (err) err.textContent = '';
        });
        if (status) status.textContent = '';
        if (success) success.hidden = true;
        form.hidden = false;
        var first = field('name');
        if (first) first.focus();
        if (hasST) window.ScrollTrigger.refresh();
      });
    }
  }

  /* ---------------- Misc ---------------- */
  function initYear() {
    var y = doc.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /* ---------------- Boot ---------------- */
  safe(initIcons, 'icons');
  safe(initYear, 'year');
  safe(initLenis, 'smooth scroll');
  safe(initMenu, 'menu');
  safe(initAnchors, 'anchors');
  safe(initScrollUI, 'scroll UI');
  safe(initActiveNav, 'active nav');
  safe(initHero3D, 'hero 3D');
  safe(initHeroIntro, 'hero intro');
  safe(initHeroParallax, 'hero parallax');
  safe(initLeadTimer, 'lead timer');
  safe(initDashboard, 'dashboard');
  safe(initReveals, 'reveals');
  safe(initCounters, 'counters');
  safe(initSpotlight, 'spotlight');
  safe(initMagnetic, 'magnetic buttons');
  safe(initCursor, 'cursor');
  safe(initForm, 'form');
})();
