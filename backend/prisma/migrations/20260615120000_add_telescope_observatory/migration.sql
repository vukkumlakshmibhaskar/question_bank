CREATE TABLE `telescope_request_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(80) NULL,
    `method` VARCHAR(12) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `route` VARCHAR(255) NULL,
    `statusCode` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `userRole` VARCHAR(40) NULL,
    `userEmail` VARCHAR(255) NULL,
    `ipAddress` VARCHAR(120) NULL,
    `userAgent` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `telescope_request_logs_createdAt_idx`(`createdAt`),
    INDEX `telescope_request_logs_method_idx`(`method`),
    INDEX `telescope_request_logs_statusCode_idx`(`statusCode`),
    INDEX `telescope_request_logs_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `telescope_error_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(80) NULL,
    `method` VARCHAR(12) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `statusCode` INTEGER NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `userId` INTEGER NULL,
    `userRole` VARCHAR(40) NULL,
    `userEmail` VARCHAR(255) NULL,
    `ipAddress` VARCHAR(120) NULL,
    `userAgent` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `telescope_error_logs_createdAt_idx`(`createdAt`),
    INDEX `telescope_error_logs_statusCode_idx`(`statusCode`),
    INDEX `telescope_error_logs_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
