-- Migration 3 of 10: keep the pg_net extension out of the public schema (Supabase security advisor).
-- Applied to the live project on 2026-10-29.

drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;
