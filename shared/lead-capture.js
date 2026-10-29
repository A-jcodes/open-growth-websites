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
      page_url: w.location.href.split('#')[0].slice(0, 500)
    };
    return fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Prefer': 'return=minimal'   // anon cannot read rows back, so ask for no body
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('Lead save failed: HTTP ' + res.status);
    });
  }

  w.OGLeads = { submit: submit, REVENUE_RANGES: REVENUE_RANGES };
})(window);
