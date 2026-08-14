-- CreateTable
CREATE TABLE `flows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `trigger` VARCHAR(64) NOT NULL,
    `app_scope` VARCHAR(64) NOT NULL DEFAULT 'all',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `steps` JSON NOT NULL,
    `created_by` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

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
