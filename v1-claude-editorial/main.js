/* Open Growth: interactions
   Every library is optional: if a CDN fails, the page still shows all content. */
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const hasGsap = typeof window.gsap !== 'undefined';
  const hasST = hasGsap && typeof window.ScrollTrigger !== 'undefined';
  const animate = hasGsap && !reduceMotion;

  if (hasST) gsap.registerPlugin(ScrollTrigger);

  // ---------- Icons ----------
  if (window.lucide) lucide.createIcons();

  // ---------- Year ----------
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ---------- Smooth scroll (Lenis) ----------
  let lenis = null;
  if (window.Lenis && !reduceMotion) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    if (hasST) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }

  // ---------- Anchor links ----------
  const header = document.querySelector('.site-header');
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const target = id === '#top' ? document.body : document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      document.body.classList.remove('menu-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
      const offset = -(header?.offsetHeight || 70) + 1;
      if (lenis) lenis.scrollTo(id === '#top' ? 0 : target, { offset, duration: 1.4 });
      else window.scrollTo({ top: id === '#top' ? 0 : target.getBoundingClientRect().top + window.scrollY + offset, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });

  // ---------- Header + mobile menu ----------
  const menuToggle = document.getElementById('menuToggle');
  menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  const mobileCta = document.querySelector('.mobile-cta');
  const hero = document.querySelector('.hero');
  const audit = document.getElementById('audit');
  const onScroll = () => {
    const y = window.scrollY;
    header?.classList.toggle('scrolled', y > 20);
    if (mobileCta && hero && audit) {
      const pastHero = y > hero.offsetHeight - 200;
      const atAudit = audit.getBoundingClientRect().top < window.innerHeight * 0.6;
      mobileCta.classList.toggle('show', pastHero && !atAudit);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Count-up numbers ----------
  const fmt = (n, el) => (el.dataset.format === 'comma' ? Math.round(n).toLocaleString('en-CA') : Math.round(n));
  const countUp = (el) => {
    const end = parseFloat(el.dataset.count);
    const score = el.closest('.mb-score');
    if (!animate) {
      el.textContent = fmt(end, el);
      if (score) score.style.setProperty('--p', end);
      return;
    }
    const obj = { v: 0 };
    gsap.to(obj, {
      v: end, duration: end > 500 ? 1.6 : 1.3, ease: 'power3.out',
      onUpdate: () => {
        el.textContent = fmt(obj.v, el);
        if (score) score.style.setProperty('--p', obj.v);
      },
    });
  };
  const counters = document.querySelectorAll('[data-count]');
  if (hasST && animate) {
    counters.forEach((el) => {
      ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => countUp(el) });
    });
  } else {
    counters.forEach(countUp);
  }

  // ---------- Hero intro ----------
  const title = document.getElementById('heroTitle');
  if (title && animate) {
    // Wrap each word (and each <em>) in a mask so it can slide up.
    const frag = document.createDocumentFragment();
    [...title.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          frag.appendChild(wrapWord(document.createTextNode(part)));
        });
      } else {
        frag.appendChild(wrapWord(node.cloneNode(true)));
      }
    });
    title.textContent = '';
    title.appendChild(frag);

    function wrapWord(child) {
      const outer = document.createElement('span');
      outer.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.12em;margin-bottom:-.12em;';
      const inner = document.createElement('span');
      inner.className = 'wi';
      inner.style.display = 'inline-block';
      inner.appendChild(child);
      outer.appendChild(inner);
      return outer;
    }

    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
    tl.from('.hero .eyebrow', { y: 20, opacity: 0, duration: 0.8 })
      .from('#heroTitle .wi', { yPercent: 115, duration: 1.1, stagger: 0.06 }, '-=0.5')
      .fromTo('#heroTitle .hl', { '--hl': 0 }, { '--hl': 1, duration: 0.8, stagger: 0.15, ease: 'power3.inOut' }, '-=0.5')
      .from('.hero-sub, .hero-ctas, .hero-trust', { y: 24, opacity: 0, duration: 0.9, stagger: 0.1 }, '-=0.9')
      .from('.dash-card', { y: 60, opacity: 0, rotationX: 12, duration: 1.3 }, 0.3)
      .from('.dash-card .kpi, .dash-card .feed-item', { y: 16, opacity: 0, duration: 0.6, stagger: 0.06 }, 0.9)
      .from('.float-chip', { scale: 0.6, opacity: 0, duration: 0.8, stagger: 0.15, ease: 'back.out(2)' }, 1.3);

    // Draw the sparkline
    const line = document.querySelector('.spark-line');
    if (line) {
      const len = line.getTotalLength();
      gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
      tl.to(line, { strokeDashoffset: 0, duration: 1.8, ease: 'power2.inOut' }, 0.9)
        .from('.spark-area', { opacity: 0, duration: 1.2 }, 1.6);
    }
  }

  // ---------- Scroll reveals ----------
  if (hasST && animate) {
    gsap.utils.toArray('[data-reveal]').forEach((el) => {
      gsap.from(el, {
        y: 50, opacity: 0, duration: 1.1, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      });
    });

    // Bento tiles stagger in as a group
    ScrollTrigger.batch('.bento .tile', {
      start: 'top 90%', once: true,
      onEnter: (batch) => gsap.from(batch, { y: 40, opacity: 0, scale: 0.97, duration: 0.9, stagger: 0.08, ease: 'power3.out', overwrite: true }),
    });

    // Process line fills as you scroll
    const steps = document.getElementById('steps');
    if (steps) {
      gsap.to('#stepsProgress', {
        scaleY: 1, ease: 'none',
        scrollTrigger: { trigger: steps, start: 'top 65%', end: 'bottom 65%', scrub: 0.6 },
      });
      steps.querySelectorAll('.step').forEach((step) => {
        ScrollTrigger.create({ trigger: step, start: 'top 65%', onEnter: () => step.classList.add('active'), onLeaveBack: () => step.classList.remove('active') });
      });
    }

    // Founding spots bar
    const spots = document.querySelector('.spots');
    if (spots) ScrollTrigger.create({ trigger: spots, start: 'top 90%', once: true, onEnter: () => spots.classList.add('lit') });

    // Parallax
    gsap.to('.about-photo img', { yPercent: -8, ease: 'none', scrollTrigger: { trigger: '.about-photo', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.to('.hero .blob-1', { yPercent: 40, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.from('.footer-giant', { yPercent: 40, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.site-footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });

    // Marquee speeds up with scroll velocity
    const track = document.querySelector('.marquee-track');
    if (track && lenis) {
      lenis.on('scroll', ({ velocity }) => {
        const skew = gsap.utils.clamp(-8, 8, velocity * -0.3);
        gsap.to(track, { skewX: skew, duration: 0.4, ease: 'power3.out', overwrite: 'auto' });
      });
    }
  } else {
    document.querySelectorAll('.spots').forEach((s) => s.classList.add('lit'));
    document.querySelectorAll('.step').forEach((s) => s.classList.add('active'));
    const p = document.getElementById('stepsProgress');
    if (p) p.style.transform = 'scaleY(1)';
  }

  // ---------- Pointer effects (desktop only) ----------
  if (finePointer && animate) {
    // Magnetic buttons
    document.querySelectorAll('.magnetic').forEach((btn) => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3.out' });
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.25);
        yTo((e.clientY - r.top - r.height / 2) * 0.35);
      });
      btn.addEventListener('mouseleave', () => { xTo(0); yTo(0); });
    });

    // 3D tilt
    document.querySelectorAll('[data-tilt]').forEach((wrap) => {
      const card = wrap.classList.contains('hero-visual') ? wrap.querySelector('.dash-card') : wrap;
      const max = wrap.classList.contains('hero-visual') ? 8 : 5;
      wrap.addEventListener('mousemove', (e) => {
        const r = wrap.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(card, { rotationY: px * max, rotationX: -py * max, transformPerspective: 1200, duration: 0.6, ease: 'power3.out' });
      });
      wrap.addEventListener('mouseleave', () => gsap.to(card, { rotationY: 0, rotationX: 0, duration: 0.8, ease: 'power3.out' }));
    });
  }

  // Spotlight follows the cursor on tiles
  document.querySelectorAll('.spot').forEach((tile) => {
    tile.addEventListener('pointermove', (e) => {
      const r = tile.getBoundingClientRect();
      tile.style.setProperty('--mx', `${e.clientX - r.left}px`);
      tile.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  // ---------- Results chart (Chart.js) ----------
  const series = {
    calls:    { label: 'calls',      before: [16, 18, 17, 19, 18, 17, 18, 19, 17, 18, 18, 18], after: [18, 20, 22, 25, 27, 29, 31, 33, 35, 37, 39, 41] },
    leads:    { label: 'form fills', before: [7, 8, 7, 6, 8, 7, 8, 7, 8, 7, 8, 8],             after: [8, 9, 11, 12, 14, 15, 16, 18, 19, 20, 22, 23] },
    bookings: { label: 'bookings',   before: [5, 5, 6, 5, 6, 5, 6, 6, 5, 6, 6, 6],             after: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] },
  };
  const canvas = document.getElementById('demoChart');
  const dsBefore = document.getElementById('dsBefore');
  const dsAfter = document.getElementById('dsAfter');
  const chartLabel = document.getElementById('chartLabel');
  let chart = null;

  const setStats = (key) => {
    const s = series[key];
    const b = s.before[0], a = s.after[s.after.length - 1];
    if (chartLabel) chartLabel.textContent = s.label;
    [[dsBefore, b], [dsAfter, a]].forEach(([el, v]) => {
      if (!el) return;
      if (animate) {
        const o = { v: parseFloat(el.textContent) || 0 };
        gsap.to(o, { v, duration: 0.8, ease: 'power3.out', onUpdate: () => (el.textContent = Math.round(o.v)) });
      } else el.textContent = v;
    });
  };

  const buildChart = () => {
    if (!canvas || !window.Chart || chart) return;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0, 'rgba(207,242,74,.35)');
    grad.addColorStop(1, 'rgba(207,242,74,0)');
    const s = series.calls;
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: s.after.map((_, i) => `W${i + 1}`),
        datasets: [
          { label: 'With Open Growth', data: s.after, borderColor: '#cff24a', backgroundColor: grad, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#cff24a', pointHoverBorderColor: '#0d0f0b', pointHoverBorderWidth: 3 },
          { label: 'Before', data: s.before, borderColor: '#a7ab9f', borderDash: [5, 5], fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#a7ab9f' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 1200, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#f3f0e8', titleColor: '#0d0f0b', bodyColor: '#0d0f0b', padding: 12, cornerRadius: 12,
            titleFont: { family: 'Inter Tight', weight: '700' }, bodyFont: { family: 'Inter Tight' }, displayColors: true, boxPadding: 4,
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#a7ab9f', font: { family: 'JetBrains Mono', size: 11 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(243,240,232,.08)' }, border: { display: false }, ticks: { color: '#a7ab9f', font: { family: 'JetBrains Mono', size: 11 }, maxTicksLimit: 5 } },
        },
      },
    });
  };

  if (canvas) {
    if (hasST && animate) ScrollTrigger.create({ trigger: canvas, start: 'top 85%', once: true, onEnter: buildChart });
    else buildChart();
  }

  document.querySelectorAll('#demoTabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#demoTabs .tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const key = tab.dataset.series;
      setStats(key);
      if (chart) {
        chart.data.datasets[0].data = series[key].after;
        chart.data.datasets[1].data = series[key].before;
        chart.update();
      }
    });
  });

  // ---------- FAQ: smooth open ----------
  document.querySelectorAll('.faq').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open && animate) gsap.from(d.querySelector('.faq-a'), { height: 0, opacity: 0, duration: 0.5, ease: 'power3.out', clearProps: 'height,opacity' });
      if (hasST) ScrollTrigger.refresh();
    });
  });

  // ---------- Audit form ----------
  const form = document.getElementById('auditForm');
  const chips = document.querySelectorAll('#goalChips .choice');
  chips.forEach((c) => c.addEventListener('click', () => {
    c.classList.toggle('selected');
    c.setAttribute('aria-pressed', c.classList.contains('selected'));
  }));

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('formError');
    const fields = ['name', 'business', 'email'].map((n) => form.elements[n]);
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim());
    let ok = true;
    fields.forEach((f) => {
      const bad = !f.value.trim() || (f.name === 'email' && !emailOk);
      f.classList.toggle('invalid', bad);
      if (bad) ok = false;
    });
    err.hidden = ok;
    if (!ok) {
      if (animate) gsap.fromTo(form, { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    data.goals = [...chips].filter((c) => c.classList.contains('selected')).map((c) => c.dataset.value);

    // TODO: send `data` to your n8n webhook or form service, e.g.
    // await fetch('https://YOUR-N8N-URL/webhook/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    console.info('Audit request', data);

    const inner = document.getElementById('formInner');
    const success = document.getElementById('formSuccess');
    const show = () => {
      inner.hidden = true;
      success.hidden = false;
      if (animate) {
        gsap.from(success.children, { y: 20, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out' });
        gsap.from('.success-ico', { scale: 0, rotation: -90, duration: 0.8, ease: 'back.out(2)' });
      }
    };
    if (animate) gsap.to(inner, { opacity: 0, y: -10, duration: 0.35, onComplete: show });
    else show();
  });

  form?.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => i.classList.remove('invalid')));

  // Recalculate trigger positions once fonts and images settle
  window.addEventListener('load', () => hasST && ScrollTrigger.refresh());
})();
