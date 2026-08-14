-- AlterTable
ALTER TABLE `flows` ADD COLUMN `schedule` JSON NULL;
ALTER TABLE `flows` ADD COLUMN `next_run_at` DATETIME(3) NULL;
