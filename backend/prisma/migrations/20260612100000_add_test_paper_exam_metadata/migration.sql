ALTER TABLE `test_papers`
    ADD COLUMN `subClass` VARCHAR(80) NULL,
    ADD COLUMN `examNature` VARCHAR(40) NULL,
    ADD COLUMN `examDate` DATETIME(3) NULL,
    ADD COLUMN `codeNo` VARCHAR(80) NULL,
    ADD COLUMN `timingText` VARCHAR(120) NULL;

CREATE INDEX `test_papers_examDate_idx` ON `test_papers`(`examDate`);
CREATE INDEX `test_papers_codeNo_idx` ON `test_papers`(`codeNo`);
CREATE INDEX `test_papers_examNature_idx` ON `test_papers`(`examNature`);
