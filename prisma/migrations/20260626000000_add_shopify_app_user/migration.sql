-- CreateTable
CREATE TABLE `shopify_app_users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partner_id` VARCHAR(255) NOT NULL,
    `app_id` VARCHAR(255) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `installed_at` DATETIME(3) NULL,
    `uninstalled_at` DATETIME(3) NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shopify_app_users_app_id_status_idx`(`app_id`, `status`),
    UNIQUE INDEX `shopify_app_users_app_id_domain_key`(`app_id`, `domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

