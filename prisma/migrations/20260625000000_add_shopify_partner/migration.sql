-- CreateTable
CREATE TABLE `shopify_partners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partner_id` VARCHAR(255) NOT NULL,
    `org_name` VARCHAR(255) NOT NULL,
    `api_token` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shopify_partners_partner_id_key`(`partner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

