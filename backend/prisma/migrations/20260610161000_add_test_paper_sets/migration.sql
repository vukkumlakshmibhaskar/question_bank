CREATE TABLE `test_paper_sets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `testPaperId` INTEGER NOT NULL,
    `label` VARCHAR(20) NOT NULL,
    `generationMode` VARCHAR(20) NOT NULL DEFAULT 'RANDOM',
    `sourceBankIds` JSON NULL,
    `questionCount` INTEGER NOT NULL DEFAULT 0,
    `totalMarks` INTEGER NOT NULL DEFAULT 0,
    `easyCount` INTEGER NOT NULL DEFAULT 0,
    `mediumCount` INTEGER NOT NULL DEFAULT 0,
    `hardCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `test_paper_sets_testPaperId_label_key`(`testPaperId`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `test_paper_questions` ADD COLUMN `setId` INTEGER NULL;

CREATE INDEX `test_paper_questions_setId_idx` ON `test_paper_questions`(`setId`);

ALTER TABLE `test_paper_sets` ADD CONSTRAINT `test_paper_sets_testPaperId_fkey`
    FOREIGN KEY (`testPaperId`) REFERENCES `test_papers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `test_paper_questions` ADD CONSTRAINT `test_paper_questions_setId_fkey`
    FOREIGN KEY (`setId`) REFERENCES `test_paper_sets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
