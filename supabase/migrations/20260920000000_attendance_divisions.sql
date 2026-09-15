-- ---------------------------------------------------------------------------
-- Attendance divisions for church attendance.
--
-- The original CHURCH_ATTENDANCE rules used free-form time bands (7:00-8:00,
-- 8:00-8:15, …). This migration replaces them with the four liturgy stages the
-- church tracks, each with its own points:
--
--   باكر          07:00 – 07:45 → 10
--   تقديم الحمل   07:45 – 08:15 → 8
--   تحليل الخدام  08:15 – 08:40 → 6
--   الإنجيل       08:40 – 09:40 → 4
--
-- Old CHURCH bands are hard-deleted (the scoring engine ignores archived rules
-- anyway) and their `score_records.rule_id` links are set to null via the
-- existing `on delete set null` FK, so historical points are preserved. The
-- total active+archived rule count stays at 12 (4 removed + 4 added), which
-- the settings e2e baseline expects.
--
-- SERVICE_ATTENDANCE bands are unchanged.
-- ---------------------------------------------------------------------------

delete from public.scoring_rules
  where category = 'CHURCH_ATTENDANCE';

insert into public.scoring_rules (category, name, point_value, applicable_role, start_time, end_time, sort_order) values
  ('CHURCH_ATTENDANCE', 'باكر', 10, '{SERVED_MEMBER}', '07:00', '07:45', 10),
  ('CHURCH_ATTENDANCE', 'تقديم الحمل', 8, '{SERVED_MEMBER}', '07:45', '08:15', 20),
  ('CHURCH_ATTENDANCE', 'تحليل الخدام', 6, '{SERVED_MEMBER}', '08:15', '08:40', 30),
  ('CHURCH_ATTENDANCE', 'الإنجيل', 4, '{SERVED_MEMBER}', '08:40', '09:40', 40);