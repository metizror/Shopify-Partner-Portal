-- AlterTable
ALTER TABLE `shopify_app_events` ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'unknown';
