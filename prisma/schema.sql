-- Full database schema, as one script. FALLBACK ONLY.
--
-- The supported way to create the tables is:
--
--     npx prisma migrate deploy
--
-- Use this file only when you cannot run that — a managed MySQL host that
-- gives you a SQL console and nothing else, a DBA who applies migrations for
-- you, or a review step that wants the DDL up front.
--
-- IMPORTANT: loading this file leaves Prisma's `_prisma_migrations` bookkeeping
-- table empty, so the next `prisma migrate deploy` believes nothing has been
-- applied and tries to create every table again — which fails. After loading
-- this file you MUST baseline the migration history, or the installation can
-- never take an upgrade:
--
--     for d in prisma/migrations/*/; do
--       npx prisma migrate resolve --applied "$(basename "$d")"
--     done
--     npx prisma migrate status     # → "Database schema is up to date!"
--
-- The database itself must already exist (step 2 of the README); this script
-- creates tables inside it, not the database.
--
-- Generated with:
--     npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
--
-- It is therefore derived from prisma/schema.prisma, not hand-written. Do not
-- edit it: change the schema, add a migration, and regenerate. Verified to
-- match a database built by the migrations exactly (`migrate diff` against a
-- fully migrated database reports no drift).

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
CREATE TABLE `partner_cookies` (
    `id` VARCHAR(128) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `role` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `shopify_apps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `partner_id` VARCHAR(255) NOT NULL,
    `app_id` VARCHAR(255) NOT NULL,
    `name` VARCHAR(512) NOT NULL,
    `handle` VARCHAR(512) NULL,
    `icon` TEXT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'sync',
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shopify_apps_partner_id_idx`(`partner_id`),
    UNIQUE INDEX `shopify_apps_partner_id_app_id_key`(`partner_id`, `app_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `uninstall_reason` TEXT NULL,
    `uninstall_description` TEXT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shopify_app_users_app_id_status_idx`(`app_id`, `status`),
    UNIQUE INDEX `shopify_app_users_app_id_domain_key`(`app_id`, `domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `source` VARCHAR(16) NOT NULL DEFAULT 'unknown',

    UNIQUE INDEX `shopify_app_events_event_key_key`(`event_key`),
    INDEX `shopify_app_events_app_id_type_idx`(`app_id`, `type`),
    INDEX `shopify_app_events_partner_id_type_idx`(`partner_id`, `type`),
    INDEX `shopify_app_events_app_id_store_domain_type_idx`(`app_id`, `store_domain`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
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
    `uninstall_reason` TEXT NULL,
    `reason_detail` TEXT NULL,
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

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `country` VARCHAR(128) NULL,
    `email` VARCHAR(255) NULL,
    `plan` VARCHAR(128) NULL,
    `appIds` JSON NULL,
    `ltv` DOUBLE NOT NULL DEFAULT 0,
    `mrr` DOUBLE NOT NULL DEFAULT 0,
    `first_seen` DATETIME(3) NULL,
    `last_seen` DATETIME(3) NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tags` JSON NULL,
    `notes` TEXT NULL,
    `account_owner` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_domain_key`(`domain`),
    INDEX `customers_status_idx`(`status`),
    INDEX `customers_mrr_idx`(`mrr`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_contacts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `role` VARCHAR(128) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_contacts_domain_idx`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_field_defs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `type` VARCHAR(24) NOT NULL DEFAULT 'text',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `custom_field_defs_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_field_values` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(255) NOT NULL,
    `field_key` VARCHAR(64) NOT NULL,
    `value` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `custom_field_values_domain_idx`(`domain`),
    UNIQUE INDEX `custom_field_values_domain_field_key_key`(`domain`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_timeline_comments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `author` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_timeline_comments_domain_idx`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_segments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `filter` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(160) NULL,
    `trigger` VARCHAR(64) NOT NULL,
    `app_scope` VARCHAR(64) NOT NULL DEFAULT 'all',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `steps` JSON NOT NULL,
    `layout` JSON NULL,
    `schedule` JSON NULL,
    `schedule_id` INTEGER NULL,
    `next_run_at` DATETIME(3) NULL,
    `last_event_at` DATETIME(3) NULL,
    `created_by` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `flows_slug_key`(`slug`),
    INDEX `flows_trigger_active_idx`(`trigger`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `flow_id` INTEGER NOT NULL,
    `trigger` VARCHAR(64) NOT NULL,
    `app_id` VARCHAR(64) NULL,
    `domain` VARCHAR(255) NULL,
    `status` VARCHAR(16) NOT NULL,
    `log` JSON NULL,
    `ran_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `flow_runs_flow_id_idx`(`flow_id`),
    INDEX `flow_runs_ran_at_idx`(`ran_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `flow_id` INTEGER NOT NULL,
    `run_id` INTEGER NULL,
    `domain` VARCHAR(255) NULL,
    `app_id` VARCHAR(64) NULL,
    `action` JSON NOT NULL,
    `run_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `flow_tasks_status_run_at_idx`(`status`, `run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `freq` VARCHAR(16) NOT NULL DEFAULT 'daily',
    `hour` INTEGER NOT NULL DEFAULT 9,
    `minute` INTEGER NOT NULL DEFAULT 0,
    `weekday` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(512) NOT NULL,
    `domain` VARCHAR(255) NULL,
    `assignee` VARCHAR(255) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `source` VARCHAR(32) NULL,
    `due_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tasks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_layouts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `header_html` TEXT NOT NULL,
    `footer_html` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body_html` TEXT NOT NULL,
    `layout_id` INTEGER NULL,
    `category` VARCHAR(32) NOT NULL DEFAULT 'transactional',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_senders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_senders_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_config` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `provider` VARCHAR(16) NOT NULL DEFAULT 'brevo',
    `brevo_api_key` VARCHAR(255) NULL,
    `smtp_host` VARCHAR(255) NULL,
    `smtp_port` INTEGER NULL,
    `smtp_user` VARCHAR(255) NULL,
    `smtp_password` VARCHAR(255) NULL,
    `smtp_secure` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaigns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `sheet_name` VARCHAR(255) NULL,
    `headers` JSON NOT NULL,
    `email_column` VARCHAR(255) NULL,
    `subject` VARCHAR(255) NULL,
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

-- CreateTable
CREATE TABLE `campaign_sequences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NULL,
    `audience` JSON NULL,
    `name` VARCHAR(255) NOT NULL,
    `batch_size` INTEGER NOT NULL,
    `gap_days` INTEGER NOT NULL,
    `send_hour` INTEGER NOT NULL,
    `fu1_days` INTEGER NOT NULL DEFAULT 2,
    `fu2_days` INTEGER NOT NULL DEFAULT 3,
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
    `batch_no` INTEGER NOT NULL DEFAULT 0,
    `next_due_at` DATETIME(3) NULL,
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
    INDEX `sequence_contacts_next_due_at_idx`(`next_due_at`),
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

-- CreateTable
CREATE TABLE `affiliate_programs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `commission_type` VARCHAR(16) NOT NULL DEFAULT 'percentage',
    `commission_value` DOUBLE NOT NULL DEFAULT 0,
    `cookie_days` INTEGER NOT NULL DEFAULT 30,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `program_id` INTEGER NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `affiliates_code_key`(`code`),
    INDEX `affiliates_program_id_idx`(`program_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliate_referrals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `affiliate_id` INTEGER NOT NULL,
    `customer_name` VARCHAR(255) NULL,
    `customer_domain` VARCHAR(255) NULL,
    `sale_amount` DOUBLE NOT NULL DEFAULT 0,
    `commission` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `affiliate_referrals_affiliate_id_idx`(`affiliate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliate_payouts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `affiliate_id` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL,
    `method` VARCHAR(64) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `note` TEXT NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `affiliate_payouts_affiliate_id_idx`(`affiliate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliate_claims` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `affiliate_id` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `affiliate_claims_affiliate_id_idx`(`affiliate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partner_managed_stores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `org_id` VARCHAR(32) NOT NULL,
    `shop_id` VARCHAR(64) NULL,
    `name` VARCHAR(255) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `url` VARCHAR(512) NOT NULL,
    `plan` VARCHAR(128) NULL,
    `access` VARCHAR(32) NULL,
    `state` VARCHAR(32) NULL,
    `started` VARCHAR(32) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `partner_managed_stores_domain_key`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sequence_contacts` ADD CONSTRAINT `sequence_contacts_sequence_id_fkey` FOREIGN KEY (`sequence_id`) REFERENCES `campaign_sequences`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sequence_emails` ADD CONSTRAINT `sequence_emails_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `sequence_contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

