-- AlterTable: capture the uninstall reason + free-text feedback per store
ALTER TABLE `shopify_app_users`
    ADD COLUMN `uninstall_reason` TEXT NULL,
    ADD COLUMN `uninstall_description` TEXT NULL;
