-- ---------------------------------------------------------------------------
-- Member-graded activities.
--
-- The `activities` table originally held SERVANT self-tracking rows only.
-- Phase 14 added min_score/max_score to it; this migration seeds a useful
-- SERVED_MEMBER activity set so the servant scoring board (grades every
-- active served member per day) and the member "درجاتي" activity tab have
-- something to show out of the box.
--
-- Attendance (CHURCH / SERVICE) is deliberately NOT seeded here: it is
-- already auto-scored by the attendance engine and would double-count if it
-- were also a graded activity.
-- ---------------------------------------------------------------------------

insert into public.activities (code, name, icon, for_role, sort_order, min_score, max_score)
values
  ('MEMBER_MEMORIZATION', 'حفظ المزامير', 'BookOpen', 'SERVED_MEMBER', 10, 0, 10),
  ('MEMBER_CONDUCT', 'السلوك الحسن', 'Star', 'SERVED_MEMBER', 20, 0, 10),
  ('MEMBER_LESSON', 'المشاركة في الدرس', 'GraduationCap', 'SERVED_MEMBER', 30, 0, 10),
  ('MEMBER_HELP', 'مساعدة الخدمة', 'HeartHandshake', 'SERVED_MEMBER', 40, 0, 10),
  ('MEMBER_CRAFT', 'الأشغال اليدوية', 'Home', 'SERVED_MEMBER', 50, 0, 5)
on conflict (code) do nothing;