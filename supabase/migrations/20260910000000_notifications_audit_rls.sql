-- Phase 5A — Notification + audit security foundation.
--
--  1. Members/servants may read a notification ONLY when they are a real
--     recipient of it (authoritative via notification_recipients.profile_id).
--  2. A user may mark exactly their OWN recipient row as read (read_at).
--  3. audit_logs can no longer be INSERTed by arbitrary authenticated users —
--     server-side services write audits through the service-role client,
--     which already bypasses RLS, so legitimate audit logging is unaffected.

-- ---------------------------------------------------------------------------
-- Notifications: recipient-based read (never "everyone can read").
-- ---------------------------------------------------------------------------
create policy "notifications_read_recipient" on public.notifications
  for select using (
    exists (
      select 1
      from public.notification_recipients as nr
      where nr.notification_id = public.notifications.id
        and nr.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Notification recipients: users update only their own row (read_at).
-- ---------------------------------------------------------------------------
create policy "notification_recipients_own_update" on public.notification_recipients
  for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- Audit logs: remove the permissive authenticated INSERT.
-- Only the service-role client (server-side logAudit) writes audits now.
-- ---------------------------------------------------------------------------
drop policy if exists "audit_logs_insert_any" on public.audit_logs;