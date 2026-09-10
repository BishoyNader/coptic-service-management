-- ---------------------------------------------------------------------------
-- PHASE 9 — Data integrity hardening.
--
--   1. profiles.date_of_birth may never be in the future (DB-level backstop
--      for the server-side validation added in the Phase 9 actions).
--   2. Servants may record and (same-day) remove their OWN activity records
--      directly via RLS in addition to the admin-client server action.
--   3. Transactional RPCs for the multi-write operations the audit flagged:
--        * attendance record + earned score          -> record_attendance_with_score
--        * attendance void (archive + void score)    -> void_attendance
--        * attendance type change (record + score)   -> correct_attendance_type
--        * whole weekly score card (5 categories)    -> save_weekly_scores
--        * notification + recipient fan-out          -> create_notification
--      Every RPC is EXECUTE-restricted to the service role ONLY. Clients can
--      never reach them directly — the server actions remain the sole entry
--      point, and they keep authorization + auditing in the Next.js layer.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Date-of-birth integrity
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_date_of_birth_not_future;

alter table public.profiles
  add constraint profiles_date_of_birth_not_future
  check (date_of_birth is null or date_of_birth <= current_date);

-- ---------------------------------------------------------------------------
-- 2. Servant activity self-recording (defense-in-depth for RLS paths).
--    The role check keeps ANY authenticated account (e.g. a plain member)
--    from self-inserting servant activity rows. `recorded_on` may never be
--    a future Cairo date at the DB level either.
-- ---------------------------------------------------------------------------
alter table public.servant_activity_records
  drop constraint if exists servant_activity_no_future;

alter table public.servant_activity_records
  add constraint servant_activity_no_future
  check (recorded_on <= current_date);

create policy "servant_activity_own_write" on public.servant_activity_records
  for insert with check (
    auth.uid() = servant_id
    and recorded_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'SERVANT'
    )
  );

create policy "servant_activity_own_delete_today" on public.servant_activity_records
  for delete using (
    auth.uid() = servant_id
    and recorded_on = current_date
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'SERVANT'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Transactional RPCs (service-role only)
-- ---------------------------------------------------------------------------

-- --- 3.1 Attendance check-in + earned score, atomically --------------------
-- Handles the duplicate race on the partial (profile_id, session_id) unique
-- index and returns the same contract the engine's TS code used.
create or replace function public.record_attendance_with_score(
  p_session_id uuid,
  p_profile_id uuid,
  p_attended_at timestamptz,
  p_points numeric,
  p_recorded_by uuid,
  p_source text,
  p_score_category text,
  p_score_rule_id uuid,
  p_session_date text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_record public.attendance_records%rowtype;
begin
  select * into v_record
    from public.attendance_records
   where profile_id = p_profile_id
     and session_id = p_session_id
     and status <> 'ARCHIVED'
   limit 1;

  if v_record.id is not null then
    return jsonb_build_object(
      'status', 'duplicate',
      'id', v_record.id,
      'attended_at', v_record.attended_at,
      'points', v_record.points
    );
  end if;

  insert into public.attendance_records (
    session_id, profile_id, attended_at, points, recorded_by, source, status
  ) values (
    p_session_id, p_profile_id, p_attended_at, p_points, p_recorded_by,
    p_source, 'PRESENT'
  ) returning * into v_record;

  if p_points > 0 and p_score_category is not null then
    insert into public.score_records (
      profile_id, category, points, rule_id, attendance_record_id,
      session_date, recorded_by
    ) values (
      p_profile_id, (p_score_category)::public.scoring_category, p_points,
      p_score_rule_id, v_record.id, (p_session_date)::date, p_recorded_by
    );
  end if;

  return jsonb_build_object(
    'status', 'success',
    'id', v_record.id,
    'attended_at', v_record.attended_at,
    'points', v_record.points
  );
exception
  when unique_violation then
    select * into v_record
      from public.attendance_records
     where profile_id = p_profile_id
       and session_id = p_session_id
       and status <> 'ARCHIVED'
     limit 1;
    if v_record.id is not null then
      return jsonb_build_object(
        'status', 'duplicate',
        'id', v_record.id,
        'attended_at', v_record.attended_at,
        'points', v_record.points
      );
    end if;
    raise;
end;
$$;

-- --- 3.2 Attendance void: archive record + soft-void score, atomically -----
create or replace function public.void_attendance(p_record_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.attendance_records
   where id = p_record_id;

  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_status = 'ARCHIVED' then
    return jsonb_build_object('ok', false, 'error', 'already_archived');
  end if;

  update public.attendance_records set status = 'ARCHIVED' where id = p_record_id;
  update public.score_records set is_voided = true where attendance_record_id = p_record_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- --- 3.3 Attendance type change: move + resize score, atomically -----------
create or replace function public.correct_attendance_type(
  p_record_id uuid,
  p_new_session_id uuid,
  p_new_points numeric,
  p_score_category text,
  p_score_rule_id uuid,
  p_session_date text,
  p_actor_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_record public.attendance_records%rowtype;
  v_score public.score_records%rowtype;
begin
  select * into v_record from public.attendance_records where id = p_record_id;
  if v_record.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_record.status = 'ARCHIVED' then
    return jsonb_build_object('ok', false, 'error', 'already_archived');
  end if;

  update public.attendance_records
     set session_id = p_new_session_id,
         points = p_new_points,
         status = 'PRESENT'
   where id = p_record_id;

  select * into v_score from public.score_records
   where attendance_record_id = p_record_id
   limit 1;

  if p_new_points > 0 and p_score_category is not null then
    if v_score.id is not null then
      update public.score_records
         set category = (p_score_category)::public.scoring_category,
             points = p_new_points,
             rule_id = p_score_rule_id,
             session_date = (p_session_date)::date,
             is_voided = false
       where id = v_score.id;
    else
      insert into public.score_records (
        profile_id, category, points, rule_id, attendance_record_id,
        session_date, recorded_by
      ) values (
        v_record.profile_id, (p_score_category)::public.scoring_category,
        p_new_points, p_score_rule_id, p_record_id, (p_session_date)::date,
        p_actor_id
      );
    end if;
  else
    if v_score.id is not null and not v_score.is_voided then
      update public.score_records set is_voided = true where id = v_score.id;
    end if;
  end if;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

-- --- 3.4 Whole weekly score card, all-or-nothing ---------------------------
-- `p_items` is a jsonb array: [{ category, points, rule_id, session_date,
-- period_key, note }]. All values are DERIVED SERVER-SIDE in the Next.js
-- scoring service (rule values + commitment rules are applied there); this
-- function only persists them atomically. It returns a per-category summary
-- { category, status: created|updated|voided|unchanged, id, prev_points,
-- prev_note } so the caller can emit the exact audit entries it always has.
create or replace function public.save_weekly_scores(
  p_profile_id uuid,
  p_actor_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_category text;
  v_points numeric;
  v_rule_id uuid;
  v_session_date text;
  v_period_key text;
  v_note text;
  v_existing public.score_records%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_category := v_item->>'category';
    v_points := (v_item->>'points')::numeric;
    v_rule_id := nullif(v_item->>'rule_id', '')::uuid;
    v_session_date := v_item->>'session_date';
    v_period_key := v_item->>'period_key';
    v_note := v_item->>'note';

    select * into v_existing from public.score_records
     where profile_id = p_profile_id
       and category = (v_category)::public.scoring_category
       and period_key = v_period_key
       and is_voided = false
     limit 1;

    if v_existing.id is null then
      if v_points > 0 then
        insert into public.score_records (
          profile_id, category, points, rule_id, session_date, note,
          recorded_by, period_key
        ) values (
          p_profile_id, (v_category)::public.scoring_category, v_points,
          v_rule_id, (v_session_date)::date, v_note, p_actor_id, v_period_key
        ) returning * into v_existing;
        v_result := jsonb_build_object(
          'category', v_category, 'status', 'created', 'id', v_existing.id,
          'prev_points', 0
        );
      else
        v_result := jsonb_build_object('category', v_category, 'status', 'unchanged');
      end if;
    elsif v_points = 0 then
      update public.score_records
         set is_voided = true, recorded_by = p_actor_id
       where id = v_existing.id;
      v_result := jsonb_build_object(
        'category', v_category, 'status', 'voided', 'id', v_existing.id,
        'prev_points', v_existing.points, 'prev_note', v_existing.note
      );
    elsif v_points <> v_existing.points then
      update public.score_records
         set points = v_points,
             rule_id = v_rule_id,
             note = coalesce(v_note, v_existing.note),
             recorded_by = p_actor_id
       where id = v_existing.id;
      v_result := jsonb_build_object(
        'category', v_category, 'status', 'updated', 'id', v_existing.id,
        'prev_points', v_existing.points, 'prev_note', v_existing.note
      );
    else
      v_result := jsonb_build_object('category', v_category, 'status', 'unchanged');
    end if;

    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return v_results;
end;
$$;

-- --- 3.5 Notification + recipient fan-out, all-or-nothing ------------------
create or replace function public.create_notification(
  p_title text,
  p_body text,
  p_audience text[],
  p_sender_id uuid,
  p_recipient_ids uuid[],
  p_batch_size integer default 500
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_notif_id uuid;
  v_recipient_count integer := 0;
  v_i integer;
  v_chunk_end integer;
  v_len integer;
begin
  insert into public.notifications (title, body, audience, sender_id)
  values (p_title, p_body, (p_audience)::public.app_role[], p_sender_id)
  returning id into v_notif_id;

  if p_recipient_ids is not null then
    v_len := array_length(p_recipient_ids, 1);
    if v_len > 0 then
      for v_i in 1 .. v_len by p_batch_size
      loop
        v_chunk_end := least(v_i + p_batch_size - 1, v_len);
        insert into public.notification_recipients (notification_id, profile_id)
        select v_notif_id, unnest(p_recipient_ids[v_i:v_chunk_end]);
        v_recipient_count := v_recipient_count + (v_chunk_end - v_i + 1);
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_notif_id,
    'recipient_count', v_recipient_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Lock every RPC to the service role. Default PUBLIC EXECUTE is removed
--    so anon/authenticated clients can never call these functions directly.
-- ---------------------------------------------------------------------------
revoke all on function public.record_attendance_with_score(uuid, uuid, timestamptz, numeric, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_attendance_with_score(uuid, uuid, timestamptz, numeric, uuid, text, text, uuid, text) to service_role;

revoke all on function public.void_attendance(uuid) from public, anon, authenticated;
grant execute on function public.void_attendance(uuid) to service_role;

revoke all on function public.correct_attendance_type(uuid, uuid, numeric, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.correct_attendance_type(uuid, uuid, numeric, text, uuid, text, uuid) to service_role;

revoke all on function public.save_weekly_scores(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_weekly_scores(uuid, uuid, jsonb) to service_role;

revoke all on function public.create_notification(text, text, text[], uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.create_notification(text, text, text[], uuid, uuid[], integer) to service_role;