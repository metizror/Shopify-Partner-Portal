-- Catch-up migration: create the two tables that migration history never had.
--
-- `users` and `partner_managed_stores` are both in schema.prisma and both exist
-- on the running installation, but they were created there by `prisma db push`
-- and no CREATE TABLE for either was ever committed. Nobody noticed because the
-- server was never rebuilt from an empty database — until someone cloned the
-- repo and ran `npx prisma migrate deploy`, which reached
-- 20260812120000_drop_user_permission_columns with no `users` table to alter.
--
-- IF NOT EXISTS is what makes this safe to apply to the existing database: there
-- it is a no-op that only writes the row in `_prisma_migrations`. On a fresh
-- database it does the real work. Column types below are exactly what
-- `prisma migrate diff` emits for the current schema.prisma, so `migrate status`
-- reports no drift either way.

CREATE TABLE IF NOT EXISTS `users` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `users_email_key`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `partner_managed_stores` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `org_id` VARCHAR(32) NOT NULL,
  `shop_id` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `domain` VARCHAR(255) NOT NULL,
  `url` VARCHAR(512) NOT NULL,
  `plan` VARCHAR(128) NULL,
  `access` VARCHAR(32) NULL,
  `state` VARCHAR(32) NULL,
  `started` VARCHAR(32) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `partner_managed_stores_domain_key`(`domain`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
