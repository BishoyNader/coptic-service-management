-- Migration: Differentiate attendance vs activities.
--
-- Adds two columns to activities:
--   attendance_type: links an activity to CHURCH or SERVICE attendance (NULL = general)
--   input_type: 'checkbox' (on/off, full max_score) or 'score' (numeric 0-max_score)

-- 1. Add columns
alter table public.activities
  add column if not exists attendance_type attendance_type,
  add column if not exists input_type text not null default 'score'
    check (input_type in ('checkbox', 'score'));

-- 2. Tag existing SERVED_MEMBER activities with their attendance type.
--    CHURCH-related activities:
update public.activities set attendance_type = 'CHURCH', input_type = 'score'
  where code = 'MEMBER_MEMORIZATION';
update public.activities set attendance_type = 'CHURCH', input_type = 'score'
  where code = 'MEMBER_LESSON';

--    SERVICE-related activities:
update public.activities set attendance_type = 'SERVICE', input_type = 'score'
  where code = 'MEMBER_CONDUCT';
update public.activities set attendance_type = 'SERVICE', input_type = 'score'
  where code = 'MEMBER_HELP';
update public.activities set attendance_type = 'SERVICE', input_type = 'checkbox'
  where code = 'MEMBER_CRAFT';

-- 3. SERVANT activities remain NULL (general, not tied to a specific attendance type)
-- They are already for_role = 'SERVANT' and will keep attendance_type = NULL.
