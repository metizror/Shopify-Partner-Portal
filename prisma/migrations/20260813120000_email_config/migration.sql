-- Delivery settings for outgoing email, so Brevo/SMTP can be configured from
-- Settings → Email instead of by editing .env and restarting. Singleton row.
-- No row is inserted here: absent means "not configured", and the service layer
-- falls back to BREVO_API_KEY from the environment until something is saved.
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
