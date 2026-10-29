/* Shared lead submit for all Open Growth designs.
   window.OGLeads.submit({ name, email, revenue_range, biggest_problem, source }) -> Promise
   Talks to Supabase's REST API directly, so no SDK or build step is needed. */
(function (w) {
  'use strict';

  var REVENUE_RANGES = [
    '$0 - $1,000',
    '$1,000 - $10,000',
    '$10,000 - $100,000',
    '$100,000 - $1 million',
    '$1 million+'
  ];

  function submit(lead) {
    var cfg = w.OG_SUPABASE || {};
    if (!cfg.url || !cfg.anonKey) {
      return Promise.reject(new Error('Supabase is not configured. Fill in shared/supabase-config.js.'));
    }
    var body = {
      name: lead.name,
      email: lead.email,
      revenue_range: lead.revenue_range,
      biggest_problem: lead.biggest_problem,
      source: lead.source || 'unknown',
      offer: lead.offer || 'calls-checklist',
      page_url: w.location.href.split('#')[0].slice(0, 500)
    };
    var headers = {
      'Content-Type': 'application/json',
      'apikey': cfg.anonKey,
      'Prefer': 'return=minimal'   // anon cannot read rows back, so ask for no body
    };
    // Legacy anon keys are JWTs and go in Authorization too. New sb_publishable_ keys must not.
    if (cfg.anonKey.indexOf('sb_') !== 0) headers['Authorization'] = 'Bearer ' + cfg.anonKey;
    return fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/leads', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('Lead save failed: HTTP ' + res.status);
    });
  }

  w.OGLeads = { submit: submit, REVENUE_RANGES: REVENUE_RANGES };
})(window);
