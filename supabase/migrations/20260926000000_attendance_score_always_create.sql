-- Fix: always create score_records for served members when attendance is
-- recorded, even when points = 0. Previously the RPC only inserted when
-- points > 0, which meant the attendance category never appeared in the
-- member's score breakdown for outside-band check-ins.
--
-- Also update the RPC to accept p_period_key so attendance-derived scores
-- carry the same period key the weekly/monthly engine expects.

create or replace function public.record_attendance_with_score(
  p_session_id uuid,
  p_profile_id uuid,
  p_attended_at timestamptz,
  p_points numeric,
  p_recorded_by uuid,
  p_source text,
  p_score_category text,
  p_score_rule_id uuid,
  p_session_date text,
  p_period_key text default null
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

  if p_score_category is not null then
    insert into public.score_records (
      profile_id, category, points, rule_id, attendance_record_id,
      session_date, recorded_by, period_key
    ) values (
      p_profile_id, (p_score_category)::public.scoring_category, p_points,
      p_score_rule_id, v_record.id, (p_session_date)::date, p_recorded_by,
      p_period_key
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
