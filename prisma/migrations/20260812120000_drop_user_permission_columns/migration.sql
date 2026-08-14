-- Drop the per-user permission columns from `users`.
--
-- These described an access-control model the server never implemented: no API
-- route read any of them, and the only consumers were client-side nav gating and
-- three helpers in contexts/AuthContext.tsx with no callers. `sections` in
-- particular pointed at pages — projects, automations, partners — that were
-- deleted with the internal-tools side of the dashboard.
--
-- `role` stays: POST /api/auth/login refuses any account whose role is not
-- 'admin', and requireAdmin() in lib/auth.ts gates the user-management routes.
--
-- Written as dynamic SQL rather than a plain ALTER because on a FRESH database
-- there is nothing here to drop. `users` was created by an early `prisma db
-- push` and never captured in a migration, so replaying full history reached
-- this file with no `users` table at all and failed with 1146 (and, once the
-- table is created by 20260814000000, would fail with 1091 on the columns).
-- MySQL has no DROP COLUMN IF EXISTS — that is MariaDB — so the statement is
-- built from information_schema and degrades to a no-op when nothing matches.
SET @cols := (
  SELECT GROUP_CONCAT(CONCAT('DROP COLUMN `', COLUMN_NAME, '`') SEPARATOR ', ')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME IN ('sections', 'can_add', 'can_edit', 'can_delete', 'can_sync', 'owner_filter', 'orgs')
);

SET @sql := IF(@cols IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `users` ', @cols));

PREPARE stmt FROM @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;
