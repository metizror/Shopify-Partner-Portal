-- The Shopify uninstall survey, carried on the snapshot so a delayed Flow email
-- still has it days later. Both nullable: the survey is optional and most
-- merchants skip it. Additive only — safe to apply before the code deploys.
ALTER TABLE `uninstall_snapshots`
    ADD COLUMN `uninstall_reason` TEXT NULL,
    ADD COLUMN `reason_detail` TEXT NULL;
