ALTER TABLE `questions`
  ADD COLUMN `sourceType` VARCHAR(40) NULL,
  ADD COLUMN `importJobId` INTEGER NULL,
  ADD COLUMN `extractionReviewId` INTEGER NULL;

CREATE INDEX `questions_sourceType_idx` ON `questions`(`sourceType`);
CREATE INDEX `questions_importJobId_idx` ON `questions`(`importJobId`);
CREATE INDEX `questions_extractionReviewId_idx` ON `questions`(`extractionReviewId`);
