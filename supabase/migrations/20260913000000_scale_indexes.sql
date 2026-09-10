-- Phase 8: targeted indexes for report date-range queries,
-- member name search, and audit-log pagination.

-- Enables trigram for ILIKE '%query%' search on member names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Reports: date-range filters on attendance_records
-- The existing (profile_id, attended_at DESC) index does not help
-- date-only range scans.  A standalone index on attended_at supports
-- the report WHERE clause efficiently.
CREATE INDEX idx_attendance_records_attended_at
  ON attendance_records (attended_at DESC);

-- Reports: date-range filters on score_records
CREATE INDEX idx_score_records_session_date
  ON score_records (session_date DESC)
  WHERE is_voided = false;

-- Reports: date-range filters on servant_activity_records
CREATE INDEX idx_servant_activity_records_recorded_on
  ON servant_activity_records (recorded_on DESC);

-- Members search: trigram index on full_name for ILIKE '%query%'
CREATE INDEX idx_profiles_full_name_trgm
  ON profiles USING gin (full_name gin_trgm_ops);

-- Members list: composite index for the common query pattern
-- (role = SERVED_MEMBER, status = ACTIVE, order by full_name)
CREATE INDEX idx_profiles_role_status_name
  ON profiles (role, status, full_name);

-- Audit log: supports the ORDER BY created_at DESC pagination pattern
-- already has idx on (created_at DESC), but adding a covering index
-- that includes entity for common filter patterns.
CREATE INDEX idx_audit_logs_created_entity
  ON audit_logs (created_at DESC, entity);

-- Delivery log: date-range support for the report's attempted_at ordering
CREATE INDEX idx_deliveries_attempted_recipient
  ON notification_deliveries (recipient_profile_id, attempted_at DESC);
