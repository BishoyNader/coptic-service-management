-- ============================================================================
-- PHASE 10 — Production hardening
--
-- 1. Rate limiting (DB-backed, distributed-safe for serverless deploys).
--    request_throttles + consume_rate_limit() (SECURITY DEFINER, safe
--    search_path, EXECUTE restricted to service_role). Public registration
--    and export/notification server actions use it; the counter is shared
--    across instances because it lives in the database.
--
-- 2. Restrict birthdays_for_today() EXECUTE to the service role. The function
--    is SECURITY DEFINER and returns member phones; leaving PUBLIC execute
--    on it let any client (anon/authenticated) enumerate active members'
--    phone numbers via PostgREST. Only the birthday automation service
--    (service-role) and our cron route need it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Rate limiting buckets
-- ---------------------------------------------------------------------------
create table if not exists public.request_throttles (
  throttle_key   text primary key,
  window_start   timestamptz not null default now(),
  count          integer     not null default 0
);

alter table public.request_throttles enable row level security;

-- No policies are created on purpose: the only writer/reader is the
-- SECURITY DEFINER function below (OR the service role directly). Client
-- roles can neither read nor write these rows.

-- ---------------------------------------------------------------------------
-- consume_rate_limit(p_key, p_limit, p_window_seconds) → allowed?
--   Atomic windowed counter. Returns false once the window budget is spent;
--   a fresh window (either a new key or an expired old window) resets to 1.
-- ---------------------------------------------------------------------------
create or replace function public.consume_rate_limit(
  p_key             text,
  p_limit           integer,
  p_window_seconds  integer
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_now       timestamptz := clock_timestamp();
  v_allowed   boolean;
begin
  -- Caller bug: never hard-block because of a misconfiguration upstream.
  if p_key is null or p_key = '' or p_limit is null or p_window_seconds is null
     or p_limit < 1 or p_window_seconds < 1 then
    return true;
  end if;

  update public.request_throttles
     set count = count + 1
   where throttle_key = p_key
     and window_start > v_now - make_interval(secs => p_window_seconds)
   returning count <= p_limit into v_allowed;

  if v_allowed is null then
    -- No active window: reset (either first hit or an expired window).
    insert into public.request_throttles (throttle_key, window_start, count)
    values (p_key, v_now, 1)
    on conflict (throttle_key) do update
      set window_start = v_now, count = 1;
    v_allowed := 1 <= p_limit;
  end if;

  -- Opportunistic sweep so the table stays tiny (bounded, throttled writes).
  delete from public.request_throttles
   where window_start < now() - interval '7 days';

  return v_allowed;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- birthdays_for_today(): service-role only (returns member PII)
-- ---------------------------------------------------------------------------
revoke all on function public.birthdays_for_today(date)
  from public, anon, authenticated;
grant execute on function public.birthdays_for_today(date)
  to service_role;