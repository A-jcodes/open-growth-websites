/* Public Supabase values for the lead form. Safe to commit: the anon key can only INSERT
   into public.leads (see supabase/leads.sql). Never put the service_role key here.
   Find both in Supabase: Project Settings > API. */
window.OG_SUPABASE = {
  url: '',      // e.g. 'https://abcdefghijkl.supabase.co'
  anonKey: ''   // the "anon public" key
};
