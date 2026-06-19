ALTER TABLE `questions`
  ADD COLUMN `sourceFileId` INTEGER NULL;

CREATE INDEX `questions_sourceFileId_idx` ON `questions`(`sourceFileId`);

ALTER TABLE `questions`
  ADD CONSTRAINT `questions_sourceFileId_fkey`
  FOREIGN KEY (`sourceFileId`) REFERENCES `upload_files`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
