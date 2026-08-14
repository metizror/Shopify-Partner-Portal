-- CreateTable
CREATE TABLE `charges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tx_id` VARCHAR(255) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `partner_id` VARCHAR(255) NOT NULL,
    `app_id` VARCHAR(255) NOT NULL,
    `shop_domain` VARCHAR(255) NULL,
    `shop_name` VARCHAR(255) NULL,
    `charge_id` VARCHAR(255) NULL,
    `billing_interval` VARCHAR(32) NULL,
    `net` DOUBLE NOT NULL,
    `gross` DOUBLE NOT NULL,
    `fee` DOUBLE NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `charges_tx_id_key`(`tx_id`),
    INDEX `charges_app_id_occurred_at_idx`(`app_id`, `occurred_at`),
    INDEX `charges_occurred_at_idx`(`occurred_at`),
    INDEX `charges_shop_domain_idx`(`shop_domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
