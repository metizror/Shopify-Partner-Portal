-- CreateTable
CREATE TABLE `campaigns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `sheet_name` VARCHAR(255) NULL,
    `headers` JSON NOT NULL,
    `email_column` VARCHAR(255) NULL,
    `template_id` INTEGER NULL,
    `sender_id` INTEGER NULL,
    `var_map` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `scheduled_at` DATETIME(3) NULL,
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `sent_count` INTEGER NOT NULL DEFAULT 0,
    `failed_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaigns_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_recipients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `vars` JSON NOT NULL,
    `selected` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `send_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `error` TEXT NULL,
    `message_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `campaign_recipients_campaign_id_status_idx`(`campaign_id`, `status`),
    INDEX `campaign_recipients_status_send_at_idx`(`status`, `send_at`),
    UNIQUE INDEX `campaign_recipients_campaign_id_email_key`(`campaign_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

