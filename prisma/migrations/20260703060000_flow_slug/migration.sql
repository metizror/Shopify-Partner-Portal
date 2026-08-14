-- AlterTable
ALTER TABLE `flows` ADD COLUMN `slug` VARCHAR(160) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `flows_slug_key` ON `flows`(`slug`);
