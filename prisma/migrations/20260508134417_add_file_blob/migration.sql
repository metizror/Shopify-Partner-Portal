-- CreateTable
CREATE TABLE `file_blobs` (
    `filename` VARCHAR(128) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`filename`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
