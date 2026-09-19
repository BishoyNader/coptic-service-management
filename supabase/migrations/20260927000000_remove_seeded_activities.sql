-- Remove previously seeded SERVED_MEMBER activities.
-- The scoring board and member activity tab should start clean.

DELETE FROM public.member_activity_scores
WHERE activity_id IN (
  SELECT id FROM public.activities
  WHERE code IN ('MEMBER_MEMORIZATION', 'MEMBER_CONDUCT', 'MEMBER_LESSON', 'MEMBER_HELP', 'MEMBER_CRAFT')
);

DELETE FROM public.activities
WHERE code IN ('MEMBER_MEMORIZATION', 'MEMBER_CONDUCT', 'MEMBER_LESSON', 'MEMBER_HELP', 'MEMBER_CRAFT');
