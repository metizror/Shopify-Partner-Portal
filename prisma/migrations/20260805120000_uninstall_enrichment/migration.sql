-- Per-app admin shop-lookup endpoint config (URL + auth + shop param name).
-- The store domain is supplied per call, never stored here.
CREATE TABLE `app_data_endpoints` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `app_id` VARCHAR(255) NOT NULL,
    `url` VARCHAR(1000) NOT NULL,
    `auth_type` VARCHAR(16) NOT NULL DEFAULT 'header',
    `auth_header` VARCHAR(64) NULL,
    `auth_token` TEXT NULL,
    `shop_param` VARCHAR(64) NOT NULL DEFAULT 'domain',
    `timeout_ms` INTEGER NOT NULL DEFAULT 8000,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_ok_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `app_data_endpoints_app_id_key`(`app_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- What the app returned when a store uninstalled, merged with our fallbacks.
CREATE TABLE `uninstall_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `app_id` VARCHAR(255) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `uninstalled_at` DATETIME(3) NOT NULL,
    `installed_at` DATETIME(3) NULL,
    `duration_days` INTEGER NULL,
    `duration_text` VARCHAR(64) NULL,
    `plan_type` VARCHAR(128) NULL,
    `previous_plan` VARCHAR(128) NULL,
    `last_user_email` VARCHAR(320) NULL,
    `last_user_name` VARCHAR(255) NULL,
    `last_user_type` VARCHAR(64) NULL,
    `last_accessed_at` DATETIME(3) NULL,
    `contact_email` VARCHAR(320) NULL,
    `contact_name` VARCHAR(255) NULL,
    `app_status` INTEGER NULL,
    `fetch_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `fetch_error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `fetched_at` DATETIME(3) NULL,
    `raw` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `uninstall_snapshots_fetch_status_attempts_idx`(`fetch_status`, `attempts`),
    UNIQUE INDEX `uninstall_snapshots_app_id_domain_key`(`app_id`, `domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Per-store event lookup, used by the install-date fallback. The existing
-- indexes are (app_id, type) and (partner_id, type) — neither covers store_domain.
CREATE INDEX `shopify_app_events_app_id_store_domain_type_idx`
    ON `shopify_app_events`(`app_id`, `store_domain`, `type`);
