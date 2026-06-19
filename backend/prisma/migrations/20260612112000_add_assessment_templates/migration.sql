CREATE TABLE `assessment_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `isGlobal` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `classGrade` VARCHAR(50) NULL,
    `subClass` VARCHAR(80) NULL,
    `subjectId` INTEGER NULL,
    `chapterId` INTEGER NULL,
    `conceptId` INTEGER NULL,
    `examNature` VARCHAR(40) NULL,
    `timingText` VARCHAR(120) NULL,
    `totalMarks` INTEGER NULL,
    `durationMinutes` INTEGER NULL,
    `difficultyLevel` VARCHAR(20) NULL,
    `instructions` TEXT NULL,
    `defaultGenerationMode` VARCHAR(20) NULL,
    `defaultSetCount` INTEGER NULL,
    `defaultDifficultyCounts` JSON NULL,
    `defaultMarksByDifficulty` JSON NULL,
    `defaultQuestionBankIds` JSON NULL,
    `defaultReplaceExistingSets` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `assessment_templates_createdById_idx`(`createdById`),
    INDEX `assessment_templates_status_idx`(`status`),
    INDEX `assessment_templates_isGlobal_idx`(`isGlobal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `assessment_templates`
    ADD CONSTRAINT `assessment_templates_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `test_papers`
    ADD COLUMN `templateId` INTEGER NULL,
    ADD COLUMN `defaultGenerationMode` VARCHAR(20) NULL,
    ADD COLUMN `defaultSetCount` INTEGER NULL,
    ADD COLUMN `defaultDifficultyCounts` JSON NULL,
    ADD COLUMN `defaultMarksByDifficulty` JSON NULL,
    ADD COLUMN `defaultQuestionBankIds` JSON NULL,
    ADD COLUMN `defaultReplaceExistingSets` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `test_papers_templateId_idx` ON `test_papers`(`templateId`);

ALTER TABLE `test_papers`
    ADD CONSTRAINT `test_papers_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `assessment_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
