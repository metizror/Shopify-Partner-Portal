-- CreateTable
CREATE TABLE `shopify_apps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partner_id` VARCHAR(255) NOT NULL,
    `app_id` VARCHAR(255) NOT NULL,
    `name` VARCHAR(512) NOT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shopify_apps_partner_id_idx`(`partner_id`),
    UNIQUE INDEX `shopify_apps_partner_id_app_id_key`(`partner_id`, `app_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

