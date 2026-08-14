-- CreateTable
CREATE TABLE `events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` VARCHAR(512) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `app_id` VARCHAR(64) NOT NULL,
    `app_name` VARCHAR(255) NOT NULL,
    `org` VARCHAR(64) NOT NULL,
    `store_name` VARCHAR(255) NULL,
    `store_url` VARCHAR(255) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `reason` TEXT NULL,
    `description` TEXT NULL,
    `plan_name` VARCHAR(128) NULL,
    `plan_amount` DOUBLE NULL,
    `plan_currency` VARCHAR(8) NULL,
    `inserted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `events_event_id_key`(`event_id`),
    INDEX `events_app_id_type_occurred_at_idx`(`app_id`, `type`, `occurred_at`),
    INDEX `events_occurred_at_idx`(`occurred_at`),
    INDEX `events_store_url_idx`(`store_url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `state` (
    `id` VARCHAR(128) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_emails` (
    `domain` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`domain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `thresholds` (
    `app_id` VARCHAR(64) NOT NULL,
    `settings` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`app_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `app_id` VARCHAR(64) NOT NULL,
    `snapshot_at` DATETIME(3) NOT NULL,
    `data` JSON NOT NULL,

    INDEX `app_snapshots_app_id_snapshot_at_idx`(`app_id`, `snapshot_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_categories` (
    `domain` VARCHAR(255) NOT NULL,
    `category` VARCHAR(128) NULL,
    `source` VARCHAR(64) NULL,
    `status` INTEGER NULL,
    `title` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `final_url` VARCHAR(500) NULL,
    `matched_keyword` VARCHAR(128) NULL,
    `error` VARCHAR(255) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`domain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_countries` (
    `domain` VARCHAR(255) NOT NULL,
    `country` VARCHAR(128) NULL,
    `phone` VARCHAR(64) NULL,
    `status` INTEGER NULL,
    `error` VARCHAR(255) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`domain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_ads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `range_label` VARCHAR(128) NOT NULL,
    `ad_id` VARCHAR(128) NOT NULL,
    `org_name` VARCHAR(64) NOT NULL,
    `data` JSON NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,

    INDEX `app_ads_range_label_idx`(`range_label`),
    UNIQUE INDEX `app_ads_range_label_ad_id_org_name_key`(`range_label`, `ad_id`, `org_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `keyword_suggestions` (
    `app_name` VARCHAR(255) NOT NULL,
    `data` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`app_name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partner_cookies` (
    `id` VARCHAR(128) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
