-- CreateTable
CREATE TABLE `campaign_sequences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `batch_size` INTEGER NOT NULL,
    `gap_days` INTEGER NOT NULL,
    `send_hour` INTEGER NOT NULL,
    `fresh_template_id` INTEGER NOT NULL,
    `fresh_subject` VARCHAR(255) NOT NULL,
    `fu1_template_id` INTEGER NOT NULL,
    `fu1_subject` VARCHAR(255) NOT NULL,
    `fu2_template_id` INTEGER NOT NULL,
    `fu2_subject` VARCHAR(255) NOT NULL,
    `sender_id` INTEGER NULL,
    `var_map` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'running',
    `current_cycle` INTEGER NOT NULL DEFAULT 0,
    `total_batches` INTEGER NOT NULL,
    `next_run_at` DATETIME(3) NULL,
    `activity` JSON NULL,
    `created_by` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaign_sequences_status_next_run_at_idx`(`status`, `next_run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sequence_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sequence_id` INTEGER NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `vars` JSON NOT NULL,
    `batch_no` INTEGER NOT NULL,
    `stage` VARCHAR(16) NOT NULL DEFAULT 'waiting',
    `engaged` VARCHAR(16) NOT NULL DEFAULT 'none',
    `open_token` VARCHAR(64) NOT NULL,
    `opened_at` DATETIME(3) NULL,
    `replied_at` DATETIME(3) NULL,
    `last_sent_at` DATETIME(3) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sequence_contacts_open_token_key`(`open_token`),
    INDEX `sequence_contacts_sequence_id_batch_no_idx`(`sequence_id`, `batch_no`),
    INDEX `sequence_contacts_sequence_id_stage_idx`(`sequence_id`, `stage`),
    UNIQUE INDEX `sequence_contacts_sequence_id_email_key`(`sequence_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sequence_emails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sequence_id` INTEGER NOT NULL,
    `contact_id` INTEGER NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `send_at` DATETIME(3) NOT NULL,
    `sent_at` DATETIME(3) NULL,
    `message_id` VARCHAR(255) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sequence_emails_status_send_at_idx`(`status`, `send_at`),
    INDEX `sequence_emails_sequence_id_kind_idx`(`sequence_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sequence_contacts` ADD CONSTRAINT `sequence_contacts_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES `campaign_sequences`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sequence_emails` ADD CONSTRAINT `sequence_emails_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `sequence_contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

