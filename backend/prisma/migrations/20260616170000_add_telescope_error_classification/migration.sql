ALTER TABLE `telescope_request_logs`
  ADD COLUMN `traceId` VARCHAR(80) NULL,
  ADD COLUMN `frontendRoute` VARCHAR(500) NULL;

ALTER TABLE `telescope_error_logs`
  ADD COLUMN `traceId` VARCHAR(80) NULL,
  ADD COLUMN `sourceLayer` VARCHAR(40) NULL,
  ADD COLUMN `sourceModule` VARCHAR(120) NULL,
  ADD COLUMN `sourceService` VARCHAR(120) NULL,
  ADD COLUMN `errorCode` VARCHAR(80) NULL,
  ADD COLUMN `errorType` VARCHAR(160) NULL,
  ADD COLUMN `severity` VARCHAR(20) NULL,
  ADD COLUMN `confidence` VARCHAR(20) NULL,
  ADD COLUMN `frontendRoute` VARCHAR(500) NULL,
  ADD COLUMN `backendRoute` VARCHAR(255) NULL,
  ADD COLUMN `databaseProvider` VARCHAR(80) NULL,
  ADD COLUMN `externalEndpoint` VARCHAR(500) NULL,
  ADD COLUMN `userAction` VARCHAR(255) NULL,
  ADD COLUMN `classificationReason` TEXT NULL,
  ADD COLUMN `originFile` VARCHAR(500) NULL,
  ADD COLUMN `originLine` INTEGER NULL,
  ADD COLUMN `originColumn` INTEGER NULL,
  ADD COLUMN `originFunction` VARCHAR(255) NULL,
  ADD COLUMN `stackPreview` TEXT NULL,
  ADD COLUMN `context` JSON NULL;

CREATE INDEX `telescope_request_logs_traceId_idx` ON `telescope_request_logs`(`traceId`);
CREATE INDEX `telescope_error_logs_traceId_idx` ON `telescope_error_logs`(`traceId`);
CREATE INDEX `telescope_error_logs_sourceLayer_idx` ON `telescope_error_logs`(`sourceLayer`);
CREATE INDEX `telescope_error_logs_severity_idx` ON `telescope_error_logs`(`severity`);
