-- CreateTable
CREATE TABLE `shopify_app_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_key` VARCHAR(600) NOT NULL,
    `partner_id` VARCHAR(255) NOT NULL,
    `app_id` VARCHAR(255) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `store_domain` VARCHAR(255) NULL,
    `store_name` VARCHAR(255) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `shopify_app_events_event_key_key`(`event_key`),
    INDEX `shopify_app_events_app_id_type_idx`(`app_id`, `type`),
    INDEX `shopify_app_events_partner_id_type_idx`(`partner_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

