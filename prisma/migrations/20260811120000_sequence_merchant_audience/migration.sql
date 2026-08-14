-- Merchant sequences: instead of dripping over an imported sheet in batches, a
-- sequence can be triggered by a real install/uninstall event — the store is
-- enrolled when the event fires, gets the fresh email immediately, then
-- follow-up 1 after `fu1_days` and follow-up 2 `fu2_days` after that.
--
-- Additive + widening only, so existing sheet sequences are untouched:
--   * campaign_id becomes nullable (a merchant sequence has no source sheet)
--   * audience records the trigger + app filter; NULL reads back as a sheet
--   * fu1_days / fu2_days are per-contact follow-up delays (triggered only)
--   * sequence_contacts.next_due_at is the contact's own follow-up clock
ALTER TABLE `campaign_sequences`
    MODIFY COLUMN `campaign_id` INT NULL,
    ADD COLUMN `audience` JSON NULL,
    ADD COLUMN `fu1_days` INT NOT NULL DEFAULT 2,
    ADD COLUMN `fu2_days` INT NOT NULL DEFAULT 3;

ALTER TABLE `sequence_contacts`
    MODIFY COLUMN `batch_no` INT NOT NULL DEFAULT 0,
    ADD COLUMN `next_due_at` DATETIME(3) NULL;

CREATE INDEX `sequence_contacts_next_due_at_idx` ON `sequence_contacts`(`next_due_at`);
