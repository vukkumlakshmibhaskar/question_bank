ALTER TABLE `questions`
  ADD COLUMN `questionNo` VARCHAR(80) NULL,
  ADD COLUMN `questionHeader` VARCHAR(255) NULL,
  ADD COLUMN `questionTypeLabel` VARCHAR(120) NULL,
  ADD COLUMN `objectiveType` VARCHAR(80) NULL,
  ADD COLUMN `marks` INTEGER NULL,
  ADD COLUMN `sourceFileName` VARCHAR(255) NULL,
  ADD COLUMN `sourceReference` VARCHAR(255) NULL;

CREATE INDEX `questions_questionNo_idx` ON `questions`(`questionNo`);
CREATE INDEX `questions_questionHeader_idx` ON `questions`(`questionHeader`);
CREATE INDEX `questions_questionTypeLabel_idx` ON `questions`(`questionTypeLabel`);
CREATE INDEX `questions_objectiveType_idx` ON `questions`(`objectiveType`);
CREATE INDEX `questions_marks_idx` ON `questions`(`marks`);
CREATE INDEX `questions_sourceFileName_idx` ON `questions`(`sourceFileName`);
