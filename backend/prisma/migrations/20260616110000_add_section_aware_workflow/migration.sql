ALTER TABLE `questions`
  ADD COLUMN `sectionName` VARCHAR(120) NULL,
  ADD COLUMN `sectionOrder` INTEGER NULL,
  ADD COLUMN `sourceQuestionNo` VARCHAR(80) NULL,
  ADD COLUMN `sourcePageNo` INTEGER NULL,
  ADD COLUMN `sectionConfidence` VARCHAR(20) NULL,
  ADD COLUMN `sectionEvidence` JSON NULL,
  ADD COLUMN `subpartCount` INTEGER NULL,
  ADD COLUMN `choiceGroupKey` VARCHAR(120) NULL;

CREATE INDEX `questions_sectionName_idx` ON `questions`(`sectionName`);
CREATE INDEX `questions_sectionOrder_idx` ON `questions`(`sectionOrder`);
CREATE INDEX `questions_sourceQuestionNo_idx` ON `questions`(`sourceQuestionNo`);

CREATE TABLE `assessment_blueprint_sections` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `testPaperId` INTEGER NULL,
  `templateId` INTEGER NULL,
  `sectionName` VARCHAR(120) NOT NULL,
  `sectionOrder` INTEGER NOT NULL,
  `startsAtQuestion` INTEGER NULL,
  `endsAtQuestion` INTEGER NULL,
  `requiredCount` INTEGER NOT NULL DEFAULT 0,
  `optionalCount` INTEGER NOT NULL DEFAULT 0,
  `marksPerQuestion` INTEGER NULL,
  `questionType` VARCHAR(120) NULL,
  `difficultyMix` JSON NULL,
  `objectiveMix` JSON NULL,
  `subpartRule` JSON NULL,
  `sourceBankIds` JSON NULL,
  `validationStatus` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `assessment_blueprint_sections_testPaperId_sectionOrder_key`(`testPaperId`, `sectionOrder`),
  INDEX `assessment_blueprint_sections_templateId_sectionOrder_idx`(`templateId`, `sectionOrder`),
  INDEX `assessment_blueprint_sections_sectionName_idx`(`sectionName`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `assessment_blueprint_sections`
  ADD CONSTRAINT `assessment_blueprint_sections_testPaperId_fkey`
  FOREIGN KEY (`testPaperId`) REFERENCES `test_papers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `assessment_blueprint_sections`
  ADD CONSTRAINT `assessment_blueprint_sections_templateId_fkey`
  FOREIGN KEY (`templateId`) REFERENCES `assessment_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `test_paper_questions`
  ADD COLUMN `sectionName` VARCHAR(120) NULL,
  ADD COLUMN `sectionOrder` INTEGER NULL,
  ADD COLUMN `sectionDisplayOrder` INTEGER NULL,
  ADD COLUMN `sourceQuestionNo` VARCHAR(80) NULL,
  ADD COLUMN `isOptional` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `choiceGroupKey` VARCHAR(120) NULL,
  ADD COLUMN `generationSnapshot` JSON NULL;

CREATE INDEX `test_paper_questions_sectionName_idx` ON `test_paper_questions`(`sectionName`);
CREATE INDEX `test_paper_questions_sectionOrder_idx` ON `test_paper_questions`(`sectionOrder`);
CREATE INDEX `test_paper_questions_sourceQuestionNo_idx` ON `test_paper_questions`(`sourceQuestionNo`);
