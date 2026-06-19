ALTER TABLE `question_banks`
    ADD COLUMN `academicYear` VARCHAR(20) NULL,
    ADD COLUMN `sscClass` VARCHAR(100) NULL,
    ADD COLUMN `jobRole` VARCHAR(120) NULL,
    ADD COLUMN `subjectCode` VARCHAR(50) NULL,
    ADD COLUMN `subjectName` VARCHAR(150) NULL;

CREATE INDEX `question_banks_academicYear_idx` ON `question_banks`(`academicYear`);
CREATE INDEX `question_banks_sscClass_idx` ON `question_banks`(`sscClass`);
CREATE INDEX `question_banks_jobRole_idx` ON `question_banks`(`jobRole`);
CREATE INDEX `question_banks_subjectCode_idx` ON `question_banks`(`subjectCode`);
CREATE INDEX `question_banks_subjectName_idx` ON `question_banks`(`subjectName`);
