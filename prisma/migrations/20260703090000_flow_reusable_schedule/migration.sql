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

-- AlterTable
ALTER TABLE `flows` ADD COLUMN `schedule_id` INTEGER NULL;
